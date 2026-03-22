import { useCallback, useEffect, useMemo, useState } from 'react'

import { demoSnapshot } from '@/lib/demo-data'
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

function updateDemoTorrent(
  torrent: TransmissionTorrent,
  updater: (torrent: TransmissionTorrent) => TransmissionTorrent,
) {
  return updater({ ...torrent })
}

export function useTransmission() {
  const client = useMemo(() => new TransmissionRpcClient(), [])
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

      try {
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

        setSnapshot((current) => ({
          mode: 'live',
          session,
          stats,
          torrents: parseTorrentTable(torrentsResponse.torrents),
          freeSpace: freeSpace ?? current.freeSpace,
          error: null,
          isLoading: false,
          lastUpdated: new Date().toISOString(),
          hasLiveData: true,
        }))
      } catch (error) {
        const message = getErrorMessage(error)
        setSnapshot((current) => {
          if (current.hasLiveData) {
            return {
              ...current,
              error: message,
              isLoading: false,
              lastUpdated: current.lastUpdated ?? new Date().toISOString(),
            }
          }

          return {
            ...demoSnapshot,
            error: message,
            isLoading: false,
            lastUpdated: new Date().toISOString(),
          }
        })
      }
    },
    [client],
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

  return {
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
