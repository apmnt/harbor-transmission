import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

const MULLVAD_STATUS_ROUTE = '/api/mullvad/status'
const MULLVAD_STATUS_TIMEOUT_MS = 3_000
const MULLVAD_CHECK_IP_URL = 'https://am.i.mullvad.net/check-ip'
const MULLVAD_HEADERS = {
  Accept: '*/*',
  Origin: 'https://mullvad.net',
  Referer: 'https://mullvad.net/en/check',
}

type AddressFamily = 'ipv4' | 'ipv6'

const MULLVAD_STATUS_URLS: Record<AddressFamily, string> = {
  ipv4: 'https://ipv4.am.i.mullvad.net/json',
  ipv6: 'https://ipv6.am.i.mullvad.net/json',
}

interface RawMullvadAddressStatus {
  ip?: string | null
  country?: string | null
  city?: string | null
  mullvad_exit_ip?: boolean
  organization?: string | null
}

interface RawMullvadCheckStatus {
  mullvad_exit_ip?: boolean
}

interface NormalizedAddressStatus {
  addressFamily: AddressFamily
  ip: string
  country: string | null
  city: string | null
  mullvadExitIp: boolean
  organization: string | null
}

interface MullvadStatusResponse {
  available: boolean
  state: string
  usingMullvad: boolean
  activeAddressFamily: AddressFamily | null
  lockedDown: boolean | null
  location: {
    ipv4: string | null
    ipv6: string | null
    country: string | null
    city: string | null
    organization: string | null
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unable to query Mullvad public status.'
}

async function requestJson<T>(url: string) {
  const response = await fetch(url, {
    headers: MULLVAD_HEADERS,
    signal: AbortSignal.timeout(MULLVAD_STATUS_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}.`)
  }

  return (await response.json()) as T
}

async function readAddressStatus(addressFamily: AddressFamily): Promise<NormalizedAddressStatus> {
  const statusPayload = await requestJson<RawMullvadAddressStatus>(MULLVAD_STATUS_URLS[addressFamily])
  const ip = maybeString(statusPayload.ip)

  if (!ip) {
    throw new Error(`${addressFamily.toUpperCase()} lookup did not return an IP address.`)
  }

  const checkPayload = await requestJson<RawMullvadCheckStatus>(
    `${MULLVAD_CHECK_IP_URL}/${encodeURIComponent(ip)}`,
  )

  return {
    addressFamily,
    ip,
    country: maybeString(statusPayload.country),
    city: maybeString(statusPayload.city),
    mullvadExitIp:
      typeof checkPayload.mullvad_exit_ip === 'boolean'
        ? checkPayload.mullvad_exit_ip
        : Boolean(statusPayload.mullvad_exit_ip),
    organization: maybeString(statusPayload.organization),
  }
}

function getUnavailableStatus(error: string): MullvadStatusResponse {
  return {
    available: false,
    state: 'unknown',
    usingMullvad: false,
    activeAddressFamily: null,
    lockedDown: null,
    location: null,
    error,
  }
}

function chooseActiveAddress(
  addresses: Partial<Record<AddressFamily, NormalizedAddressStatus>>,
  usingMullvad: boolean,
) {
  if (usingMullvad) {
    return addresses.ipv4?.mullvadExitIp
      ? addresses.ipv4
      : addresses.ipv6?.mullvadExitIp
        ? addresses.ipv6
        : null
  }

  return addresses.ipv4 ?? addresses.ipv6 ?? null
}

function formatFailure(addressFamily: AddressFamily, error: unknown) {
  return `${addressFamily.toUpperCase()}: ${getErrorMessage(error)}`
}

async function readMullvadStatus(): Promise<MullvadStatusResponse> {
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    readAddressStatus('ipv4'),
    readAddressStatus('ipv6'),
  ])

  const failures: string[] = []
  const addresses: Partial<Record<AddressFamily, NormalizedAddressStatus>> = {}

  if (ipv4Result.status === 'fulfilled') {
    addresses.ipv4 = ipv4Result.value
  } else {
    failures.push(formatFailure('ipv4', ipv4Result.reason))
  }

  if (ipv6Result.status === 'fulfilled') {
    addresses.ipv6 = ipv6Result.value
  } else {
    failures.push(formatFailure('ipv6', ipv6Result.reason))
  }

  if (!addresses.ipv4 && !addresses.ipv6) {
    return getUnavailableStatus(failures.join(' · ') || 'Unable to query Mullvad public status.')
  }

  const usingMullvad = Boolean(addresses.ipv4?.mullvadExitIp || addresses.ipv6?.mullvadExitIp)
  const activeAddress = chooseActiveAddress(addresses, usingMullvad)

  return {
    available: true,
    state: usingMullvad ? 'connected' : 'disconnected',
    usingMullvad,
    activeAddressFamily: activeAddress?.addressFamily ?? null,
    lockedDown: null,
    location: {
      ipv4: addresses.ipv4?.ip ?? null,
      ipv6: addresses.ipv6?.ip ?? null,
      country: activeAddress?.country ?? null,
      city: activeAddress?.city ?? null,
      organization: activeAddress?.organization ?? null,
      hostname: null,
      bridgeHostname: null,
      entryHostname: null,
      obfuscatorHostname: null,
    },
    error: null,
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
