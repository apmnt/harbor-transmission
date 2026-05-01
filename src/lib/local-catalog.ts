import {
  canSearchCatalog,
  getTorrentMagnetLink,
  normalizeCatalogSearchQuery,
  type CatalogSearchResponse,
  type CatalogTorrent,
} from './catalog'

interface LocalCatalogTorrent {
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

interface LocalCatalogSearchResponse {
  query: string
  results: LocalCatalogTorrent[]
  hasMore: boolean
  limit: number
  offset: number
}

function normalizeLocalResult(result: LocalCatalogTorrent): CatalogTorrent {
  return {
    actionKey: result.infohash,
    infohash: result.infohash,
    sourceUrl: getTorrentMagnetLink(result.infohash),
    source: 'torrents-csv',
    name: result.name,
    sizeBytes: result.sizeBytes,
    createdUnix: result.createdUnix,
    seeders: result.seeders,
    leechers: result.leechers,
    completed: result.completed,
    scrapedDate: result.scrapedDate,
    published: result.published,
  }
}

export class LocalTorrentCatalogClient {
  private endpoint: string

  constructor(endpoint = '/api/catalog/search') {
    this.endpoint = endpoint
  }

  async search(
    query: string,
    options: {
      limit?: number
      offset?: number
      signal?: AbortSignal
    } = {},
  ) {
    const normalizedQuery = normalizeCatalogSearchQuery(query)
    const limit = options.limit ?? 10
    const offset = options.offset ?? 0

    if (!canSearchCatalog(normalizedQuery)) {
      return {
        query: normalizedQuery,
        results: [],
        hasMore: false,
        limit,
        offset,
      } satisfies CatalogSearchResponse
    }

    const url = new URL(this.endpoint, window.location.origin)
    url.searchParams.set('q', normalizedQuery)
    url.searchParams.set('limit', `${limit}`)
    url.searchParams.set('offset', `${offset}`)

    const response = await fetch(url, {
      headers: {
        'cache-control': 'no-cache',
      },
      signal: options.signal,
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Catalog request failed with ${response.status}.`)
    }

    const payload = (await response.json()) as LocalCatalogSearchResponse
    return {
      ...payload,
      results: payload.results.map(normalizeLocalResult),
    } satisfies CatalogSearchResponse
  }
}
