export interface CatalogTorrent {
  actionKey: string
  infohash: string
  sourceUrl: string | null
  source: string | null
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
  indexer?: string
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
  const offsets = [0x811c9dc5, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]
  const chunks = offsets.map((offset) => {
    let hash = offset
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  })

  return chunks.join('').slice(0, 40)
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

  const fallbackSeed = `${sourceUrl ?? ''}|${maybeString(result.guid) ?? ''}|${result.title}`
  const infohash = realInfohash ?? createPseudoInfohash(fallbackSeed)
  const actionKey = createPseudoInfohash(`action|${fallbackSeed}`)

  return {
    actionKey,
    infohash,
    sourceUrl,
    source: maybeString(result.indexerName) ?? maybeString(result.indexer),
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

function compareCatalogTorrents(a: CatalogTorrent, b: CatalogTorrent) {
  const aSeeders = a.seeders ?? -1
  const bSeeders = b.seeders ?? -1
  if (aSeeders !== bSeeders) {
    return bSeeders - aSeeders
  }

  const aLeechers = a.leechers ?? -1
  const bLeechers = b.leechers ?? -1
  if (aLeechers !== bLeechers) {
    return bLeechers - aLeechers
  }

  return a.name.localeCompare(b.name)
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

export async function resolveCatalogTorrentSourceUrl(torrent: CatalogTorrent) {
  const sourceUrl = getCatalogTorrentSourceUrl(torrent)
  if (!sourceUrl.startsWith(window.location.origin)) {
    return sourceUrl
  }

  const parsed = new URL(sourceUrl)
  if (parsed.pathname !== '/api/prowlarr/download') {
    return sourceUrl
  }

  const resolveUrl = new URL('/api/prowlarr/resolve', window.location.origin)
  resolveUrl.search = parsed.search

  const response = await fetch(resolveUrl, {
    headers: {
      'cache-control': 'no-cache',
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Prowlarr resolve failed with ${response.status}.`)
  }

  const payload = (await response.json()) as { url?: unknown }
  const resolved = typeof payload.url === 'string' ? payload.url : ''
  if (!resolved) {
    throw new Error('Prowlarr did not return a usable download URL.')
  }

  return resolved
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
    const normalizedResults = data
      .map(normalizeProwlarrResult)
      .filter((r): r is CatalogTorrent => r !== null)
      .sort(compareCatalogTorrents)
    const results = normalizedResults
      .slice(offset, offset + limit)

    return {
      query: normalizedQuery,
      results,
      hasMore: normalizedResults.length > offset + limit,
      limit,
      offset,
    } satisfies CatalogSearchResponse
  }
}
