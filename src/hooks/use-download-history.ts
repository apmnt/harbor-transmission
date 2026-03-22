import { useEffect, useMemo, useState } from 'react'

import {
  DownloadHistoryClient,
  type DownloadHistoryResponse,
} from '@/lib/download-history'

const REFRESH_INTERVAL_MS = 30_000

interface DownloadHistoryState {
  data: DownloadHistoryResponse | null
  error: string | null
  isLoading: boolean
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load download history.'
}

export function useDownloadHistory() {
  const client = useMemo(() => new DownloadHistoryClient(), [])
  const [state, setState] = useState<DownloadHistoryState>({
    data: null,
    error: null,
    isLoading: true,
  })

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

    void loadHistory()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [client])

  return state
}
