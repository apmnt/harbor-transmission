import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  canSearchCatalog,
  normalizeCatalogSearchQuery,
  type CatalogTorrent,
} from '@/lib/catalog'
import { LocalTorrentCatalogClient } from '@/lib/local-catalog'

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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to query the torrent catalog.'
}

export function useLocalTorrentCatalog() {
  const client = useMemo(() => new LocalTorrentCatalogClient(), [])
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
    if (!query.trim()) {
      setState({
        activeQuery: '',
        error: null,
        hasMore: false,
        hasSearched: false,
        isLoading: false,
        isLoadingMore: false,
        results: [],
      })
    }
  }, [query])

  const search = useCallback(async () => {
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

    try {
      const response = await client.search(normalizedQuery, {
        limit: SEARCH_LIMIT,
        offset: 0,
      })

      setState({
        activeQuery: response.query,
        error: null,
        hasMore: response.hasMore,
        hasSearched: true,
        isLoading: false,
        isLoadingMore: false,
        results: response.results,
      })
    } catch (error) {
      setState({
        activeQuery: normalizedQuery,
        error: getErrorMessage(error),
        hasMore: false,
        hasSearched: true,
        isLoading: false,
        isLoadingMore: false,
        results: [],
      })
    }
  }, [client, query])

  const loadMore = useCallback(async () => {
    const normalizedQuery = state.activeQuery

    if (
      !normalizedQuery ||
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
  }, [client, state.activeQuery, state.hasMore, state.isLoading, state.isLoadingMore, state.results.length])

  return {
    ...state,
    canSearch: canSearchCatalog(query),
    loadMore,
    search,
    query,
    setQuery,
  }
}
