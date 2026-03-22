import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'

import { openSqliteDatabase, type SqliteDatabase } from './sqlite'

const DOWNLOAD_HISTORY_ROUTE = '/api/history/download-speed'
const SAMPLE_INTERVAL_MS = 30_000
const SAMPLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const HISTORY_BUCKET_MS = 5 * 60 * 1000
const JSON_RPC_VERSION = '2.0'
const SESSION_HEADER = 'X-Transmission-Session-Id'
const outputDir = fileURLToPath(new URL('../data', import.meta.url))
const historyDatabasePath = fileURLToPath(new URL('../data/harbor-history.sqlite', import.meta.url))

const schemaSql = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS transmission_download_history (
    observed_at_ms INTEGER NOT NULL,
    download_speed_bps INTEGER NOT NULL,
    upload_speed_bps INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS transmission_download_history_observed_idx
    ON transmission_download_history (observed_at_ms);
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

interface DownloadHistoryIngestRequest {
  downloadSpeedBps?: number
  uploadSpeedBps?: number
}

let historyDatabase: SqliteDatabase | null = null
let historyReadyPromise: Promise<void> | null = null
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

async function getHistoryDatabase() {
  if (!historyDatabase) {
    historyDatabase = await openSqliteDatabase(historyDatabasePath)
    historyDatabase.exec(schemaSql)
  }

  return historyDatabase
}

async function ensureHistoryDatabase() {
  if (!historyReadyPromise) {
    historyReadyPromise = (async () => {
      await mkdir(outputDir, { recursive: true })
      await getHistoryDatabase()
    })()
  }

  await historyReadyPromise
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
  await ensureHistoryDatabase()

  const db = await getHistoryDatabase()
  db.prepare(
    `
      INSERT INTO transmission_download_history (
        observed_at_ms,
        download_speed_bps,
        upload_speed_bps
      )
      VALUES (?, ?, ?)
    `,
  ).run(observedAtMs, downloadSpeedBps, uploadSpeedBps)

  db.prepare(
    `
      DELETE FROM transmission_download_history
      WHERE observed_at_ms < ?
    `,
  ).run(observedAtMs - SAMPLE_RETENTION_MS)
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

async function readDownloadHistory(): Promise<DownloadHistoryResponse> {
  await ensureHistoryDatabase()

  const db = await getHistoryDatabase()
  const rangeEndMs = Date.now()
  const rangeStartMs = rangeEndMs - HISTORY_WINDOW_MS

  const points = db
    .prepare(
      `
        SELECT
          observed_at_ms - (observed_at_ms % ?) AS timestamp_ms,
          avg(download_speed_bps) AS average_download_speed_bps,
          max(download_speed_bps) AS peak_download_speed_bps,
          count(*) AS sample_count
        FROM transmission_download_history
        WHERE observed_at_ms >= ?
        GROUP BY timestamp_ms
        ORDER BY timestamp_ms ASC
      `,
    )
    .all(HISTORY_BUCKET_MS, rangeStartMs)
    .map((row) => ({
      timestampMs: maybeNumber(row.timestamp_ms) ?? 0,
      averageDownloadSpeedBps: maybeNumber(row.average_download_speed_bps) ?? 0,
      peakDownloadSpeedBps: maybeNumber(row.peak_download_speed_bps) ?? 0,
      sampleCount: maybeNumber(row.sample_count) ?? 0,
    }))

  const lastRecordedRow = db
    .prepare(
      `
        SELECT max(observed_at_ms) AS last_recorded_at_ms
        FROM transmission_download_history
      `,
    )
    .get() as { last_recorded_at_ms?: number | bigint | null } | undefined

  return {
    points,
    bucketMs: HISTORY_BUCKET_MS,
    capturedEveryMs: SAMPLE_INTERVAL_MS,
    rangeStartMs,
    rangeEndMs,
    lastRecordedAtMs: lastRecordedRow
      ? maybeNumber(lastRecordedRow.last_recorded_at_ms)
      : null,
  }
}

function writeJson(res: ServerResponse, payload: DownloadHistoryResponse) {
  res.statusCode = 200
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function writeMethodNotAllowed(res: ServerResponse) {
  res.statusCode = 405
  res.setHeader('allow', 'GET, POST')
  res.end('Method Not Allowed')
}

function writeBadRequest(res: ServerResponse, message: string) {
  res.statusCode = 400
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: message }))
}

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function createRouteHandler() {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') {
      try {
        writeJson(res, await readDownloadHistory())
      } catch (error) {
        res.statusCode = 500
        res.setHeader('cache-control', 'no-cache')
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: getErrorMessage(error) }))
      }
      return
    }

    if (req.method === 'POST') {
      try {
        const rawBody = await readRequestBody(req)
        const payload = JSON.parse(rawBody) as DownloadHistoryIngestRequest
        const downloadSpeedBps = maybeNumber(payload.downloadSpeedBps)
        const uploadSpeedBps = maybeNumber(payload.uploadSpeedBps)

        if (downloadSpeedBps === null || uploadSpeedBps === null) {
          writeBadRequest(res, 'downloadSpeedBps and uploadSpeedBps are required.')
          return
        }

        await writeDownloadSample(Date.now(), downloadSpeedBps, uploadSpeedBps)
        res.statusCode = 204
        res.end()
        return
      } catch (error) {
        if (error instanceof SyntaxError) {
          writeBadRequest(res, 'Request body must be valid JSON.')
          return
        }

        res.statusCode = 500
        res.setHeader('cache-control', 'no-cache')
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: getErrorMessage(error) }))
        return
      }
    }

    writeMethodNotAllowed(res)
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
