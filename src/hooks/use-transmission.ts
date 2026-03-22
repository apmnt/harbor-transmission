import { useCallback, useEffect, useMemo, useState } from 'react'

import { getTorrentFileUrl, type CatalogTorrent } from '@/lib/catalog'
import { demoSnapshot } from '@/lib/demo-data'
import {
  MullvadStatusClient,
  unavailableMullvadStatus,
  type MullvadStatus,
} from '@/lib/mullvad'
import {
  getTorrentStateLabel,
  isFinished,
  isPaused,
  parseTorrentTable,
  TransmissionRpcClient,
  TRANSMISSION_STATUS,
  type TransmissionSnapshot,
  type TransmissionTorrent,
} from '@/lib/transmission'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to reach Transmission RPC.'
}

function getUnavailableMullvadSnapshot(error: unknown): MullvadStatus {
  return {
    ...unavailableMullvadStatus,
    error: error instanceof Error ? error.message : unavailableMullvadStatus.error,
  }
}

function updateDemoTorrent(
  torrent: TransmissionTorrent,
  updater: (torrent: TransmissionTorrent) => TransmissionTorrent,
) {
  return updater({ ...torrent })
}

function getNextTorrentId(torrents: TransmissionTorrent[]) {
  return torrents.reduce((maxId, torrent) => Math.max(maxId, torrent.id), 0) + 1
}

function getNextQueuePosition(torrents: TransmissionTorrent[]) {
  return torrents.reduce((maxQueuePosition, torrent) => Math.max(maxQueuePosition, torrent.queue_position), -1) + 1
}

function createDemoCatalogTorrent(
  torrent: CatalogTorrent,
  snapshot: TransmissionSnapshot,
): TransmissionTorrent {
  const now = Math.floor(Date.now() / 1000)
  const totalSize = torrent.sizeBytes ?? 0
  const timestamp = torrent.createdUnix ?? torrent.published ?? now

  return {
    id: getNextTorrentId(snapshot.torrents),
    name: torrent.name,
    status: TRANSMISSION_STATUS.downloadWait,
    error: 0,
    error_string: '',
    eta: -1,
    is_finished: false,
    is_stalled: false,
    labels: ['catalog'],
    left_until_done: totalSize,
    metadata_percent_complete: 1,
    peers_connected: 0,
    peers_getting_from_us: 0,
    peers_sending_to_us: 0,
    percent_done: 0,
    queue_position: getNextQueuePosition(snapshot.torrents),
    rate_download: 0,
    rate_upload: 0,
    recheck_progress: 0,
    seed_ratio_limit: snapshot.session.seed_ratio_limit,
    seed_ratio_mode: snapshot.session.seed_ratio_limited ? 1 : 0,
    size_when_done: totalSize,
    total_size: totalSize,
    trackers: [],
    download_dir: snapshot.session.download_dir,
    uploaded_ever: 0,
    upload_ratio: 0,
    webseeds_sending_to_us: 0,
    added_date: now,
    file_count: 1,
    primary_mime_type: 'application/x-bittorrent',
    hash_string: torrent.infohash,
    magnet_link: `magnet:?xt=urn:btih:${torrent.infohash}`,
    is_private: false,
    comment: 'Added from Harbor catalog',
    creator: 'Harbor',
    date_created: timestamp,
  }
}

async function getTransmissionSnapshot(client: TransmissionRpcClient) {
  const [session, stats, torrentsResponse] = await Promise.all([
    client.getSession(),
    client.getSessionStats(),
    client.getTorrents(),
  ])

  let freeSpace: number | null = null
  try {
    const freeSpaceResponse = await client.getFreeSpace(session.download_dir)
    freeSpace = freeSpaceResponse.size_bytes
  } catch {
    // Keep the previous free-space reading if the daemon skips this response.
  }

  return {
    session,
    stats,
    torrents: parseTorrentTable(torrentsResponse.torrents),
    freeSpace,
  }
}

export function useTransmission() {
  const client = useMemo(() => new TransmissionRpcClient(), [])
  const mullvadClient = useMemo(() => new MullvadStatusClient(), [])
  const [snapshot, setSnapshot] = useState<TransmissionSnapshot>({
    ...demoSnapshot,
    isLoading: true,
  })
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) {
        setSnapshot((current) => ({ ...current, isLoading: true }))
      }

      const [transmissionResult, mullvadResult] = await Promise.allSettled([
        getTransmissionSnapshot(client),
        mullvadClient.getStatus(),
      ])

      const nextMullvad =
        mullvadResult.status === 'fulfilled'
          ? mullvadResult.value
          : getUnavailableMullvadSnapshot(mullvadResult.reason)

      if (transmissionResult.status === 'fulfilled') {
        setSnapshot((current) => ({
          mode: 'live',
          session: transmissionResult.value.session,
          stats: transmissionResult.value.stats,
          torrents: transmissionResult.value.torrents,
          freeSpace: transmissionResult.value.freeSpace ?? current.freeSpace,
          mullvad: nextMullvad,
          error: null,
          isLoading: false,
          lastUpdated: new Date().toISOString(),
          hasLiveData: true,
        }))
        return
      }

      const message = getErrorMessage(transmissionResult.reason)
      setSnapshot((current) => {
        if (current.hasLiveData) {
          return {
            ...current,
            mullvad: nextMullvad,
            error: message,
            isLoading: false,
            lastUpdated: current.lastUpdated ?? new Date().toISOString(),
          }
        }

        return {
          ...demoSnapshot,
          mullvad: nextMullvad,
          error: message,
          isLoading: false,
          lastUpdated: new Date().toISOString(),
        }
      })
    },
    [client, mullvadClient],
  )

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => {
      void refresh(true)
    }, 5000)

    return () => window.clearInterval(interval)
  }, [refresh])

  const mutateDemo = useCallback(
    (label: string, updater: (current: TransmissionSnapshot) => TransmissionSnapshot) => {
      setPendingAction(label)
      window.setTimeout(() => {
        setSnapshot((current) => updater(current))
        setPendingAction(null)
      }, 160)
    },
    [],
  )

  const runAction = useCallback(
    async (
      label: string,
      liveAction: () => Promise<unknown>,
      demoAction: (current: TransmissionSnapshot) => TransmissionSnapshot,
    ) => {
      if (snapshot.mode === 'demo') {
        mutateDemo(label, demoAction)
        return
      }

      try {
        setPendingAction(label)
        await liveAction()
        await refresh(true)
      } catch (error) {
        setSnapshot((current) => ({
          ...current,
          error: getErrorMessage(error),
        }))
      } finally {
        setPendingAction(null)
      }
    },
    [mutateDemo, refresh, snapshot.mode],
  )

  const toggleAltSpeed = useCallback(async () => {
    await runAction(
      'alt-speed',
      () => client.setAltSpeed(!snapshot.session.alt_speed_enabled),
      (current) => ({
        ...current,
        session: {
          ...current.session,
          alt_speed_enabled: !current.session.alt_speed_enabled,
        },
        lastUpdated: new Date().toISOString(),
      }),
    )
  }, [client, runAction, snapshot.session.alt_speed_enabled])

  const startAll = useCallback(async () => {
    await runAction(
      'start-all',
      () => client.startTorrents(snapshot.torrents.map((torrent) => torrent.id)),
      (current) => ({
        ...current,
        torrents: current.torrents.map((torrent) => {
          if (torrent.status === TRANSMISSION_STATUS.stopped) {
            return updateDemoTorrent(torrent, (value) => ({
              ...value,
              status: isFinished(value)
                ? TRANSMISSION_STATUS.seed
                : TRANSMISSION_STATUS.download,
              rate_download: isFinished(value) ? 0 : 2_000_000,
              rate_upload: isFinished(value) ? 420_000 : 180_000,
            }))
          }

          return torrent
        }),
        lastUpdated: new Date().toISOString(),
      }),
    )
  }, [client, runAction, snapshot.torrents])

  const pauseAll = useCallback(async () => {
    await runAction(
      'pause-all',
      () => client.stopTorrents(snapshot.torrents.map((torrent) => torrent.id)),
      (current) => ({
        ...current,
        torrents: current.torrents.map((torrent) => ({
          ...torrent,
          status: TRANSMISSION_STATUS.stopped,
          rate_download: 0,
          rate_upload: 0,
        })),
        lastUpdated: new Date().toISOString(),
      }),
    )
  }, [client, runAction, snapshot.torrents])

  const toggleTorrent = useCallback(
    async (torrent: TransmissionTorrent) => {
      const paused = isPaused(torrent)
      await runAction(
        `torrent-${torrent.id}`,
        () =>
          paused
            ? client.startTorrents([torrent.id])
            : client.stopTorrents([torrent.id]),
        (current) => ({
          ...current,
          torrents: current.torrents.map((value) => {
            if (value.id !== torrent.id) return value

            return updateDemoTorrent(value, (next) => ({
              ...next,
              status: paused
                ? isFinished(next)
                  ? TRANSMISSION_STATUS.seed
                  : TRANSMISSION_STATUS.download
                : TRANSMISSION_STATUS.stopped,
              rate_download: paused && !isFinished(next) ? 1_850_000 : 0,
              rate_upload: paused ? (isFinished(next) ? 520_000 : 120_000) : 0,
              status_message: getTorrentStateLabel(next),
            }))
          }),
          lastUpdated: new Date().toISOString(),
        }),
      )
    },
    [client, runAction],
  )

  const removeTorrent = useCallback(
    async (torrent: TransmissionTorrent) => {
      await runAction(
        `torrent-remove-${torrent.id}`,
        () => client.removeTorrents([torrent.id]),
        (current) => ({
          ...current,
          torrents: current.torrents.filter((value) => value.id !== torrent.id),
          lastUpdated: new Date().toISOString(),
        }),
      )
    },
    [client, runAction],
  )

  const addCatalogTorrent = useCallback(
    async (torrent: CatalogTorrent) => {
      await runAction(
        `catalog-${torrent.infohash}`,
        () => client.addTorrentByUrl(getTorrentFileUrl(torrent.infohash)),
        (current) => {
          if (current.torrents.some((value) => value.hash_string === torrent.infohash)) {
            return {
              ...current,
              lastUpdated: new Date().toISOString(),
            }
          }

          return {
            ...current,
            stats: {
              ...current.stats,
              torrent_count: current.stats.torrent_count + 1,
              current_stats: {
                ...current.stats.current_stats,
                files_added: current.stats.current_stats.files_added + 1,
              },
              cumulative_stats: {
                ...current.stats.cumulative_stats,
                files_added: current.stats.cumulative_stats.files_added + 1,
              },
            },
            torrents: [...current.torrents, createDemoCatalogTorrent(torrent, current)],
            lastUpdated: new Date().toISOString(),
          }
        },
      )
    },
    [client, runAction],
  )

  return {
    addCatalogTorrent,
    snapshot,
    pendingAction,
    refresh: () => refresh(false),
    toggleAltSpeed,
    startAll,
    pauseAll,
    toggleTorrent,
    removeTorrent,
  }
}
