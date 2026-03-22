import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { DuckDBInstance } from '@duckdb/node-api'
import type { Plugin } from 'vite'

const DOWNLOAD_HISTORY_ROUTE = '/api/history/download-speed'
const SAMPLE_INTERVAL_MS = 30_000
const SAMPLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const HISTORY_BUCKET_MS = 5 * 60 * 1000
const JSON_RPC_VERSION = '2.0'
const SESSION_HEADER = 'X-Transmission-Session-Id'
const outputDir = fileURLToPath(new URL('../data', import.meta.url))
const historyDatabasePath = fileURLToPath(new URL('../data/harbor-history.duckdb', import.meta.url))

const schemaSql = `
  CREATE TABLE IF NOT EXISTS transmission_download_history (
    observed_at_ms BIGINT NOT NULL,
    download_speed_bps BIGINT NOT NULL,
    upload_speed_bps BIGINT NOT NULL
  )
`

interface MiddlewareStack {
  use: (
    handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
  ) => void
}

interface TransmissionHistoryPluginOptions {
  target: string
  username?: string
  password?: string
}

interface TransmissionSessionStatsResponse {
  download_speed?: number
  upload_speed?: number
}

interface DownloadHistoryPoint {
  timestampMs: number
  averageDownloadSpeedBps: number
  peakDownloadSpeedBps: number
  sampleCount: number
}

interface DownloadHistoryResponse {
  points: DownloadHistoryPoint[]
  bucketMs: number
  capturedEveryMs: number
  rangeStartMs: number
  rangeEndMs: number
  lastRecordedAtMs: number | null
}

let historyInstancePromise: Promise<DuckDBInstance> | null = null
let schemaPromise: Promise<void> | null = null
let samplerStarted = false
let samplerTimeout: ReturnType<typeof setTimeout> | null = null
let transmissionSessionId = ''

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unable to load download history.'
}

function maybeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  return null
}

function getHistoryInstance() {
  if (!historyInstancePromise) {
    historyInstancePromise = DuckDBInstance.fromCache(historyDatabasePath)
  }

  return historyInstancePromise
}

async function withHistoryConnection<T>(callback: (connection: Awaited<ReturnType<DuckDBInstance['connect']>>) => Promise<T>) {
  const instance = await getHistoryInstance()
  const connection = await instance.connect()

  try {
    return await callback(connection)
  } finally {
    connection.closeSync()
  }
}

async function ensureHistorySchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await mkdir(outputDir, { recursive: true })
      await withHistoryConnection(async (connection) => {
        await connection.run(schemaSql)
      })
    })()
  }

  await schemaPromise
}

function buildTransmissionRpcUrl(target: string) {
  if (target.endsWith('/transmission/rpc')) {
    return target
  }

  if (target.endsWith('/transmission')) {
    return `${target}/rpc`
  }

  return new URL('/transmission/rpc', target).toString()
}

async function requestTransmissionRpc<T>(
  options: TransmissionHistoryPluginOptions,
  method: string,
) {
  const headers = new Headers({
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    pragma: 'no-cache',
  })

  if (transmissionSessionId) {
    headers.set(SESSION_HEADER, transmissionSessionId)
  }

  if (options.username !== undefined) {
    headers.set(
      'Authorization',
      `Basic ${Buffer.from(`${options.username}:${options.password ?? ''}`).toString('base64')}`,
    )
  }

  const response = await fetch(buildTransmissionRpcUrl(options.target), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: 'harbor-history',
      jsonrpc: JSON_RPC_VERSION,
      method,
    }),
  })

  if (response.status === 409) {
    const nextSessionId = response.headers.get(SESSION_HEADER)
    if (!nextSessionId) {
      throw new Error('Transmission RPC rejected the history request without a session id.')
    }

    transmissionSessionId = nextSessionId
    return requestTransmissionRpc<T>(options, method)
  }

  if (!response.ok) {
    throw new Error(`Transmission history sampler request failed with ${response.status}.`)
  }

  const payload = (await response.json()) as {
    error?: { data?: { result?: T }; message?: string }
    result?: T
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message)
  }

  if (payload.result !== undefined) {
    return payload.result
  }

  if (payload.error?.data?.result !== undefined) {
    return payload.error.data.result
  }

  throw new Error('Transmission history sampler returned an empty payload.')
}

async function writeDownloadSample(
  observedAtMs: number,
  downloadSpeedBps: number,
  uploadSpeedBps: number,
) {
  await ensureHistorySchema()

  await withHistoryConnection(async (connection) => {
    await connection.run(
      `
        INSERT INTO transmission_download_history (
          observed_at_ms,
          download_speed_bps,
          upload_speed_bps
        )
        VALUES ($observedAtMs, $downloadSpeedBps, $uploadSpeedBps)
      `,
      {
        observedAtMs,
        downloadSpeedBps,
        uploadSpeedBps,
      },
    )

    await connection.run(
      `
        DELETE FROM transmission_download_history
        WHERE observed_at_ms < $cutoffMs
      `,
      {
        cutoffMs: observedAtMs - SAMPLE_RETENTION_MS,
      },
    )
  })
}

async function sampleDownloadHistory(options: TransmissionHistoryPluginOptions) {
  const stats = await requestTransmissionRpc<TransmissionSessionStatsResponse>(
    options,
    'session_stats',
  )

  const observedAtMs = Date.now()
  await writeDownloadSample(
    observedAtMs,
    maybeNumber(stats.download_speed) ?? 0,
    maybeNumber(stats.upload_speed) ?? 0,
  )
}

function scheduleSampling(options: TransmissionHistoryPluginOptions) {
  if (!samplerStarted) {
    return
  }

  samplerTimeout = setTimeout(async () => {
    try {
      await sampleDownloadHistory(options)
    } catch {
      // Keep sampling even if the daemon is temporarily unavailable.
    } finally {
      scheduleSampling(options)
    }
  }, SAMPLE_INTERVAL_MS)
}

async function startSampler(options: TransmissionHistoryPluginOptions) {
  if (samplerStarted) {
    return
  }

  samplerStarted = true

  try {
    await sampleDownloadHistory(options)
  } catch {
    // The API should still come up even if the first sample fails.
  } finally {
    scheduleSampling(options)
  }
}

function stopSampler() {
  samplerStarted = false

  if (samplerTimeout) {
    clearTimeout(samplerTimeout)
    samplerTimeout = null
  }
}

function normalizeHistoryRow(row: Record<string, unknown>): DownloadHistoryPoint | null {
  const timestampMs = maybeNumber(row.timestamp_ms)
  const averageDownloadSpeedBps = maybeNumber(row.average_download_speed_bps)
  const peakDownloadSpeedBps = maybeNumber(row.peak_download_speed_bps)
  const sampleCount = maybeNumber(row.sample_count)

  if (
    timestampMs === null ||
    averageDownloadSpeedBps === null ||
    peakDownloadSpeedBps === null ||
    sampleCount === null
  ) {
    return null
  }

  return {
    timestampMs,
    averageDownloadSpeedBps,
    peakDownloadSpeedBps,
    sampleCount,
  }
}

async function readDownloadHistory(): Promise<DownloadHistoryResponse> {
  await ensureHistorySchema()

  const rangeEndMs = Date.now()
  const rangeStartMs = rangeEndMs - HISTORY_WINDOW_MS

  return withHistoryConnection(async (connection) => {
    const pointsReader = await connection.runAndReadAll(
      `
        WITH recent AS (
          SELECT
            observed_at_ms - (observed_at_ms % $bucketMs) AS timestamp_ms,
            download_speed_bps
          FROM transmission_download_history
          WHERE observed_at_ms >= $rangeStartMs
        )
        SELECT
          timestamp_ms,
          avg(download_speed_bps) AS average_download_speed_bps,
          max(download_speed_bps) AS peak_download_speed_bps,
          count(*) AS sample_count
        FROM recent
        GROUP BY timestamp_ms
        ORDER BY timestamp_ms ASC
      `,
      {
        bucketMs: HISTORY_BUCKET_MS,
        rangeStartMs,
      },
    )

    const lastRecordedReader = await connection.runAndReadAll(
      `
        SELECT max(observed_at_ms) AS last_recorded_at_ms
        FROM transmission_download_history
      `,
    )

    const points = pointsReader
      .getRowObjectsJS()
      .map((row) => normalizeHistoryRow(row))
      .filter((row): row is DownloadHistoryPoint => row !== null)

    const [lastRecordedRow] = lastRecordedReader.getRowObjectsJS()
    const lastRecordedAtMs = lastRecordedRow
      ? maybeNumber(lastRecordedRow.last_recorded_at_ms)
      : null

    return {
      points,
      bucketMs: HISTORY_BUCKET_MS,
      capturedEveryMs: SAMPLE_INTERVAL_MS,
      rangeStartMs,
      rangeEndMs,
      lastRecordedAtMs,
    }
  })
}

function writeJson(res: ServerResponse, payload: DownloadHistoryResponse) {
  res.statusCode = 200
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function writeMethodNotAllowed(res: ServerResponse) {
  res.statusCode = 405
  res.setHeader('allow', 'GET')
  res.end('Method Not Allowed')
}

function createRouteHandler() {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      writeMethodNotAllowed(res)
      return
    }

    try {
      writeJson(res, await readDownloadHistory())
    } catch (error) {
      res.statusCode = 500
      res.setHeader('cache-control', 'no-cache')
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: getErrorMessage(error) }))
    }
  }
}

function attachRoute(middlewares: MiddlewareStack) {
  const routeHandler = createRouteHandler()

  middlewares.use((req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (pathname === DOWNLOAD_HISTORY_ROUTE) {
      void routeHandler(req, res)
      return
    }

    next()
  })
}

export function transmissionHistoryPlugin(
  options: TransmissionHistoryPluginOptions,
): Plugin {
  return {
    name: 'transmission-history',
    configureServer(server) {
      void startSampler(options)
      attachRoute(server.middlewares)
      server.httpServer?.once('close', stopSampler)
    },
    configurePreviewServer(server) {
      void startSampler(options)
      attachRoute(server.middlewares)
      server.httpServer?.once('close', stopSampler)
    },
  }
}
