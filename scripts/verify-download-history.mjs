import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const PORT = 4178
const HISTORY_ROUTE = `http://${HOST}:${PORT}/api/history/download-speed`
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const STARTUP_TIMEOUT_MS = 20_000

function isBunRuntime() {
  return typeof globalThis === 'object' && globalThis !== null && 'Bun' in globalThis
}

async function openSqliteDatabase(path) {
  if (isBunRuntime()) {
    const bunSqliteModuleName = 'bun:sqlite'
    const { Database } = await import(bunSqliteModuleName)
    const database = new Database(path)

    return {
      close: () => database.close(),
      exec: (sql) => database.exec(sql),
      query: (sql) => database.query(sql),
    }
  }

  const nodeSqliteModuleName = 'node:sqlite'
  const { DatabaseSync } = await import(nodeSqliteModuleName)
  const database = new DatabaseSync(path)

  return {
    close: () => database.close(),
    exec: (sql) => database.exec(sql),
    query: (sql) => database.prepare(sql),
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'cache-control': 'no-cache',
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `${url} returned ${response.status}.`)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetchJson(url)
      return
    } catch {
      await delay(250)
    }
  }

  throw new Error(`Timed out waiting for ${url}.`)
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), 'harbor-history-verify-'))
  const historyDatabasePath = join(tempDir, 'history.sqlite')
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
  const server = spawn(process.execPath, [viteBin, '--host', HOST, '--port', String(PORT)], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      HARBOR_HISTORY_DATABASE_PATH: historyDatabasePath,
      TRANSMISSION_RPC_TARGET: 'http://127.0.0.1:65535',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let serverOutput = ''
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })

  try {
    await waitForServer(HISTORY_ROUTE, STARTUP_TIMEOUT_MS)

    const database = await openSqliteDatabase(historyDatabasePath)

    try {
      const oldObservedAtMs = Date.now() - HISTORY_WINDOW_MS - 60_000
      database
        .query(
          `
            INSERT INTO transmission_download_history (
              observed_at_ms,
              download_speed_bps,
              upload_speed_bps
            )
            VALUES (?, ?, ?)
          `,
        )
        .run(oldObservedAtMs, 111_111, 22_222)

      await fetchJson(HISTORY_ROUTE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          downloadSpeedBps: 2_000_000,
          uploadSpeedBps: 50_000,
        }),
      })

      const firstResponse = await fetchJson(HISTORY_ROUTE)
      assert.equal(firstResponse.points.length, 1, 'Expected one visible history bucket after the first sample.')
      assert.ok(firstResponse.lastRecordedAtMs, 'Expected lastRecordedAtMs to be populated.')
      assert.equal(firstResponse.points[0].sampleCount, 1, 'Expected the stale row to be pruned from the current bucket.')

      const historyCountRow = database
        .query(
          `
            SELECT
              count(*) AS count,
              min(observed_at_ms) AS oldest_observed_at_ms
            FROM transmission_download_history
          `,
        )
        .get()

      assert.equal(Number(historyCountRow.count), 1, 'Expected rows older than one week to be deleted.')
      assert.ok(
        Number(historyCountRow.oldest_observed_at_ms) >= Date.now() - HISTORY_WINDOW_MS,
        'Expected the remaining row to be newer than one week.',
      )

      await fetchJson(HISTORY_ROUTE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          downloadSpeedBps: 3_000_000,
          uploadSpeedBps: 60_000,
        }),
      })

      const secondResponse = await fetchJson(HISTORY_ROUTE)
      const latestPoint = secondResponse.points.at(-1)

      assert.ok(latestPoint, 'Expected a latest history bucket after the second sample.')
      assert.equal(
        latestPoint.sampleCount,
        2,
        'Expected the latest bucket to include both fresh samples.',
      )
      assert.ok(
        secondResponse.lastRecordedAtMs >= firstResponse.lastRecordedAtMs,
        'Expected lastRecordedAtMs to advance after the second sample.',
      )

      console.log('Download history verification passed.')
      console.log(`Database path: ${historyDatabasePath}`)
      console.log(
        `Latest bucket: samples=${latestPoint.sampleCount}, average=${latestPoint.averageDownloadSpeedBps}, peak=${latestPoint.peakDownloadSpeedBps}`,
      )
    } finally {
      database.close()
    }
  } catch (error) {
    if (serverOutput) {
      console.error(serverOutput.trim())
    }

    throw error
  } finally {
    server.kill('SIGTERM')
    await delay(250)
    await rm(tempDir, { force: true, recursive: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
