export interface DownloadHistoryPoint {
  timestampMs: number
  averageDownloadSpeedBps: number
  peakDownloadSpeedBps: number
  sampleCount: number
}

export interface DownloadHistoryResponse {
  points: DownloadHistoryPoint[]
  bucketMs: number
  capturedEveryMs: number
  rangeStartMs: number
  rangeEndMs: number
  lastRecordedAtMs: number | null
}

interface LiveDownloadHistoryOptions {
  livePoints: DownloadHistoryPoint[]
}

export const DOWNLOAD_HISTORY_UPDATED_EVENT = 'harbor:download-history-updated'

export function notifyDownloadHistoryUpdated() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(DOWNLOAD_HISTORY_UPDATED_EVENT))
}

export function getLiveDownloadHistoryResponse(
  data: DownloadHistoryResponse | null,
  { livePoints }: LiveDownloadHistoryOptions,
) {
  if (!data && livePoints.length === 0) {
    return null
  }

  if (!data) {
    const rangeEndMs = livePoints.at(-1)?.timestampMs ?? Date.now()

    return {
      points: livePoints,
      bucketMs: 1_000,
      capturedEveryMs: 1_000,
      rangeStartMs: rangeEndMs - 7 * 24 * 60 * 60 * 1000,
      rangeEndMs,
      lastRecordedAtMs: null,
    }
  }

  if (livePoints.length === 0) {
    return data
  }

  return {
    ...data,
    points: [...data.points, ...livePoints],
    rangeEndMs: Math.max(data.rangeEndMs, livePoints.at(-1)?.timestampMs ?? data.rangeEndMs),
  }
}

export class DownloadHistoryClient {
  private endpoint: string

  constructor(endpoint = '/api/history/download-speed') {
    this.endpoint = endpoint
  }

  async getLatestWeek(options: { signal?: AbortSignal } = {}) {
    const response = await fetch(this.endpoint, {
      headers: {
        'cache-control': 'no-cache',
      },
      credentials: 'include',
      signal: options.signal,
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Download history request failed with ${response.status}.`)
    }

    return (await response.json()) as DownloadHistoryResponse
  }

  async recordSample(
    sample: { downloadSpeedBps: number; uploadSpeedBps: number },
    options: { signal?: AbortSignal } = {},
  ) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'cache-control': 'no-cache',
        'content-type': 'application/json',
      },
      credentials: 'include',
      signal: options.signal,
      body: JSON.stringify(sample),
    })

    if (!response.ok && response.status !== 204) {
      const message = await response.text()
      throw new Error(message || `Download history sample failed with ${response.status}.`)
    }
  }
}
