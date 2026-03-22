import { useEffect, useMemo, useRef, useState } from 'react'

import {
  DownloadHistoryClient,
  type DownloadHistoryPoint,
  type DownloadHistoryResponse,
} from '@/lib/download-history'

const LIVE_CHART_REFRESH_INTERVAL_MS = 1_000
const LIVE_CHART_WINDOW_MS = 5 * 60 * 1000

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
    const abortController = new AbortController()

    const loadHistory = async () => {
      try {
        const data = await client.getLatestWeek({ signal: abortController.signal })
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
      }
    }

    void loadHistory()

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [client])

  useEffect(() => {
    if (!isLive) {
      return
    }

    const appendPoint = () => {
      const nowMs = Date.now()
      const livePoint: DownloadHistoryPoint = {
        timestampMs: nowMs,
        averageDownloadSpeedBps: liveDownloadSpeedRef.current,
        peakDownloadSpeedBps: liveDownloadSpeedRef.current,
        sampleCount: 1,
      }

      setLivePoints((current) => [
        ...current.filter((point) => point.timestampMs >= nowMs - LIVE_CHART_WINDOW_MS),
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
  }, [isLive])

  const liveData = useMemo<DownloadHistoryResponse | null>(() => {
    if (livePoints.length === 0) {
      return null
    }

    const rangeEndMs = livePoints.at(-1)?.timestampMs ?? 0

    return {
      points: livePoints,
      bucketMs: LIVE_CHART_REFRESH_INTERVAL_MS,
      capturedEveryMs: LIVE_CHART_REFRESH_INTERVAL_MS,
      rangeStartMs: rangeEndMs - LIVE_CHART_WINDOW_MS,
      rangeEndMs,
      lastRecordedAtMs: null,
    }
  }, [livePoints])

  return {
    ...state,
    liveData,
  }
}
