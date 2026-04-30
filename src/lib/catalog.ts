export interface CatalogTorrent {
  infohash: string
  sourceUrl: string | null
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

interface ProwlarrSearchResult {
  title: string
  size?: number
  seeders?: number
  peers?: number
  leechers?: number
  publishDate?: string
  infoHash?: string
  magnetUrl?: string
  downloadUrl?: string
  guid?: string
  indexerName?: string
}

const INFOHASH_PATTERN = /^[a-f0-9]{40}$/i
const MAGNET_HASH_PATTERN = /xt=urn:btih:([a-f0-9]+)/i

function extractInfohashFromMagnet(magnetUrl: string): string | null {
  const match = magnetUrl.match(MAGNET_HASH_PATTERN)
  return match ? match[1].toLowerCase() : null
}

function maybeString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function createPseudoInfohash(seed: string) {
  let hash = 0x811c9dc5
  let output = ''

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
    output += hash.toString(16).padStart(8, '0')
  }

  if (output.length === 0) {
    output = '0'.repeat(40)
  }

  return (output + output).slice(0, 40)
}

function parseProwlarrDate(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  try {
    return Math.floor(new Date(dateStr).getTime() / 1000)
  } catch {
    return null
  }
}

function normalizeProwlarrResult(result: ProwlarrSearchResult): CatalogTorrent | null {
  const magnetUrl = maybeString(result.magnetUrl)
  const downloadUrl = maybeString(result.downloadUrl)
  const sourceUrl = magnetUrl ?? downloadUrl
  const infoHashField = maybeString(result.infoHash)?.toLowerCase() ?? null
  const infohashFromMagnet = magnetUrl ? extractInfohashFromMagnet(magnetUrl) : null
  const normalizedInfoHashField =
    infoHashField && INFOHASH_PATTERN.test(infoHashField) ? infoHashField : null
  const realInfohash = normalizedInfoHashField ?? infohashFromMagnet

  if (!sourceUrl && !realInfohash) return null

  const infohash =
    realInfohash ??
    createPseudoInfohash(sourceUrl ?? maybeString(result.guid) ?? result.title)

  return {
    infohash,
    sourceUrl,
    name: result.title || 'Unknown torrent',
    sizeBytes: result.size ?? null,
    createdUnix: parseProwlarrDate(result.publishDate),
    seeders: result.seeders ?? null,
    leechers: result.leechers ?? result.peers ?? null,
    completed: null,
    scrapedDate: null,
    published: parseProwlarrDate(result.publishDate),
  }
}

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

export function getCatalogTorrentSourceUrl(torrent: CatalogTorrent) {
  const sourceUrl = torrent.sourceUrl ?? getTorrentMagnetLink(torrent.infohash)
  if (sourceUrl.startsWith('/')) {
    return new URL(sourceUrl, window.location.origin).toString()
  }

  return sourceUrl
}

export class TorrentCatalogClient {
  private endpoint: string

  constructor(endpoint = '/api/prowlarr/search') {
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
    url.searchParams.set('query', normalizedQuery)

    const response = await fetch(url, {
      headers: {
        'cache-control': 'no-cache',
      },
      signal: options.signal,
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Prowlarr search failed with ${response.status}.`)
    }

    const data = (await response.json()) as ProwlarrSearchResult[]
    const results = data
      .map(normalizeProwlarrResult)
      .filter((r): r is CatalogTorrent => r !== null)
      .slice(offset, offset + limit)

    return {
      query: normalizedQuery,
      results,
      hasMore: data.length > offset + limit,
      limit,
      offset,
    } satisfies CatalogSearchResponse
  }
}
