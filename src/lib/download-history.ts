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
}
