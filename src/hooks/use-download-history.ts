import { useEffect, useMemo, useRef, useState } from 'react'

import {
  DOWNLOAD_HISTORY_UPDATED_EVENT,
  DownloadHistoryClient,
  type DownloadHistoryPoint,
  getLiveDownloadHistoryResponse,
  type DownloadHistoryResponse,
} from '@/lib/download-history'

const REFRESH_INTERVAL_MS = 30_000
const LIVE_CHART_REFRESH_INTERVAL_MS = 1_000
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

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
  const liveDownloadSpeedRef = useRef(liveDownloadSpeedBps)
  const [state, setState] = useState<DownloadHistoryState>({
    data: null,
    error: null,
    isLoading: true,
  })
  const [livePoints, setLivePoints] = useState<DownloadHistoryPoint[]>([])

  useEffect(() => {
    liveDownloadSpeedRef.current = liveDownloadSpeedBps
  }, [liveDownloadSpeedBps])

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
    if (!isLive) {
      setLivePoints([])
      return
    }

    const appendPoint = () => {
      const nowMs = Date.now()
      const cutoffMs = nowMs - HISTORY_WINDOW_MS
      const lastRecordedAtMs = state.data?.lastRecordedAtMs ?? 0
      const livePoint: DownloadHistoryPoint = {
        timestampMs: nowMs,
        averageDownloadSpeedBps: liveDownloadSpeedRef.current,
        peakDownloadSpeedBps: liveDownloadSpeedRef.current,
        sampleCount: 1,
      }

      setLivePoints((current) => [
        ...current.filter(
          (point) =>
            point.timestampMs > lastRecordedAtMs && point.timestampMs >= cutoffMs,
        ),
        livePoint,
      ])
    }

    appendPoint()

    const intervalId = window.setInterval(() => {
      appendPoint()
    }, LIVE_CHART_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isLive, state.data?.lastRecordedAtMs])

  const chartData = useMemo(
    () =>
      getLiveDownloadHistoryResponse(state.data, {
        livePoints,
      }),
    [livePoints, state.data],
  )

  return {
    ...state,
    chartData,
  }
}
