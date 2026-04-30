import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  canSearchCatalog,
  normalizeCatalogSearchQuery,
  TorrentCatalogClient,
  type CatalogTorrent,
} from '@/lib/catalog'

interface TorrentCatalogState {
  activeQuery: string
  error: string | null
  hasMore: boolean
  hasSearched: boolean
  isLoading: boolean
  isLoadingMore: boolean
  results: CatalogTorrent[]
}

const SEARCH_LIMIT = 10
const SEARCH_DEBOUNCE_MS = 140

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to query the torrent catalog.'
}

export function useTorrentCatalog() {
  const client = useMemo(() => new TorrentCatalogClient(), [])
  const [query, setQuery] = useState('')
  const [state, setState] = useState<TorrentCatalogState>({
    activeQuery: '',
    error: null,
    hasMore: false,
    hasSearched: false,
    isLoading: false,
    isLoadingMore: false,
    results: [],
  })

  useEffect(() => {
    const normalizedQuery = normalizeCatalogSearchQuery(query)

    if (!normalizedQuery) {
      setState({
        activeQuery: '',
        error: null,
        hasMore: false,
        hasSearched: false,
        isLoading: false,
        isLoadingMore: false,
        results: [],
      })
      return
    }

    if (!canSearchCatalog(normalizedQuery)) {
      setState({
        activeQuery: normalizedQuery,
        error: null,
        hasMore: false,
        hasSearched: true,
        isLoading: false,
        isLoadingMore: false,
        results: [],
      })
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setState((current) => ({
        ...current,
        activeQuery: normalizedQuery,
        error: null,
        hasMore: false,
        hasSearched: true,
        isLoading: true,
        isLoadingMore: false,
        results: [],
      }))

      void client
        .search(normalizedQuery, {
          limit: SEARCH_LIMIT,
          offset: 0,
          signal: controller.signal,
        })
        .then((response) => {
          setState({
            activeQuery: response.query,
            error: null,
            hasMore: response.hasMore,
            hasSearched: true,
            isLoading: false,
            isLoadingMore: false,
            results: response.results,
          })
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }

          setState({
            activeQuery: normalizedQuery,
            error: getErrorMessage(error),
            hasMore: false,
            hasSearched: true,
            isLoading: false,
            isLoadingMore: false,
            results: [],
          })
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [client, query])

  const loadMore = useCallback(async () => {
    const normalizedQuery = normalizeCatalogSearchQuery(query)

    if (
      !canSearchCatalog(normalizedQuery) ||
      state.isLoading ||
      state.isLoadingMore ||
      !state.hasMore
    ) {
      return
    }

    setState((current) => ({
      ...current,
      error: null,
      isLoadingMore: true,
    }))

    try {
      const response = await client.search(normalizedQuery, {
        limit: SEARCH_LIMIT,
        offset: state.results.length,
      })

      setState((current) => ({
        ...current,
        activeQuery: response.query,
        error: null,
        hasMore: response.hasMore,
        isLoadingMore: false,
        results: [...current.results, ...response.results],
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
        isLoadingMore: false,
      }))
    }
  }, [client, query, state.hasMore, state.isLoading, state.isLoadingMore, state.results.length])

  return {
    ...state,
    canSearch: canSearchCatalog(query),
    loadMore,
    query,
    setQuery,
  }
}
