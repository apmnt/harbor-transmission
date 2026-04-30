import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

const PROWLARR_SEARCH_ROUTE = '/api/prowlarr/search'
const PROWLARR_DOWNLOAD_ROUTE = '/api/prowlarr/download'
const REQUEST_TIMEOUT_MS = 8_000

interface MiddlewareStack {
  use: (
    handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
  ) => void
}

interface ProwlarrSearchPluginOptions {
  target: string
  apiKey?: string
}

interface ProwlarrSearchResult {
  downloadUrl?: unknown
  [key: string]: unknown
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unable to query Prowlarr.'
}

function parseQuery(req: IncomingMessage) {
  const url = new URL(req.url ?? PROWLARR_SEARCH_ROUTE, 'http://127.0.0.1')
  const query = (url.searchParams.get('query') ?? url.searchParams.get('q') ?? '').trim()
  return query
}

function parseDownloadParams(req: IncomingMessage) {
  const url = new URL(req.url ?? PROWLARR_DOWNLOAD_ROUTE, 'http://127.0.0.1')
  const path = url.searchParams.get('path') ?? ''
  const link = url.searchParams.get('link') ?? ''
  const file = url.searchParams.get('file')

  return { path, link, file }
}

function createSearchUrl(target: string, query: string) {
  const url = new URL('/api/v1/search', target)
  url.searchParams.set('query', query)
  return url
}

function createProxiedDownloadUrl(downloadUrl: string, target: string) {
  const parsed = new URL(downloadUrl, target)
  const link = parsed.searchParams.get('link')
  const file = parsed.searchParams.get('file')

  if (!link || !parsed.pathname.endsWith('/download')) {
    return null
  }

  const proxied = new URL(PROWLARR_DOWNLOAD_ROUTE, 'http://127.0.0.1')
  proxied.searchParams.set('path', parsed.pathname)
  proxied.searchParams.set('link', link)

  if (file) {
    proxied.searchParams.set('file', file)
  }

  return `${PROWLARR_DOWNLOAD_ROUTE}?${proxied.searchParams.toString()}`
}

function normalizeSearchResults(payload: unknown, target: string): ProwlarrSearchResult[] {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload.map((item) => {
    if (!item || typeof item !== 'object') {
      return {}
    }

    const result = { ...(item as Record<string, unknown>) } as ProwlarrSearchResult
    if (typeof result.downloadUrl === 'string') {
      result.downloadUrl = createProxiedDownloadUrl(result.downloadUrl, target)
    }

    return result
  })
}

function createSearchRouteHandler({ apiKey, target }: ProwlarrSearchPluginOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      writeMethodNotAllowed(res)
      return
    }

    if (!apiKey) {
      writeJson(res, 500, {
        error:
          'Prowlarr API key is not configured. Set PROWLARR_API_KEY in your environment.',
      })
      return
    }

    const query = parseQuery(req)
    if (!query) {
      writeJson(res, 200, [])
      return
    }

    try {
      const response = await fetch(createSearchUrl(target, query), {
        headers: {
          'X-Api-Key': apiKey,
          'cache-control': 'no-cache',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        const message = await response.text()
        res.statusCode = response.status
        res.end(message || `Prowlarr search failed with ${response.status}.`)
        return
      }

      const payload = await response.json()
      writeJson(res, 200, normalizeSearchResults(payload, target))
    } catch (error) {
      writeJson(res, 502, { error: getErrorMessage(error) })
    }
  }
}

function createDownloadRouteHandler({ apiKey, target }: ProwlarrSearchPluginOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      writeMethodNotAllowed(res)
      return
    }

    if (!apiKey) {
      writeJson(res, 500, {
        error:
          'Prowlarr API key is not configured. Set PROWLARR_API_KEY in your environment.',
      })
      return
    }

    const { file, link, path } = parseDownloadParams(req)
    if (!path.startsWith('/') || !path.endsWith('/download') || !link) {
      writeJson(res, 400, { error: 'Invalid Prowlarr download request.' })
      return
    }

    const upstream = new URL(path, target)
    upstream.searchParams.set('apikey', apiKey)
    upstream.searchParams.set('link', link)
    if (file) {
      upstream.searchParams.set('file', file)
    }

    try {
      const response = await fetch(upstream, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        res.statusCode = response.status
        res.setHeader('location', location)
        res.end()
        return
      }

      if (!response.ok) {
        const message = await response.text()
        res.statusCode = response.status
        res.end(message || `Prowlarr download failed with ${response.status}.`)
        return
      }

      const payload = Buffer.from(await response.arrayBuffer())
      res.statusCode = 200
      res.setHeader('cache-control', 'no-cache')
      res.setHeader(
        'content-type',
        response.headers.get('content-type') ?? 'application/x-bittorrent',
      )

      const contentDisposition = response.headers.get('content-disposition')
      if (contentDisposition) {
        res.setHeader('content-disposition', contentDisposition)
      }

      res.end(payload)
    } catch (error) {
      writeJson(res, 502, { error: getErrorMessage(error) })
    }
  }
}

function attachProwlarrRoutes(
  middlewares: MiddlewareStack,
  options: ProwlarrSearchPluginOptions,
) {
  const searchHandler = createSearchRouteHandler(options)
  const downloadHandler = createDownloadRouteHandler(options)

  middlewares.use((req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (pathname === PROWLARR_SEARCH_ROUTE) {
      void searchHandler(req, res)
      return
    }

    if (pathname === PROWLARR_DOWNLOAD_ROUTE) {
      void downloadHandler(req, res)
      return
    }

    if (pathname !== PROWLARR_SEARCH_ROUTE && pathname !== PROWLARR_DOWNLOAD_ROUTE) {
      next()
    }
  })
}

export function prowlarrSearchPlugin(options: ProwlarrSearchPluginOptions): Plugin {
  return {
    name: 'prowlarr-search',
    configureServer(server) {
      attachProwlarrRoutes(server.middlewares, options)
    },
    configurePreviewServer(server) {
      attachProwlarrRoutes(server.middlewares, options)
    },
  }
}
