export interface CatalogTorrent {
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

export interface CatalogSearchResponse {
  query: string
  results: CatalogTorrent[]
  hasMore: boolean
  limit: number
  offset: number
}

const INFOHASH_PATTERN = /^[a-f0-9]{40}$/i

export function normalizeCatalogSearchQuery(query: string) {
  return query
    .toLowerCase()
    .replace(/[\p{P}\s]+/gu, ' ')
    .trim()
}

export function isInfohashQuery(query: string) {
  return INFOHASH_PATTERN.test(query)
}

export function canSearchCatalog(query: string) {
  const normalizedQuery = normalizeCatalogSearchQuery(query)
  return normalizedQuery.length >= 2 || isInfohashQuery(normalizedQuery)
}

export function getTorrentMagnetLink(infohash: string) {
  return `magnet:?xt=urn:btih:${infohash.toLowerCase()}`
}

export class TorrentCatalogClient {
  private endpoint: string

  constructor(endpoint = import.meta.env.VITE_TORRENT_CATALOG_URL ?? '/api/catalog/search') {
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
    const limit = options.limit ?? 20
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
      credentials: 'include',
      signal: options.signal,
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Catalog request failed with ${response.status}.`)
    }

    return (await response.json()) as CatalogSearchResponse
  }
}
