export interface MullvadLocation {
  ipv4: string | null
  ipv6: string | null
  country: string | null
  city: string | null
  hostname: string | null
  bridgeHostname: string | null
  entryHostname: string | null
  obfuscatorHostname: string | null
}

export interface MullvadStatus {
  available: boolean
  state: string
  usingMullvad: boolean
  lockedDown: boolean | null
  location: MullvadLocation | null
  error: string | null
}

export const unavailableMullvadStatus: MullvadStatus = {
  available: false,
  state: 'unknown',
  usingMullvad: false,
  lockedDown: null,
  location: null,
  error: 'Unable to read Mullvad status.',
}

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function getMullvadStateLabel(status: MullvadStatus) {
  if (!status.available) return 'Mullvad unavailable'
  if (status.state === 'disconnected' && status.lockedDown) return 'Mullvad blocked'
  return `Mullvad ${toTitleCase(status.state)}`
}

export function getMullvadUsageLabel(status: MullvadStatus) {
  if (!status.available) return 'Status unavailable'
  if (status.usingMullvad) return 'Using Mullvad'
  if (status.lockedDown) return 'Traffic blocked'

  switch (status.state) {
    case 'connecting':
      return 'Tunnel starting'
    case 'disconnecting':
      return 'Tunnel closing'
    default:
      return 'Not on Mullvad'
  }
}

export function getMullvadServerLabel(status: MullvadStatus) {
  const location = status.location
  if (!location) return null

  const exitHost = location.hostname
  const entryHost = location.entryHostname
  const bridgeHost = location.bridgeHostname
  const obfuscatorHost = location.obfuscatorHostname

  const parts: string[] = []

  if (exitHost) {
    parts.push(exitHost)
  }

  if (entryHost) {
    parts.push(`via ${entryHost}`)
  }

  if (bridgeHost) {
    parts.push(`bridge ${bridgeHost}`)
  }

  if (obfuscatorHost) {
    parts.push(`obfs ${obfuscatorHost}`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

export function getMullvadLocationLabel(status: MullvadStatus) {
  const location = status.location
  if (!location) return null

  const parts = [location.city, location.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

export function getMullvadStatusTone(status: MullvadStatus) {
  if (!status.available) return 'destructive' as const
  if (status.usingMullvad) return 'default' as const
  if (status.state === 'connecting' || status.state === 'disconnecting') {
    return 'secondary' as const
  }

  return 'outline' as const
}

export function getMullvadSummary(status: MullvadStatus) {
  if (!status.available) {
    return status.error ?? 'Status endpoint unavailable.'
  }

  const parts = [getMullvadUsageLabel(status)]
  const server = getMullvadServerLabel(status)
  const location = getMullvadLocationLabel(status)

  if (server) {
    parts.push(server)
  }

  if (location) {
    parts.push(location)
  }

  if (status.lockedDown) {
    parts.push('Lockdown on')
  }

  return parts.join(' · ')
}

export class MullvadStatusClient {
  private endpoint: string

  constructor(endpoint = import.meta.env.VITE_MULLVAD_STATUS_URL ?? '/api/mullvad/status') {
    this.endpoint = endpoint
  }

  async getStatus() {
    const response = await fetch(this.endpoint, {
      headers: {
        'cache-control': 'no-cache',
      },
      credentials: 'include',
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Mullvad status request failed with ${response.status}.`)
    }

    return (await response.json()) as MullvadStatus
  }
}
