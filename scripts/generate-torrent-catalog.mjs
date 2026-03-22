import { access, mkdir, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { DuckDBInstance } from '@duckdb/node-api'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
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

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

async function ensureFileExists(path) {
  try {
    await access(path)
  } catch {
    throw new Error(`Missing source CSV at ${path}. Clone torrents-csv-data into ${projectRoot} first.`)
  }
}

async function main() {
  const startedAt = Date.now()

  await ensureFileExists(csvPath)
  await mkdir(outputDir, { recursive: true })
  await rm(outputPath, { force: true })

  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()

  try {
    console.log(`Generating Parquet catalog from ${csvPath}`)
    await connection.run(copySql, { csvPath, outputPath })

    const countReader = await connection.runAndReadAll(
      'select count(*) as row_count from read_parquet($outputPath)',
      { outputPath },
    )
    const [{ row_count: rowCount }] = countReader.getRowObjectsJS()
    const outputStats = await stat(outputPath)

    console.log(`Wrote ${outputPath}`)
    console.log(`Rows: ${typeof rowCount === 'bigint' ? rowCount.toString() : rowCount}`)
    console.log(`Size: ${(outputStats.size / 1024 / 1024).toFixed(1)} MB`)
    console.log(`Finished in ${formatDuration(Date.now() - startedAt)}`)
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

await main()
