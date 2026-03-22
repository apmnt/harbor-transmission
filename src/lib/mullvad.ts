export type MullvadAddressFamily = 'ipv4' | 'ipv6'

export interface MullvadLocation {
  ipv4: string | null
  ipv6: string | null
  country: string | null
  city: string | null
  organization: string | null
  hostname: string | null
  serverType: string | null
  bridgeHostname: string | null
  entryHostname: string | null
  obfuscatorHostname: string | null
}

export interface MullvadStatus {
  available: boolean
  state: string
  usingMullvad: boolean
  activeAddressFamily: MullvadAddressFamily | null
  lockedDown: boolean | null
  location: MullvadLocation | null
  error: string | null
}

export const unavailableMullvadStatus: MullvadStatus = {
  available: false,
  state: 'unknown',
  usingMullvad: false,
  activeAddressFamily: null,
  lockedDown: null,
  location: null,
  error: 'Unable to read Mullvad status.',
}

export function getMullvadStateLabel(status: MullvadStatus) {
  if (!status.available) return 'Mullvad unavailable'
  if (status.usingMullvad) return 'Mullvad connected'
  return 'Mullvad not detected'
}

export function getMullvadUsageLabel(status: MullvadStatus) {
  if (!status.available) return 'Status unavailable'
  if (status.usingMullvad) return 'Using Mullvad exit'
  return 'Not using Mullvad'
}

function getActiveAddressFamily(status: MullvadStatus): MullvadAddressFamily | null {
  const location = status.location
  if (!location) return null

  if (status.activeAddressFamily === 'ipv4' && location.ipv4) return 'ipv4'
  if (status.activeAddressFamily === 'ipv6' && location.ipv6) return 'ipv6'
  if (location.ipv4) return 'ipv4'
  if (location.ipv6) return 'ipv6'
  return null
}

export function getMullvadServerLabel(status: MullvadStatus) {
  const location = status.location
  if (!location || !status.usingMullvad) return null

  const activeAddressFamily = getActiveAddressFamily(status)
  if (!activeAddressFamily) return null

  const activeIp = activeAddressFamily === 'ipv6' ? location.ipv6 : location.ipv4
  if (!activeIp) return null

  if (location.hostname) {
    const parts = [location.hostname]

    if (location.serverType) {
      parts.push(location.serverType)
    }

    parts.push(activeAddressFamily.toUpperCase())

    return parts.join(' · ')
  }

  const familyLabel = activeAddressFamily === 'ipv6' ? 'IPv6 exit' : 'IPv4 exit'

  return location.organization
    ? `${familyLabel} ${activeIp} · ${location.organization}`
    : `${familyLabel} ${activeIp}`
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
