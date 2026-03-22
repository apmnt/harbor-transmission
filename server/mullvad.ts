import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'

import type { Plugin } from 'vite'

const execFileAsync = promisify(execFile)
const MULLVAD_STATUS_ROUTE = '/api/mullvad/status'
const MULLVAD_STATUS_TIMEOUT_MS = 3_000

interface RawMullvadLocation {
  ipv4?: string | null
  ipv6?: string | null
  country?: string | null
  city?: string | null
  mullvad_exit_ip?: boolean
  hostname?: string | null
  bridge_hostname?: string | null
  entry_hostname?: string | null
  obfuscator_hostname?: string | null
}

interface RawMullvadStatus {
  state?: string
  details?: {
    locked_down?: boolean
    location?: RawMullvadLocation | null
  }
}

interface MullvadStatusResponse {
  available: boolean
  state: string
  usingMullvad: boolean
  lockedDown: boolean | null
  location: {
    ipv4: string | null
    ipv6: string | null
    country: string | null
    city: string | null
    hostname: string | null
    bridgeHostname: string | null
    entryHostname: string | null
    obfuscatorHostname: string | null
  } | null
  error: string | null
}

interface MiddlewareStack {
  use: (
    handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
  ) => void
}

function maybeString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeMullvadStatus(raw: RawMullvadStatus): MullvadStatusResponse {
  const location = raw.details?.location

  return {
    available: true,
    state: maybeString(raw.state) ?? 'unknown',
    usingMullvad: Boolean(location?.mullvad_exit_ip),
    lockedDown: typeof raw.details?.locked_down === 'boolean' ? raw.details.locked_down : null,
    location: location
      ? {
          ipv4: maybeString(location.ipv4),
          ipv6: maybeString(location.ipv6),
          country: maybeString(location.country),
          city: maybeString(location.city),
          hostname: maybeString(location.hostname),
          bridgeHostname: maybeString(location.bridge_hostname),
          entryHostname: maybeString(location.entry_hostname),
          obfuscatorHostname: maybeString(location.obfuscator_hostname),
        }
      : null,
    error: null,
  }
}

function getUnavailableStatus(error: string): MullvadStatusResponse {
  return {
    available: false,
    state: 'unknown',
    usingMullvad: false,
    lockedDown: null,
    location: null,
    error,
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    const stderr = 'stderr' in error ? error.stderr : null
    if (typeof stderr === 'string' && stderr.trim().length > 0) {
      return stderr.trim()
    }
  }

  return 'Unable to query Mullvad status.'
}

async function readMullvadStatus(): Promise<MullvadStatusResponse> {
  const command = process.env.MULLVAD_CLI_PATH || 'mullvad'

  try {
    const { stdout } = await execFileAsync(command, ['status', '--json'], {
      encoding: 'utf8',
      timeout: MULLVAD_STATUS_TIMEOUT_MS,
      windowsHide: true,
    })

    const payload = JSON.parse(stdout) as RawMullvadStatus
    return normalizeMullvadStatus(payload)
  } catch (error) {
    return getUnavailableStatus(getErrorMessage(error))
  }
}

function writeJson(res: ServerResponse, payload: MullvadStatusResponse) {
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

    writeJson(res, await readMullvadStatus())
  }
}

function attachMullvadRoute(middlewares: MiddlewareStack) {
  const handler = createRouteHandler()

  middlewares.use((req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (pathname !== MULLVAD_STATUS_ROUTE) {
      next()
      return
    }

    void handler(req, res)
  })
}

export function mullvadStatusPlugin(): Plugin {
  return {
    name: 'mullvad-status',
    configureServer(server) {
      attachMullvadRoute(server.middlewares)
    },
    configurePreviewServer(server) {
      attachMullvadRoute(server.middlewares)
    },
  }
}
