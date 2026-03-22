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
