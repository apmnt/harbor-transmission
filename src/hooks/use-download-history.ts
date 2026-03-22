import { useEffect, useMemo, useState } from 'react'

import {
  DOWNLOAD_HISTORY_UPDATED_EVENT,
  DownloadHistoryClient,
  getLiveDownloadHistoryResponse,
  type DownloadHistoryResponse,
} from '@/lib/download-history'

const REFRESH_INTERVAL_MS = 30_000
const LIVE_CHART_REFRESH_INTERVAL_MS = 1_000

interface DownloadHistoryState {
  data: DownloadHistoryResponse | null
  error: string | null
  isLoading: boolean
}

interface UseDownloadHistoryOptions {
  isLive: boolean
  liveDownloadSpeedBps: number
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load download history.'
}

export function useDownloadHistory({
  isLive,
  liveDownloadSpeedBps,
}: UseDownloadHistoryOptions) {
  const client = useMemo(() => new DownloadHistoryClient(), [])
  const [state, setState] = useState<DownloadHistoryState>({
    data: null,
    error: null,
    isLoading: true,
  })
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | undefined

    const loadHistory = async (silent = false) => {
      if (!silent) {
        setState((current) => ({
          ...current,
          isLoading: true,
        }))
      }

      try {
        const data = await client.getLatestWeek()
        if (cancelled) return

        setState({
          data,
          error: null,
          isLoading: false,
        })
      } catch (error) {
        if (cancelled) return

        setState((current) => ({
          data: current.data,
          error: getErrorMessage(error),
          isLoading: false,
        }))
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void loadHistory(true)
          }, REFRESH_INTERVAL_MS)
        }
      }
    }

    const handleHistoryUpdated = () => {
      void loadHistory(true)
    }

    window.addEventListener(DOWNLOAD_HISTORY_UPDATED_EVENT, handleHistoryUpdated)
    void loadHistory()

    return () => {
      cancelled = true
      window.removeEventListener(DOWNLOAD_HISTORY_UPDATED_EVENT, handleHistoryUpdated)
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [client])

  useEffect(() => {
    setNowMs(Date.now())

    if (!isLive) {
      return
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, LIVE_CHART_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isLive])

  const chartData = useMemo(
    () =>
      getLiveDownloadHistoryResponse(state.data, {
        isLive,
        liveDownloadSpeedBps,
        nowMs,
      }),
    [isLive, liveDownloadSpeedBps, nowMs, state.data],
  )

  return {
    ...state,
    chartData,
  }
}
