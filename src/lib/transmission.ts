import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatRatio,
  formatSpeedBps,
} from '@/lib/formatters'
import type { MullvadStatus } from '@/lib/mullvad'

export const TRANSMISSION_STATUS = {
  stopped: 0,
  checkWait: 1,
  check: 2,
  downloadWait: 3,
  download: 4,
  seedWait: 5,
  seed: 6,
} as const

const JSON_RPC_VERSION = '2.0'
const SESSION_HEADER = 'X-Transmission-Session-Id'

export type TransmissionStatusCode =
  (typeof TRANSMISSION_STATUS)[keyof typeof TRANSMISSION_STATUS]

export type TorrentFilter =
  | 'all'
  | 'active'
  | 'downloading'
  | 'seeding'
  | 'queued'
  | 'paused'
  | 'finished'
  | 'error'

export type SortMode = 'queue' | 'activity' | 'progress' | 'ratio' | 'name'

export interface TransmissionTracker {
  announce: string
}

export interface TransmissionTorrentInfo {
  id: number
  name: string
  hash_string: string
}

export interface TransmissionTorrentAddResponse {
  torrent_added?: TransmissionTorrentInfo
  torrent_duplicate?: TransmissionTorrentInfo
  'torrent-added'?: TransmissionTorrentInfo
  'torrent-duplicate'?: TransmissionTorrentInfo
}

export interface TransmissionTorrent {
  id: number
  name: string
  status: TransmissionStatusCode
  error: number
  error_string: string
  eta: number
  is_finished: boolean
  is_stalled: boolean
  labels: string[]
  left_until_done: number
  metadata_percent_complete: number
  peers_connected: number
  peers_getting_from_us: number
  peers_sending_to_us: number
  percent_done: number
  queue_position: number
  rate_download: number
  rate_upload: number
  recheck_progress: number
  seed_ratio_limit: number
  seed_ratio_mode: number
  size_when_done: number
  status_message?: string
  total_size: number
  trackers: TransmissionTracker[]
  download_dir: string
  uploaded_ever: number
  upload_ratio: number
  webseeds_sending_to_us: number
  added_date: number
  file_count: number
  primary_mime_type: string
  activity_date?: number
  downloaded_ever?: number
  hash_string?: string
  magnet_link?: string
  is_private?: boolean
  piece_count?: number
  piece_size?: number
  comment?: string
  creator?: string
  date_created?: number
}

export interface SessionStatBucket {
  downloaded_bytes: number
  files_added: number
  seconds_active: number
  session_count: number
  uploaded_bytes: number
}

export interface TransmissionSessionStats {
  active_torrent_count: number
  download_speed: number
  paused_torrent_count: number
  torrent_count: number
  upload_speed: number
  cumulative_stats: SessionStatBucket
  current_stats: SessionStatBucket
}

export interface TransmissionSession {
  version: string
  download_dir: string
  alt_speed_enabled: boolean
  alt_speed_up: number
  alt_speed_down: number
  speed_limit_up: number
  speed_limit_up_enabled: boolean
  speed_limit_down: number
  speed_limit_down_enabled: boolean
  seed_ratio_limit: number
  seed_ratio_limited: boolean
  peer_limit_per_torrent: number
  download_queue_enabled: boolean
  download_queue_size: number
  seed_queue_enabled: boolean
  seed_queue_size: number
  peer_port?: number
  port_is_open?: boolean
  pex_enabled?: boolean
  dht_enabled?: boolean
  lpd_enabled?: boolean
  utp_enabled?: boolean
  'rpc-version'?: number
  start_added_torrents?: boolean
}

export interface TransmissionSnapshot {
  mode: 'live' | 'demo'
  session: TransmissionSession
  stats: TransmissionSessionStats
  torrents: TransmissionTorrent[]
  freeSpace: number
  mullvad: MullvadStatus
  error: string | null
  isLoading: boolean
  lastUpdated: string | null
  hasLiveData: boolean
}

export const TORRENT_FIELDS = [
  'id',
  'added_date',
  'activity_date',
  'comment',
  'creator',
  'date_created',
  'download_dir',
  'downloaded_ever',
  'error',
  'error_string',
  'eta',
  'file_count',
  'hash_string',
  'is_finished',
  'is_private',
  'is_stalled',
  'labels',
  'left_until_done',
  'magnet_link',
  'metadata_percent_complete',
  'name',
  'peers_connected',
  'peers_getting_from_us',
  'peers_sending_to_us',
  'percent_done',
  'piece_count',
  'piece_size',
  'primary_mime_type',
  'queue_position',
  'rate_download',
  'rate_upload',
  'recheck_progress',
  'seed_ratio_limit',
  'seed_ratio_mode',
  'size_when_done',
  'status',
  'total_size',
  'trackers',
  'uploaded_ever',
  'upload_ratio',
  'webseeds_sending_to_us',
] as const

export class TransmissionRpcClient {
  private endpoint: string
  private sessionId = ''

  constructor(endpoint = import.meta.env.VITE_TRANSMISSION_RPC_URL ?? '/transmission/rpc') {
    this.endpoint = endpoint
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const headers = new Headers({
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      pragma: 'no-cache',
    })

    if (this.sessionId) {
      headers.append(SESSION_HEADER, this.sessionId)
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: 'tmanager',
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
      }),
      credentials: 'include',
    })

    if (response.status === 409) {
      const nextSessionId = response.headers.get(SESSION_HEADER)
      if (!nextSessionId) {
        throw new Error('Transmission RPC rejected the request without a session id.')
      }

      this.sessionId = nextSessionId
      return this.request<T>(method, params)
    }

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Transmission RPC request failed with ${response.status}.`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const payload = (await response.json()) as {
      error?: { code?: number; message?: string; data?: { result?: T } }
      result?: T
    }

    if (payload.error && payload.error.message) {
      throw new Error(payload.error.message)
    }

    if (payload.result !== undefined) {
      return payload.result
    }

    if (payload.error?.data?.result !== undefined) {
      return payload.error.data.result
    }

    throw new Error('Transmission RPC returned an empty payload.')
  }

  async getSession() {
    return this.request<TransmissionSession>('session_get')
  }

  async getSessionStats() {
    return this.request<TransmissionSessionStats>('session_stats')
  }

  async getTorrents(ids?: number[] | 'recently-active') {
    return this.request<{ removed?: number[]; torrents: unknown[][] }>('torrent_get', {
      fields: [...TORRENT_FIELDS],
      format: 'table',
      ...(ids ? { ids } : {}),
    })
  }

  async getFreeSpace(path: string) {
    return this.request<{ path: string; size_bytes: number }>('free_space', { path })
  }

  async startTorrents(ids: number[], bypassQueue = false) {
    return this.request(
      bypassQueue ? 'torrent_start_now' : 'torrent_start',
      ids.length > 0 ? { ids } : undefined,
    )
  }

  async stopTorrents(ids: number[]) {
    return this.request('torrent_stop', ids.length > 0 ? { ids } : undefined)
  }

  async removeTorrents(ids: number[], deleteLocalData = false) {
    return this.request('torrent_remove', ids.length > 0 ? { ids, delete_local_data: deleteLocalData } : undefined)
  }

  async addTorrentByUrl(
    url: string,
    options: {
      downloadDir?: string
      paused?: boolean
    } = {},
  ) {
    return this.request<TransmissionTorrentAddResponse>('torrent_add', {
      filename: url,
      paused: options.paused,
      ...(options.downloadDir ? { download_dir: options.downloadDir } : {}),
    })
  }

  async setAltSpeed(enabled: boolean) {
    return this.request('session_set', { alt_speed_enabled: enabled })
  }
}

export function parseTorrentTable(table: unknown[][]): TransmissionTorrent[] {
  const [keys, ...rows] = table as [string[], ...unknown[][]]

  if (!keys) {
    return []
  }

  return rows.map((row) => {
    const entries = keys.map((key, index) => [key, row[index]])
    return Object.fromEntries(entries) as TransmissionTorrent
  })
}

export function getAddedTorrentInfo(response?: TransmissionTorrentAddResponse) {
  return response?.torrent_added ?? response?.['torrent-added'] ?? null
}

export function getDuplicateTorrentInfo(response?: TransmissionTorrentAddResponse) {
  return response?.torrent_duplicate ?? response?.['torrent-duplicate'] ?? null
}

export function isDownloading(torrent: TransmissionTorrent) {
  return torrent.status === TRANSMISSION_STATUS.download
}

export function isSeeding(torrent: TransmissionTorrent) {
  return torrent.status === TRANSMISSION_STATUS.seed
}

export function isChecking(torrent: TransmissionTorrent) {
  return torrent.status === TRANSMISSION_STATUS.check
}

export function isQueued(torrent: TransmissionTorrent) {
  return (
    torrent.status === TRANSMISSION_STATUS.downloadWait ||
    torrent.status === TRANSMISSION_STATUS.seedWait
  )
}

export function isPaused(torrent: TransmissionTorrent) {
  return torrent.status === TRANSMISSION_STATUS.stopped
}

export function isFinished(torrent: TransmissionTorrent) {
  return torrent.left_until_done < 1
}

export function needsMetadata(torrent: TransmissionTorrent) {
  return torrent.metadata_percent_complete < 1
}

export function getTorrentStateLabel(torrent: TransmissionTorrent) {
  if (needsMetadata(torrent)) {
    return isPaused(torrent) ? 'Needs metadata' : 'Retrieving metadata'
  }

  switch (torrent.status) {
    case TRANSMISSION_STATUS.stopped:
      return torrent.is_finished ? 'Seeding complete' : 'Paused'
    case TRANSMISSION_STATUS.checkWait:
      return 'Queued for verification'
    case TRANSMISSION_STATUS.check:
      return 'Verifying local data'
    case TRANSMISSION_STATUS.downloadWait:
      return 'Queued for download'
    case TRANSMISSION_STATUS.download:
      return 'Downloading'
    case TRANSMISSION_STATUS.seedWait:
      return 'Queued for seeding'
    case TRANSMISSION_STATUS.seed:
      return 'Seeding'
    default:
      return 'Error'
  }
}

export function getTorrentErrorMessage(torrent: TransmissionTorrent) {
  switch (torrent.error) {
    case 1:
      return `Tracker warning: ${torrent.error_string}`
    case 2:
      return `Tracker error: ${torrent.error_string}`
    case 3:
      return `Local error: ${torrent.error_string}`
    default:
      return null
  }
}

export function getTorrentProgressPercent(torrent: TransmissionTorrent) {
  if (needsMetadata(torrent)) {
    return torrent.metadata_percent_complete * 100
  }

  return torrent.percent_done * 100
}

export function getTorrentProgressLabel(torrent: TransmissionTorrent) {
  if (needsMetadata(torrent)) {
    const verb = isPaused(torrent) ? 'Needs' : 'Retrieving'
    return `Magnet transfer · ${verb.toLowerCase()} metadata (${formatPercent(
      torrent.metadata_percent_complete * 100,
    )}%)`
  }

  if (isFinished(torrent) || isSeeding(torrent)) {
    if (torrent.total_size === torrent.size_when_done) {
      return `${formatBytes(torrent.total_size)} complete · Uploaded ${formatBytes(
        torrent.uploaded_ever,
      )} · Ratio ${formatRatio(torrent.upload_ratio)}`
    }

    return `${formatBytes(torrent.size_when_done)} of ${formatBytes(
      torrent.total_size,
    )} · Uploaded ${formatBytes(torrent.uploaded_ever)}`
  }

  return `${formatBytes(torrent.size_when_done - torrent.left_until_done)} of ${formatBytes(
    torrent.size_when_done,
  )} (${formatPercent(torrent.percent_done * 100)}%)`
}

export function getTorrentEtaLabel(torrent: TransmissionTorrent) {
  if (isPaused(torrent) || isChecking(torrent)) {
    return getTorrentStateLabel(torrent)
  }

  if (torrent.eta < 0 || torrent.eta >= 999 * 60 * 60) {
    return 'ETA unknown'
  }

  return `${formatDuration(torrent.eta, 1)} remaining`
}

export function getTorrentPeerLabel(torrent: TransmissionTorrent) {
  const error = getTorrentErrorMessage(torrent)
  if (error) {
    return error
  }

  if (needsMetadata(torrent)) {
    const peers = torrent.peers_connected
    const webSeeds = torrent.webseeds_sending_to_us
    const sources: string[] = []

    if (peers > 0) {
      sources.push(`${torrent.peers_sending_to_us}/${peers} peers`)
    }
    if (webSeeds > 0) {
      sources.push(`${webSeeds} web seeds`)
    }

    return `${sources.length > 0 ? `Retrieving metadata from ${sources.join(' + ')}` : 'Waiting for metadata peers'} · Down ${formatSpeedBps(
      torrent.rate_download,
    )} · Up ${formatSpeedBps(torrent.rate_upload)}`
  }

  if (isDownloading(torrent)) {
    const peers = torrent.peers_connected
    const webSeeds = torrent.webseeds_sending_to_us
    const sources: string[] = []

    if (peers > 0) {
      sources.push(`${torrent.peers_sending_to_us}/${peers} peers`)
    }
    if (webSeeds > 0) {
      sources.push(`${webSeeds} web seeds`)
    }

    return `Downloading from ${sources.join(' + ') || 'idle sources'} · Down ${formatSpeedBps(
      torrent.rate_download,
    )} · Up ${formatSpeedBps(torrent.rate_upload)}`
  }

  if (isSeeding(torrent)) {
    return `Seeding to ${torrent.peers_getting_from_us}/${torrent.peers_connected} peers · Up ${formatSpeedBps(
      torrent.rate_upload,
    )}`
  }

  if (isChecking(torrent)) {
    return `Verifying local data (${formatPercent(torrent.recheck_progress * 100)}% tested)`
  }

  return getTorrentStateLabel(torrent)
}

export function getTorrentStatusTone(torrent: TransmissionTorrent) {
  if (torrent.error > 0) return 'destructive' as const
  if (needsMetadata(torrent)) return 'secondary' as const
  if (isDownloading(torrent) || isSeeding(torrent)) return 'default' as const
  if (isQueued(torrent) || isChecking(torrent)) return 'secondary' as const
  return 'outline' as const
}

export function torrentMatchesFilter(torrent: TransmissionTorrent, filter: TorrentFilter) {
  switch (filter) {
    case 'active':
      return (
        torrent.peers_getting_from_us > 0 ||
        torrent.peers_sending_to_us > 0 ||
        torrent.webseeds_sending_to_us > 0 ||
        isChecking(torrent)
      )
    case 'downloading':
      return (
        torrent.status === TRANSMISSION_STATUS.download ||
        torrent.status === TRANSMISSION_STATUS.downloadWait
      )
    case 'seeding':
      return (
        torrent.status === TRANSMISSION_STATUS.seed ||
        torrent.status === TRANSMISSION_STATUS.seedWait
      )
    case 'queued':
      return isQueued(torrent)
    case 'paused':
      return isPaused(torrent)
    case 'finished':
      return torrent.is_finished
    case 'error':
      return torrent.error > 0
    default:
      return true
  }
}

export function sortTorrents(torrents: TransmissionTorrent[], sortMode: SortMode) {
  const sorted = [...torrents]

  sorted.sort((left, right) => {
    switch (sortMode) {
      case 'activity':
        return right.rate_download + right.rate_upload - (left.rate_download + left.rate_upload)
      case 'progress':
        return left.percent_done - right.percent_done
      case 'ratio':
        return right.upload_ratio - left.upload_ratio
      case 'name':
        return left.name.localeCompare(right.name) || left.id - right.id
      case 'queue':
      default:
        return left.queue_position - right.queue_position
    }
  })

  return sorted
}

export function getFilterCounts(torrents: TransmissionTorrent[]) {
  const filters: TorrentFilter[] = [
    'all',
    'active',
    'downloading',
    'seeding',
    'queued',
    'paused',
    'finished',
    'error',
  ]

  return Object.fromEntries(
    filters.map((filter) => [
      filter,
      filter === 'all'
        ? torrents.length
        : torrents.filter((torrent) => torrentMatchesFilter(torrent, filter)).length,
    ]),
  ) as Record<TorrentFilter, number>
}

export function getTrackerHosts(torrent: TransmissionTorrent) {
  return Array.from(
    new Set(
      torrent.trackers
        .map(({ announce }) => {
          try {
            return new URL(announce).hostname.replace(/^www\./, '')
          } catch {
            return announce
          }
        })
        .filter(Boolean),
    ),
  )
}

export function getTorrentSearchText(torrent: TransmissionTorrent) {
  return [torrent.name, ...torrent.labels, ...getTrackerHosts(torrent)].join(' ').toLowerCase()
}
