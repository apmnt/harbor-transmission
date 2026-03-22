import { access, mkdir, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { DuckDBInstance } from '@duckdb/node-api'
import type { Plugin } from 'vite'

const CATALOG_ROUTE = '/api/catalog/search'
const MIN_QUERY_LENGTH = 2
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const csvPath = fileURLToPath(new URL('../torrents-csv-data/torrents.csv', import.meta.url))
const outputDir = fileURLToPath(new URL('../data', import.meta.url))
const outputPath = fileURLToPath(new URL('../data/torrents-catalog.parquet', import.meta.url))

const copySql = `
  COPY (
    SELECT
      lower(trim(infohash)) AS infohash,
      trim(name) AS name,
      trim(regexp_replace(lower(name), '[[:punct:][:space:]]+', ' ', 'g')) AS name_search,
      size_bytes,
      created_unix,
      seeders,
      leechers,
      completed,
      scraped_date,
      published
    FROM read_csv(
      $csvPath,
      auto_detect = false,
      header = true,
      delim = ',',
      quote = '"',
      escape = '"',
      columns = {
        'infohash': 'VARCHAR',
        'name': 'VARCHAR',
        'size_bytes': 'BIGINT',
        'created_unix': 'BIGINT',
        'seeders': 'INTEGER',
        'leechers': 'INTEGER',
        'completed': 'BIGINT',
        'scraped_date': 'BIGINT',
        'published': 'BIGINT'
      }
    )
    WHERE infohash IS NOT NULL
      AND length(trim(infohash)) = 40
      AND name IS NOT NULL
  ) TO $outputPath (FORMAT PARQUET, COMPRESSION ZSTD)
`

interface CatalogTorrent {
  infohash: string
  name: string
  sizeBytes: number | null
  createdUnix: number | null
  seeders: number | null
  leechers: number | null
  completed: number | null
  scrapedDate: number | null
  published: number | null
}

interface CatalogSearchResponse {
  query: string
  results: CatalogTorrent[]
  hasMore: boolean
  limit: number
  offset: number
}

interface MiddlewareStack {
  use: (
    handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
  ) => void
}

interface SearchParams {
  exactInfohash: string | null
  limit: number
  normalizedQuery: string
  normalizedSearchTerm: string | null
  offset: number
}

let catalogInstancePromise: Promise<DuckDBInstance> | null = null
let generationPromise: Promise<void> | null = null

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function normalizeQuery(value: string | null) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[\p{P}\s]+/gu, ' ')
    .trim()
}

function isInfohash(value: string) {
  return /^[a-f0-9]{40}$/i.test(value)
}

function getDuckDbInstance() {
  if (!catalogInstancePromise) {
    catalogInstancePromise = DuckDBInstance.create(':memory:')
  }

  return catalogInstancePromise
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

function maybeString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeRow(row: Record<string, unknown>): CatalogTorrent {
  return {
    infohash: maybeString(row.infohash) ?? '',
    name: maybeString(row.name) ?? 'Unknown torrent',
    sizeBytes: maybeNumber(row.size_bytes),
    createdUnix: maybeNumber(row.created_unix),
    seeders: maybeNumber(row.seeders),
    leechers: maybeNumber(row.leechers),
    completed: maybeNumber(row.completed),
    scrapedDate: maybeNumber(row.scraped_date),
    published: maybeNumber(row.published),
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unable to query the torrent catalog.'
}

async function fileExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function generateCatalogParquet() {
  const sourceExists = await fileExists(csvPath)

  if (!sourceExists) {
    throw new Error(
      'Torrent catalog source is missing. Clone torrents-csv-data into the project root or run bun run catalog:build after adding torrents.csv.',
    )
  }

  await mkdir(outputDir, { recursive: true })
  await rm(outputPath, { force: true })

  const instance = await getDuckDbInstance()
  const connection = await instance.connect()

  try {
    await connection.run(copySql, { csvPath, outputPath })
  } catch (error) {
    await rm(outputPath, { force: true })
    throw error
  } finally {
    connection.closeSync()
  }
}

async function ensureCatalogParquet() {
  if (await fileExists(outputPath)) {
    return
  }

  if (!generationPromise) {
    generationPromise = generateCatalogParquet().finally(() => {
      generationPromise = null
    })
  }

  await generationPromise
}

function parseSearchParams(req: IncomingMessage): SearchParams {
  const url = new URL(req.url ?? CATALOG_ROUTE, 'http://127.0.0.1')
  const normalizedQuery = normalizeQuery(url.searchParams.get('q'))
  const normalizedLowerQuery = normalizedQuery.toLowerCase()

  return {
    exactInfohash: isInfohash(normalizedLowerQuery) ? normalizedLowerQuery : null,
    limit: clampInteger(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    normalizedQuery,
    normalizedSearchTerm:
      normalizedQuery.length >= MIN_QUERY_LENGTH ? normalizedLowerQuery : null,
    offset: clampInteger(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
  }
}

async function searchCatalog({
  exactInfohash,
  limit,
  normalizedQuery,
  normalizedSearchTerm,
  offset,
}: SearchParams): Promise<CatalogSearchResponse> {
  if (!exactInfohash && !normalizedSearchTerm) {
    return {
      query: normalizedQuery,
      results: [],
      hasMore: false,
      limit,
      offset,
    }
  }

  await ensureCatalogParquet()

  const instance = await getDuckDbInstance()
  const connection = await instance.connect()

  try {
    const sql = exactInfohash
      ? `
          SELECT
            infohash,
            name,
            size_bytes,
            created_unix,
            seeders,
            leechers,
            completed,
            scraped_date,
            published
          FROM read_parquet($outputPath)
          WHERE infohash = $exactInfohash
          ORDER BY
            coalesce(seeders, 0) DESC,
            coalesce(completed, 0) DESC,
            coalesce(published, 0) DESC,
            name ASC
          LIMIT $limitPlusOne
          OFFSET $offset
        `
      : `
          SELECT
            infohash,
            name,
            size_bytes,
            created_unix,
            seeders,
            leechers,
            completed,
            scraped_date,
            published
          FROM read_parquet($outputPath)
          WHERE strpos(name_search, $normalizedSearchTerm) > 0
          ORDER BY
            CASE WHEN strpos(name_search, $normalizedSearchTerm) = 1 THEN 0 ELSE 1 END,
            coalesce(seeders, 0) DESC,
            coalesce(completed, 0) DESC,
            coalesce(published, 0) DESC,
            name ASC
          LIMIT $limitPlusOne
          OFFSET $offset
        `

    const reader = exactInfohash
      ? await connection.runAndReadAll(sql, {
          outputPath,
          exactInfohash,
          limitPlusOne: limit + 1,
          offset,
        })
      : await connection.runAndReadAll(sql, {
          outputPath,
          normalizedSearchTerm,
          limitPlusOne: limit + 1,
          offset,
        })
    const rows = reader.getRowObjectsJS().map(normalizeRow)

    return {
      query: normalizedQuery,
      results: rows.slice(0, limit),
      hasMore: rows.length > limit,
      limit,
      offset,
    }
  } finally {
    connection.closeSync()
  }
}

function writeJson(res: ServerResponse, statusCode: number, payload: CatalogSearchResponse | { error: string }) {
  res.statusCode = statusCode
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
      const payload = await searchCatalog(parseSearchParams(req))
      writeJson(res, 200, payload)
    } catch (error) {
      writeJson(res, 500, { error: getErrorMessage(error) })
    }
  }
}

function attachCatalogRoute(middlewares: MiddlewareStack) {
  const handler = createRouteHandler()

  middlewares.use((req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (pathname !== CATALOG_ROUTE) {
      next()
      return
    }

    void handler(req, res)
  })
}

export function torrentCatalogPlugin(): Plugin {
  return {
    name: 'torrent-catalog',
    configureServer(server) {
      attachCatalogRoute(server.middlewares)
    },
    configurePreviewServer(server) {
      attachCatalogRoute(server.middlewares)
    },
  }
}
