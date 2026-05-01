import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronDown,
  Copy,
  FolderOpen,
  Gauge,
  HardDriveDownload,
  Layers3,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
  Trash2,
  Wifi,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HalftoneTransition } from "@/components/halftone-transition";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useDownloadHistory } from "@/hooks/use-download-history";
import { useLocalTorrentCatalog } from "@/hooks/use-local-torrent-catalog";
import { useTorrentCatalog } from "@/hooks/use-torrent-catalog";
import { useTransmission } from "@/hooks/use-transmission";
import type { DownloadHistoryResponse } from "@/lib/download-history";
import type { CatalogTorrent } from "@/lib/catalog";
import {
  getMullvadLocationLabel,
  getMullvadServerLabel,
  getMullvadStateLabel,
  getMullvadStatusTone,
  getMullvadSummary,
  getMullvadUsageLabel,
  type MullvadStatus,
} from "@/lib/mullvad";
import {
  getFilterCounts,
  getTorrentEtaLabel,
  getTorrentPeerLabel,
  getTorrentProgressLabel,
  getTorrentProgressPercent,
  getTorrentSearchText,
  getTorrentStateLabel,
  getTorrentStatusTone,
  getTrackerHosts,
  isPaused,
  isQueued,
  isSeeding,
  sortTorrents,
  torrentMatchesFilter,
  type SortMode,
  type TorrentFilter,
  type TransmissionTorrent,
} from "@/lib/transmission";
import {
  formatBytes,
  formatCompact,
  formatDuration,
  formatRatio,
  formatSpeedBps,
  formatTimestamp,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const filters: { label: string; value: TorrentFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Downloading", value: "downloading" },
  { label: "Seeding", value: "seeding" },
  { label: "Queued", value: "queued" },
  { label: "Paused", value: "paused" },
  { label: "Finished", value: "finished" },
  { label: "Error", value: "error" },
];

const sortOptions: { label: string; value: SortMode }[] = [
  { label: "Queue", value: "queue" },
  { label: "Activity", value: "activity" },
  { label: "Progress", value: "progress" },
  { label: "Ratio", value: "ratio" },
  { label: "Name", value: "name" },
];

function App() {
  const {
    addCatalogTorrent,
    pauseAll,
    pendingAction,
    refresh,
    removeSeedingTorrents,
    removeTorrent,
    snapshot,
    startAll,
    toggleTorrent,
  } = useTransmission();
  const isLiveConnection =
    snapshot.mode === "live" && snapshot.error === null && snapshot.hasLiveData;
  const downloadHistory = useDownloadHistory({
    isLive: isLiveConnection,
    liveDownloadSpeedBps: snapshot.stats.download_speed,
  });
  const prowlarrCatalog = useTorrentCatalog();
  const localCatalog = useLocalTorrentCatalog();
  const [filter, setFilter] = useState<TorrentFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("queue");
  const [query, setQuery] = useState("");
  const [expandedTorrentId, setExpandedTorrentId] = useState<number | null>(
    null,
  );
  const [copiedTorrentId, setCopiedTorrentId] = useState<number | null>(null);

  const counts = useMemo(
    () => getFilterCounts(snapshot.torrents),
    [snapshot.torrents],
  );

  const visibleTorrents = useMemo(() => {
    const search = query.trim().toLowerCase();

    return sortTorrents(
      snapshot.torrents.filter((torrent) => {
        if (!torrentMatchesFilter(torrent, filter)) return false;
        if (!search) return true;
        return getTorrentSearchText(torrent).includes(search);
      }),
      sortMode,
    );
  }, [filter, query, snapshot.torrents, sortMode]);

  useEffect(() => {
    if (!copiedTorrentId) return undefined;
    const timeout = window.setTimeout(() => setCopiedTorrentId(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [copiedTorrentId]);

  const currentRatio =
    snapshot.stats.current_stats.downloaded_bytes > 0
      ? snapshot.stats.current_stats.uploaded_bytes /
        snapshot.stats.current_stats.downloaded_bytes
      : 0;

  const totalRatio =
    snapshot.stats.cumulative_stats.downloaded_bytes > 0
      ? snapshot.stats.cumulative_stats.uploaded_bytes /
        snapshot.stats.cumulative_stats.downloaded_bytes
      : 0;

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HeroBand
        currentMode={snapshot.mode}
        downloadSpeed={snapshot.stats.download_speed}
        freeSpace={snapshot.freeSpace}
        isLoading={snapshot.isLoading}
        lastUpdated={snapshot.lastUpdated}
        mullvad={snapshot.mullvad}
        onPauseAll={pauseAll}
        onRefresh={refresh}
        onRemoveSeeding={removeSeedingTorrents}
        onStartAll={startAll}
        pendingAction={pendingAction}
        seedingCount={snapshot.torrents.filter((torrent) => isSeeding(torrent)).length}
        torrentCount={snapshot.torrents.length}
        uploadSpeed={snapshot.stats.upload_speed}
        version={snapshot.session.version}
      />

      <CatalogSection
        activeQuery={localCatalog.activeQuery}
        canSearch={localCatalog.canSearch}
        description="Search the local torrents-csv mirror and add matching magnet links to Transmission."
        emptyBody="Try a broader title fragment or paste the exact infohash."
        emptyTitle="No local catalog matches found."
        error={localCatalog.error}
        hasMore={localCatalog.hasMore}
        hasSearched={localCatalog.hasSearched}
        isLoading={localCatalog.isLoading}
        isLoadingMore={localCatalog.isLoadingMore}
        loadMoreLabel="Load more local matches"
        loadingBody="DuckDB is scanning the local torrents-csv dataset for strong matches."
        loadingTitle="Searching local catalog."
        onAddTorrent={addCatalogTorrent}
        onLoadMore={localCatalog.loadMore}
        onQueryChange={localCatalog.setQuery}
        onSearch={localCatalog.search}
        pendingAction={pendingAction}
        query={localCatalog.query}
        results={localCatalog.results}
        title="torrents-csv Search"
      />

      <CatalogSection
        activeQuery={prowlarrCatalog.activeQuery}
        canSearch={prowlarrCatalog.canSearch}
        description="Search torrents from your Prowlarr indexers and add matching releases to Transmission."
        emptyBody="Try a different search term or broader title fragment."
        emptyTitle="No Prowlarr results found."
        error={prowlarrCatalog.error}
        hasMore={prowlarrCatalog.hasMore}
        hasSearched={prowlarrCatalog.hasSearched}
        isLoading={prowlarrCatalog.isLoading}
        isLoadingMore={prowlarrCatalog.isLoadingMore}
        loadMoreLabel="Load more from Prowlarr"
        loadingBody="Looking for available torrents from your indexers."
        loadingTitle="Searching Prowlarr."
        onAddTorrent={addCatalogTorrent}
        onLoadMore={prowlarrCatalog.loadMore}
        onQueryChange={prowlarrCatalog.setQuery}
        onSearch={prowlarrCatalog.search}
        pendingAction={pendingAction}
        query={prowlarrCatalog.query}
        results={prowlarrCatalog.results}
        title="Prowlarr Search"
      />

      <DownloadHistorySection
        data={downloadHistory.data}
        error={downloadHistory.error}
        liveChartCeilingBps={downloadHistory.liveChartCeilingBps}
        isLoading={downloadHistory.isLoading}
        isLive={isLiveConnection}
        liveData={downloadHistory.liveData}
      />

      <QueueSection
        copiedTorrentId={copiedTorrentId}
        counts={counts}
        expandedTorrentId={expandedTorrentId}
        filter={filter}
        onCopyMagnet={setCopiedTorrentId}
        onExpand={setExpandedTorrentId}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onRefresh={refresh}
        onRemoveTorrent={removeTorrent}
        onSortChange={setSortMode}
        onToggleTorrent={toggleTorrent}
        pendingAction={pendingAction}
        query={query}
        sortMode={sortMode}
        snapshotError={snapshot.error}
        torrents={visibleTorrents}
      />

      <SessionSection
        currentRatio={currentRatio}
        freeSpace={snapshot.freeSpace}
        mullvad={snapshot.mullvad}
        session={snapshot.session}
        stats={snapshot.stats}
        totalRatio={totalRatio}
      />
    </div>
  );
}

const downloadHistoryChartConfig = {
  averageDownloadSpeedBps: {
    color: "oklch(0.57 0 0)",
    label: "Weekly average",
  },
} satisfies ChartConfig;

const liveDownloadChartConfig = {
  averageDownloadSpeedBps: {
    color: "oklch(0.72 0.17 154)",
    label: "Live download",
  },
} satisfies ChartConfig;

const LIVE_CHART_EASING_MS = 220;
const LIVE_CHART_WINDOW_MS = 5 * 60 * 1000;
const DEMO_LIVE_CHART_WINDOW_MS = 5 * 60 * 1000;
const DEMO_LIVE_CHART_STEP_MS = 1_000;

function getSyntheticDownloadSpeedBps(timestampMs: number) {
  const slowWave = Math.sin(timestampMs / 31_000);
  const midWave = Math.sin(timestampMs / 11_000 + 1.7);
  const fastWave = Math.cos(timestampMs / 4_500 - 0.8);
  const pulse = Math.max(0, Math.sin(timestampMs / 19_000 - 0.6));

  return Math.max(
    96 * 1024,
    1_600_000 +
      slowWave * 900_000 +
      midWave * 450_000 +
      fastWave * 140_000 +
      pulse * 700_000,
  );
}

function buildSyntheticLiveChart(nowMs: number): DownloadHistoryResponse {
  const rangeEndMs = nowMs;
  const rangeStartMs = rangeEndMs - DEMO_LIVE_CHART_WINDOW_MS;
  const points: DownloadHistoryResponse["points"] = [];

  for (
    let timestampMs = rangeStartMs;
    timestampMs <= rangeEndMs;
    timestampMs += DEMO_LIVE_CHART_STEP_MS
  ) {
    const speedBps = getSyntheticDownloadSpeedBps(timestampMs);

    points.push({
      timestampMs,
      averageDownloadSpeedBps: speedBps,
      peakDownloadSpeedBps: speedBps,
      sampleCount: 1,
    });
  }

  return {
    points,
    bucketMs: DEMO_LIVE_CHART_STEP_MS,
    capturedEveryMs: DEMO_LIVE_CHART_STEP_MS,
    rangeStartMs,
    rangeEndMs,
    lastRecordedAtMs: null,
  };
}

function useAnimatedLiveChart({
  isLive,
  liveData,
}: {
  isLive: boolean;
  liveData: DownloadHistoryResponse | null;
}) {
  const latestPoint = liveData?.points.at(-1) ?? null;
  const animatedSpeedRef = useRef(0);
  const targetSpeedRef = useRef(0);
  const hasSeededAnimationRef = useRef(false);
  const [frame, setFrame] = useState(() => ({
    nowMs: Date.now(),
    speedBps: 0,
  }));

  useEffect(() => {
    if (!latestPoint) {
      animatedSpeedRef.current = 0;
      targetSpeedRef.current = 0;
      hasSeededAnimationRef.current = false;
      return;
    }

    targetSpeedRef.current = latestPoint.averageDownloadSpeedBps;

    if (!hasSeededAnimationRef.current) {
      animatedSpeedRef.current = latestPoint.averageDownloadSpeedBps;
      hasSeededAnimationRef.current = true;
    }
  }, [latestPoint]);

  useEffect(() => {
    let animationFrameId = 0;
    let previousFrameMs = performance.now();

    const tick = (frameMs: number) => {
      const deltaMs = Math.min(frameMs - previousFrameMs, 64);
      previousFrameMs = frameMs;
      const nowMs = Date.now();
      let nextSpeedBps = animatedSpeedRef.current;

      if (isLive && latestPoint) {
        const smoothingFactor = 1 - Math.exp(-deltaMs / LIVE_CHART_EASING_MS);
        nextSpeedBps =
          animatedSpeedRef.current +
          (targetSpeedRef.current - animatedSpeedRef.current) * smoothingFactor;

        animatedSpeedRef.current = nextSpeedBps;
      } else if (!isLive) {
        nextSpeedBps = getSyntheticDownloadSpeedBps(nowMs);
      }

      setFrame({
        nowMs,
        speedBps: nextSpeedBps,
      });

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isLive, latestPoint]);

  return useMemo<DownloadHistoryResponse | null>(() => {
    if (!isLive) {
      return buildSyntheticLiveChart(frame.nowMs);
    }

    if (!liveData || liveData.points.length === 0) {
      return null;
    }

    if (frame.nowMs === 0) {
      return liveData;
    }

    const rangeEndMs = frame.nowMs;
    const rangeStartMs = rangeEndMs - LIVE_CHART_WINDOW_MS;
    const stablePoints = liveData.points.length > 1 ? liveData.points.slice(0, -1) : [];
    const visiblePoints = stablePoints.filter(
      (point) => point.timestampMs >= rangeStartMs,
    );
    const tailPoint: DownloadHistoryResponse["points"][number] = {
      timestampMs: rangeEndMs,
      averageDownloadSpeedBps: frame.speedBps,
      peakDownloadSpeedBps: frame.speedBps,
      sampleCount: 1,
    };

    return {
      ...liveData,
      points: [...visiblePoints, tailPoint],
      rangeStartMs,
      rangeEndMs,
    };
  }, [frame.nowMs, frame.speedBps, isLive, liveData]);
}

function DownloadHistorySection({
  data,
  error,
  liveChartCeilingBps,
  isLoading,
  isLive,
  liveData,
}: {
  data: DownloadHistoryResponse | null;
  error: string | null;
  liveChartCeilingBps: number;
  isLoading: boolean;
  isLive: boolean;
  liveData: DownloadHistoryResponse | null;
}) {
  const points = data?.points ?? [];
  const latestPoint = points.at(-1) ?? null;
  const weeklyChartDomain = getChartTimeDomain(points, data?.bucketMs ?? 60_000);
  const animatedLiveData = useAnimatedLiveChart({ isLive, liveData });
  const liveChartRangeEndMs = animatedLiveData?.rangeEndMs ?? 0;
  const liveChartRangeStartMs = liveChartRangeEndMs - LIVE_CHART_WINDOW_MS;
  const liveChartTicks = useMemo(
    () => getMinuteAxisTicks(liveChartRangeStartMs, liveChartRangeEndMs),
    [liveChartRangeEndMs, liveChartRangeStartMs],
  );
  const averageSpeed =
    points.length > 0
      ? points.reduce(
          (sum, point) => sum + point.averageDownloadSpeedBps,
          0,
        ) / points.length
      : 0;
  const peakSpeed =
    points.length > 0
      ? Math.max(...points.map((point) => point.peakDownloadSpeedBps))
      : 0;
  const lastHourCutoffMs =
    (data?.rangeEndMs ?? liveData?.rangeEndMs ?? 0) - 60 * 60 * 1000;
  const lastHourPoints = (points.length > 0 ? points : liveData?.points ?? []).filter(
    (point) => point.timestampMs >= lastHourCutoffMs,
  );
  const lastHourAverageSpeed =
    lastHourPoints.length > 0
      ? lastHourPoints.reduce(
          (sum, point) => sum + point.averageDownloadSpeedBps,
          0,
        ) / lastHourPoints.length
      : 0;
  const lastRecordedAgeLabel = data?.lastRecordedAtMs
    ? formatHistoryAgeLabel(data.lastRecordedAtMs)
    : "No samples yet";

  const liveYAxisDomain =
    liveChartCeilingBps > 0
      ? ([0, liveChartCeilingBps] as [number, number])
      : undefined;

  return (
    <section className="w-full border-b border-border bg-background">
      <div className="w-full min-w-0 px-3 py-4 sm:px-5 lg:px-6">
        <div className="space-y-1">
          <h2 className="font-display text-2xl tracking-[-0.06em] text-foreground">
            Download history
          </h2>
          <p className="text-sm text-muted-foreground">
            Weekly history is loaded once from the server. The live monitor
            starts fresh on page load and rolls forward every second.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 border-y border-border xl:grid-cols-4">
          <SessionMetric
            icon={ArrowDown}
            label="Weekly average"
            value={formatSpeedBps(averageSpeed)}
          />
          <SessionMetric
            icon={Gauge}
            label="Weekly peak"
            value={formatSpeedBps(peakSpeed)}
          />
          <SessionMetric
            icon={RefreshCw}
            label="Latest bucket"
            value={
              latestPoint
                ? formatSpeedBps(latestPoint.averageDownloadSpeedBps)
                : "No data"
            }
            bottom
          />
          <SessionMetric
            icon={TimerReset}
            label="Last hour avg"
            value={
              lastHourPoints.length > 0
                ? formatSpeedBps(lastHourAverageSpeed)
                : lastRecordedAgeLabel
            }
            bottom
            last
          />
        </div>

        {error && !data ? (
          <div className="mt-4 border-y border-border bg-muted/35 px-3 py-3 text-sm">
            <p className="font-semibold text-foreground">
              Download history is unavailable.
            </p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        ) : null}

        <div className="mt-4 min-w-0">
          {isLoading && !data ? (
            <div className="border-y border-border py-12 text-center">
              <RefreshCw className="mx-auto size-8 animate-spin text-muted-foreground" />
              <p className="mt-3 font-medium text-foreground">
                Loading weekly download history.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Harbor is reading the local history database.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-foreground">
                      Weekly snapshot
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Fixed history loaded from the server on page load.
                    </p>
                  </div>
                </div>

                {points.length > 0 ? (
                  <DownloadSpeedChart
                    animated={false}
                    config={downloadHistoryChartConfig}
                    domainEndMs={weeklyChartDomain.endMs}
                    domainStartMs={weeklyChartDomain.startMs}
                    emptyMessage="No weekly samples available."
                    points={points}
                    tooltipLabelFormatter={formatHistoryTooltipLabel}
                    xAxisTickFormatter={formatHistoryAxisLabel}
                  />
                ) : (
                  <div className="border-y border-border py-12 text-center">
                    <ChartNoAxesCombined className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 font-medium text-foreground">
                      No download history recorded yet.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Keep Harbor running for at least one 30-second server
                      sample to start building the weekly chart.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-foreground">
                      Live monitor
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {isLive
                        ? "Fresh in-memory samples collected every second in a rolling five-minute window."
                        : "Synthetic rolling data while the daemon is offline."}
                    </p>
                  </div>
                </div>

                {animatedLiveData && animatedLiveData.points.length > 0 ? (
                  <DownloadSpeedChart
                    animated
                    config={liveDownloadChartConfig}
                    domainEndMs={liveChartRangeEndMs}
                    domainStartMs={liveChartRangeStartMs}
                    emptyMessage="Waiting for live download samples."
                    points={animatedLiveData.points}
                    tooltipLabelFormatter={formatLiveHistoryTooltipLabel}
                    xAxisTicks={liveChartTicks}
                    yAxisDomain={liveYAxisDomain}
                    xAxisTickFormatter={formatLiveHistoryAxisLabel}
                  />
                ) : (
                  <div className="border-y border-border py-12 text-center">
                    <Activity className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 font-medium text-foreground">
                      {isLive
                        ? "Waiting for live download samples."
                        : "Live monitor starts when Harbor connects."}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The live chart is separate from the weekly server
                      history and starts fresh on every page load.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DownloadSpeedChart({
  animated,
  config,
  domainEndMs,
  domainStartMs,
  emptyMessage,
  points,
  tooltipLabelFormatter,
  xAxisTicks,
  yAxisDomain,
  xAxisTickFormatter,
}: {
  animated: boolean;
  config: ChartConfig;
  domainEndMs: number;
  domainStartMs: number;
  emptyMessage: string;
  points: DownloadHistoryResponse["points"];
  tooltipLabelFormatter: (timestampMs: number) => string;
  xAxisTicks?: number[];
  yAxisDomain?: [number, number];
  xAxisTickFormatter: (timestampMs: number) => string;
}) {
  if (points.length === 0) {
    return (
      <div className="border-y border-border py-12 text-center">
        <ChartNoAxesCombined className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 font-medium text-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ChartContainer
      config={config}
      className="h-64 min-h-[16rem] border-y border-border py-3"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 16, right: 8, bottom: 12, left: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            allowDataOverflow
            axisLine={false}
            dataKey="timestampMs"
            domain={[domainStartMs, domainEndMs]}
            minTickGap={36}
            scale="time"
            tickFormatter={xAxisTickFormatter}
            tickLine={false}
            ticks={xAxisTicks}
            type="number"
          />
          <YAxis
            axisLine={false}
            domain={yAxisDomain}
            tickFormatter={(value) => formatSpeedBps(Number(value))}
            tickLine={false}
            width={78}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => formatSpeedBps(Number(value ?? 0))}
                labelFormatter={(value) =>
                  tooltipLabelFormatter(Number(value ?? 0))
                }
              />
            }
            cursor={false}
          />
          <Line
            activeDot={false}
            dataKey="averageDownloadSpeedBps"
            dot={false}
            isAnimationActive={false}
            stroke="var(--color-averageDownloadSpeedBps)"
            strokeLinecap="round"
            strokeWidth={2}
            type={animated ? "linear" : "monotone"}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function CatalogSection({
  activeQuery,
  canSearch,
  description,
  emptyBody,
  emptyTitle,
  error,
  hasMore,
  hasSearched,
  isLoading,
  isLoadingMore,
  loadMoreLabel,
  loadingBody,
  loadingTitle,
  onAddTorrent,
  onLoadMore,
  onQueryChange,
  onSearch,
  pendingAction,
  query,
  results,
  title,
}: {
  activeQuery: string;
  canSearch: boolean;
  description: string;
  emptyBody: string;
  emptyTitle: string;
  error: string | null;
  hasMore: boolean;
  hasSearched: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadMoreLabel: string;
  loadingBody: string;
  loadingTitle: string;
  onAddTorrent: (torrent: CatalogTorrent) => Promise<void>;
  onLoadMore: () => Promise<void>;
  onQueryChange: (value: string) => void;
  onSearch: () => Promise<void>;
  pendingAction: string | null;
  query: string;
  results: CatalogTorrent[];
  title: string;
}) {
  const trimmedQuery = query.trim();

  return (
    <section className="w-full border-b border-border bg-background">
      <div className="w-full min-w-0 px-3 py-4 sm:px-5 lg:px-6">
        <div className="space-y-1">
          <h2 className="font-display text-2xl tracking-[-0.06em] text-foreground">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        </div>

        <div className="mt-3 relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search torrents"
            className="h-10 rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 pl-9 pr-9 shadow-none focus-visible:ring-0"
            placeholder="Type a query and press Enter"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onSearch();
              }
            }}
          />
          {query ? (
            <button
              aria-label="Clear catalog search"
              className="absolute right-0 top-1/2 inline-flex h-10 w-9 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onQueryChange("")}
              type="button"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {!trimmedQuery ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Type a query, then press Enter to search.
          </p>
        ) : !canSearch ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Type at least 2 characters or paste a full 40-character infohash.
          </p>
        ) : null}

        {error ? (
          <div className="mt-4 border-y border-border bg-muted/35 px-3 py-3 text-sm">
            <p className="font-semibold text-foreground">
              Search is unavailable.
            </p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        ) : null}

        <div className="mt-4 border-t border-border">
          {isLoading ? (
            <div className="border-b border-border py-12 text-center">
              <RefreshCw className="mx-auto size-8 animate-spin text-muted-foreground" />
              <p className="mt-3 font-medium text-foreground">
                {loadingTitle}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {loadingBody}
              </p>
            </div>
          ) : results.length > 0 ? (
            results.map((torrent) => (
              <CatalogResultRow
                key={torrent.actionKey}
                isBusy={pendingAction === `catalog-${torrent.actionKey}`}
                onAdd={() => onAddTorrent(torrent)}
                torrent={torrent}
              />
            ))
          ) : hasSearched && canSearch && !error ? (
            <div className="border-b border-border py-12 text-center">
              <Layers3 className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-medium text-foreground">
                {emptyTitle}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {emptyBody}
              </p>
            </div>
          ) : null}
        </div>

        {results.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">
              Showing {results.length} best matches
              {activeQuery ? ` for "${activeQuery}"` : ""}.
            </p>
          </div>
        ) : null}

        {results.length > 0 && hasMore ? (
          <div className="mt-3 flex justify-start">
            <Button
              className="rounded-none"
              disabled={isLoadingMore}
              onClick={() => void onLoadMore()}
              size="sm"
              type="button"
              variant="outline"
            >
              {isLoadingMore ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : null}
              {isLoadingMore ? "Loading..." : loadMoreLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HeroBand({
  currentMode,
  downloadSpeed,
  freeSpace,
  isLoading,
  lastUpdated,
  mullvad,
  onPauseAll,
  onRefresh,
  onRemoveSeeding,
  onStartAll,
  pendingAction,
  seedingCount,
  torrentCount,
  uploadSpeed,
  version,
}: {
  currentMode: "live" | "demo";
  downloadSpeed: number;
  freeSpace: number;
  isLoading: boolean;
  lastUpdated: string | null;
  mullvad: MullvadStatus;
  onPauseAll: () => void;
  onRefresh: () => void;
  onRemoveSeeding: () => void;
  onStartAll: () => void;
  pendingAction: string | null;
  seedingCount: number;
  torrentCount: number;
  uploadSpeed: number;
  version: string;
}) {
  return (
    <header className="w-full bg-background">
      <div className="bg-black text-white">
        <div className="w-full min-w-0 px-3 pb-5 pt-3 sm:px-5 lg:px-6">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,540px)] xl:items-end">
            <div className="min-w-0 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={currentMode === "live" ? "secondary" : "outline"}
                  className="rounded-none border-white/20 bg-white/10 text-white"
                >
                  {currentMode === "live" ? "Live daemon" : "Demo mode"}
                </Badge>
                <Badge
                  variant="outline"
                  className="rounded-none border-white/20 bg-transparent text-white/78"
                >
                  macOS + Transmission {version}
                </Badge>
                <MullvadHeroStatus status={mullvad} />
                {lastUpdated ? (
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/46">
                    Updated {new Date(lastUpdated).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-[1.78rem] leading-[0.92] tracking-[-0.08em] sm:text-[2.65rem]">
                  Harbor for Transmission.
                </h1>
                <p className="max-w-3xl text-[13px] leading-snug text-white/64 sm:text-base">
                  Full-width queue management for the local daemon, optimized
                  for phone screens first.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px border border-white/12 bg-white/12 sm:grid-cols-4">
              <Button
                size="sm"
                variant="secondary"
                className="h-10 justify-center rounded-none border-0 bg-white/10 px-2 text-[11px] text-white hover:bg-white/16"
                onClick={onRefresh}
              >
                <RefreshCw
                  className={cn("size-3.5", isLoading && "animate-spin")}
                />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-10 justify-center rounded-none border-0 bg-white/8 px-2 text-[11px] text-white hover:bg-white/14"
                onClick={onStartAll}
              >
                <Play className="size-3.5" />
                Start all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-10 justify-center rounded-none border-0 bg-white/8 px-2 text-[11px] text-white hover:bg-white/14"
                onClick={onPauseAll}
              >
                <Pause className="size-3.5" />
                Pause all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-10 justify-center rounded-none border-0 bg-white/8 px-2 text-[11px] text-white hover:bg-white/14 disabled:bg-white/6 disabled:text-white/38"
                disabled={
                  seedingCount === 0 ||
                  pendingAction === "torrent-remove-seeding"
                }
                onClick={onRemoveSeeding}
              >
                <Trash2 className="size-3.5" />
                Clear seeds
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 border-y border-white/12">
            <HeroMetric
              icon={ArrowDown}
              label="Download"
              value={formatSpeedBps(downloadSpeed)}
            />
            <HeroMetric
              icon={ArrowUp}
              label="Upload"
              value={formatSpeedBps(uploadSpeed)}
            />
            <HeroMetric
              icon={Layers3}
              label="Queue"
              value={`${torrentCount} torrents`}
              bottom
            />
            <HeroMetric
              icon={HardDriveDownload}
              label="Free space"
              value={formatBytes(freeSpace)}
              bottom
              last
            />
          </div>
        </div>
      </div>
      <HalftoneTransition />
    </header>
  );
}

function CatalogResultRow({
  isBusy,
  onAdd,
  torrent,
}: {
  isBusy: boolean;
  onAdd: () => Promise<void>;
  torrent: CatalogTorrent;
}) {
  return (
    <article className="w-full border-b border-border last:border-b-0">
      <div className="flex items-start gap-3 py-3">
        <Button
          className="h-16 w-16 shrink-0 self-center rounded-none px-0 text-[11px] uppercase tracking-[0.14em]"
          size="sm"
          variant={isBusy ? "outline" : "default"}
          disabled={isBusy}
          onClick={() => void onAdd()}
        >
          {!isBusy ? <HardDriveDownload className="size-4" /> : null}
          {isBusy ? "Adding" : "Add"}
        </Button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="rounded-none">
              {formatCatalogSwarmBadge(torrent.seeders, "seeders")}
            </Badge>
            {torrent.completed !== null ? (
              <Badge variant="outline" className="rounded-none">
                {formatCompact(torrent.completed)} completed
              </Badge>
            ) : null}
          </div>

          <h3 className="break-words font-display text-base leading-tight tracking-[-0.04em] text-foreground sm:text-lg">
            {torrent.name}
          </h3>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
            <TorrentMeta
              label="Size"
              value={
                torrent.sizeBytes ? formatBytes(torrent.sizeBytes) : "Unknown"
              }
            />
            <TorrentMeta label="Swarm" value={formatCatalogSwarm(torrent)} />
            <TorrentMeta
              label="Published"
              value={formatCatalogPublishedAt(torrent)}
            />
            <TorrentMeta label="Source" value={formatCatalogSource(torrent)} />
          </div>

          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {torrent.infohash}
          </p>
        </div>
      </div>
    </article>
  );
}

function MullvadHeroStatus({ status }: { status: MullvadStatus }) {
  const tone = getMullvadStatusTone(status);
  const server = getMullvadServerLabel(status);
  const location = getMullvadLocationLabel(status);

  return (
    <>
      <Badge
        variant="outline"
        className={cn(
          "rounded-none",
          tone === "default" &&
            "border-emerald-300/24 bg-emerald-400/18 text-emerald-50",
          tone === "outline" && "border-white/20 bg-transparent text-white/78",
          tone === "destructive" &&
            "border-rose-300/24 bg-rose-400/16 text-rose-50",
        )}
      >
        {getMullvadStateLabel(status)}
      </Badge>
      {status.available ? (
        <Badge
          variant="outline"
          className="rounded-none border-white/20 bg-transparent text-white/78"
        >
          {getMullvadUsageLabel(status)}
        </Badge>
      ) : null}
      {server || location ? (
        <Badge
          variant="outline"
          className="rounded-none border-white/20 bg-transparent font-mono text-[10px] normal-case tracking-[0.04em] text-white/72"
        >
          {server ?? location}
        </Badge>
      ) : null}
    </>
  );
}

function HeroMetric({
  bottom = false,
  icon: Icon,
  label,
  last = false,
  value,
}: {
  bottom?: boolean;
  icon: typeof Activity;
  label: string;
  last?: boolean;
  value: string;
}) {
  return (
    <div
      className={cn(
        "border-white/12 px-3 py-3",
        !last && "border-r",
        bottom && "border-t",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-white/56">
        <Icon className="size-3.5" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
          {label}
        </span>
      </div>
      <p className="break-words font-display text-lg tracking-[-0.05em] text-white sm:text-xl">
        {value}
      </p>
    </div>
  );
}

function QueueSection({
  copiedTorrentId,
  counts,
  expandedTorrentId,
  filter,
  onCopyMagnet,
  onExpand,
  onFilterChange,
  onQueryChange,
  onRefresh,
  onRemoveTorrent,
  onSortChange,
  onToggleTorrent,
  pendingAction,
  query,
  snapshotError,
  sortMode,
  torrents,
}: {
  copiedTorrentId: number | null;
  counts: Record<TorrentFilter, number>;
  expandedTorrentId: number | null;
  filter: TorrentFilter;
  onCopyMagnet: (torrentId: number | null) => void;
  onExpand: (
    torrentId: number | null | ((current: number | null) => number | null),
  ) => void;
  onFilterChange: (value: TorrentFilter) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onRemoveTorrent: (torrent: TransmissionTorrent) => void;
  onSortChange: (value: SortMode) => void;
  onToggleTorrent: (torrent: TransmissionTorrent) => void;
  pendingAction: string | null;
  query: string;
  snapshotError: string | null;
  sortMode: SortMode;
  torrents: TransmissionTorrent[];
}) {
  return (
    <section className="w-full border-b border-border bg-background">
      <div className="w-full min-w-0 px-3 py-4 sm:px-5 lg:px-6">
        <div className="space-y-1">
          <h2 className="font-display text-2xl tracking-[-0.06em] text-foreground">
            Queue
          </h2>
          <p className="text-sm text-muted-foreground">
            Compact transfer rows. Tap a row to expand details inline.
          </p>
        </div>

        {snapshotError ? (
          <div className="mt-4 border-y border-border bg-muted/35 px-3 py-3 text-sm">
            <p className="font-semibold text-foreground">
              Live Transmission data is unavailable.
            </p>
            <p className="mt-1 text-muted-foreground">{snapshotError}</p>
            <Button
              className="mt-3 h-9 rounded-none px-3"
              size="sm"
              variant="outline"
              onClick={onRefresh}
            >
              Retry connection
            </Button>
          </div>
        ) : null}

        <div className="mt-3 space-y-2.5">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search torrents"
              className="h-10 rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 pl-9 pr-9 shadow-none focus-visible:ring-0"
              placeholder="Search torrents, labels, or tracker host"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            {query ? (
              <button
                aria-label="Clear search"
                className="absolute right-0 top-1/2 inline-flex h-10 w-9 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onQueryChange("")}
                type="button"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <OptionMenu
              items={filters.map((item) => ({
                label: `${item.label} (${counts[item.value]})`,
                value: item.value,
              }))}
              label="Filter"
              value={filter}
              onValueChange={(value) => onFilterChange(value as TorrentFilter)}
            />
            <OptionMenu
              items={sortOptions.map((item) => ({
                label: item.label,
                value: item.value,
              }))}
              label="Sort"
              value={sortMode}
              onValueChange={(value) => onSortChange(value as SortMode)}
            />
          </div>
        </div>

        <div className="mt-4 border-t border-border">
          {torrents.length === 0 ? (
            <div className="border-b border-border py-12 text-center">
              <Layers3 className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-medium text-foreground">
                No torrents match this view.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Adjust the filters or search query to widen the queue.
              </p>
            </div>
          ) : (
            torrents.map((torrent) => (
              <TorrentRow
                key={torrent.id}
                copied={copiedTorrentId === torrent.id}
                expanded={expandedTorrentId === torrent.id}
                isBusy={
                  pendingAction === `torrent-${torrent.id}` ||
                  pendingAction === `torrent-remove-${torrent.id}`
                }
                onCopyMagnet={async () => {
                  if (!torrent.magnet_link || !navigator.clipboard?.writeText)
                    return;
                  await navigator.clipboard.writeText(torrent.magnet_link);
                  onCopyMagnet(torrent.id);
                }}
                onExpand={() =>
                  onExpand((current) =>
                    current === torrent.id ? null : torrent.id,
                  )
                }
                onRemove={() => {
                  if (expandedTorrentId === torrent.id) onExpand(null);
                  onRemoveTorrent(torrent);
                }}
                onToggle={() => onToggleTorrent(torrent)}
                torrent={torrent}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function SessionSection({
  currentRatio,
  freeSpace,
  mullvad,
  session,
  stats,
  totalRatio,
}: {
  currentRatio: number;
  freeSpace: number;
  mullvad: MullvadStatus;
  session: {
    dht_enabled?: boolean;
    download_dir: string;
    download_queue_enabled: boolean;
    download_queue_size: number;
    peer_limit_per_torrent: number;
    peer_port?: number;
    port_is_open?: boolean;
    seed_queue_enabled: boolean;
    seed_queue_size: number;
    seed_ratio_limit: number;
    seed_ratio_limited: boolean;
    speed_limit_down: number;
    speed_limit_down_enabled: boolean;
    speed_limit_up: number;
    speed_limit_up_enabled: boolean;
    utp_enabled?: boolean;
    version: string;
  };
  stats: {
    active_torrent_count: number;
    current_stats: {
      downloaded_bytes: number;
      seconds_active: number;
      uploaded_bytes: number;
    };
    paused_torrent_count: number;
    torrent_count: number;
    cumulative_stats: {
      downloaded_bytes: number;
      seconds_active: number;
      uploaded_bytes: number;
    };
  };
  totalRatio: number;
}) {
  return (
    <section className="w-full border-b border-border bg-background">
      <div className="w-full min-w-0 px-3 py-4 sm:px-5 lg:px-6">
        <div className="space-y-1">
          <h2 className="font-display text-xl tracking-[-0.06em] text-foreground">
            Session
          </h2>
          <p className="text-sm text-muted-foreground">
            Daemon health, queue settings, and current limits.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 border-y border-border xl:grid-cols-4">
          <SessionMetric
            icon={Gauge}
            label="Active"
            value={`${stats.active_torrent_count}`}
          />
          <SessionMetric
            icon={Pause}
            label="Paused"
            value={`${stats.paused_torrent_count}`}
          />
          <SessionMetric
            icon={CheckCircle2}
            label="Current ratio"
            value={formatRatio(currentRatio)}
            bottom
          />
          <SessionMetric
            icon={TimerReset}
            label="Total ratio"
            value={formatRatio(totalRatio)}
            bottom
            last
          />
        </div>

        <dl className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
          <SessionRow
            label="Download folder"
            value={session.download_dir}
            icon={FolderOpen}
          />
          <SessionRow
            label="Free space"
            value={formatBytes(freeSpace)}
            icon={HardDriveDownload}
          />
          <SessionRow
            label="Primary queue"
            value={
              session.download_queue_enabled
                ? `${session.download_queue_size} active downloads`
                : "Disabled"
            }
            icon={Layers3}
          />
          <SessionRow
            label="Seed queue"
            value={
              session.seed_queue_enabled
                ? `${session.seed_queue_size} active seeds`
                : "Disabled"
            }
            icon={ArrowUp}
          />
          <SessionRow
            label="Speed limits"
            value={`${session.speed_limit_down_enabled ? `${session.speed_limit_down} KB/s down` : "Down uncapped"} · ${session.speed_limit_up_enabled ? `${session.speed_limit_up} KB/s up` : "Up uncapped"}`}
            icon={Gauge}
          />
          <SessionRow
            label="Peer policy"
            value={`${session.peer_limit_per_torrent} peers/torrent · ${session.port_is_open ? "Port open" : "Port unknown"}${session.peer_port ? ` · ${session.peer_port}` : ""}`}
            icon={Wifi}
          />
          <SessionRow
            label="Protocol"
            value={`${session.dht_enabled ? "DHT" : "DHT off"} · ${session.utp_enabled ? "uTP" : "uTP off"} · Ratio goal ${session.seed_ratio_limited ? formatRatio(session.seed_ratio_limit) : "Unlimited"}`}
            icon={ShieldCheck}
          />
          <SessionRow
            label="Mullvad"
            value={getMullvadSummary(mullvad)}
            icon={ShieldCheck}
          />
          <SessionRow
            label="Current session"
            value={`${formatBytes(stats.current_stats.downloaded_bytes)} down · ${formatBytes(stats.current_stats.uploaded_bytes)} up · ${formatDuration(stats.current_stats.seconds_active)}`}
            icon={Activity}
          />
          <SessionRow
            label="Lifetime"
            value={`${formatBytes(stats.cumulative_stats.downloaded_bytes)} down · ${formatBytes(stats.cumulative_stats.uploaded_bytes)} up · ${formatDuration(stats.cumulative_stats.seconds_active)}`}
            icon={CheckCircle2}
          />
          <SessionRow
            label="Daemon"
            value={`${session.version} · ${stats.torrent_count} torrents tracked`}
            icon={Gauge}
          />
        </dl>
      </div>
    </section>
  );
}

function OptionMenu({
  items,
  label,
  onValueChange,
  value,
}: {
  items: { label: string; value: string }[];
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const activeItem = items.find((item) => item.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-10 justify-between rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0 text-sm font-normal text-foreground shadow-none hover:bg-transparent hover:text-foreground"
          variant="ghost"
        >
          <span className="truncate">
            {label}: {activeItem?.label ?? value}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem] rounded-none">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {items.map((item) => (
            <DropdownMenuRadioItem
              key={item.value}
              className="rounded-none"
              value={item.value}
            >
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionMetric({
  bottom = false,
  icon: Icon,
  label,
  last = false,
  value,
}: {
  bottom?: boolean;
  icon: typeof Activity;
  label: string;
  last?: boolean;
  value: string;
}) {
  return (
    <div
      className={cn(
        "border-border px-3 py-3",
        !last && "border-r",
        bottom && "border-t xl:border-t-0",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
          {label}
        </span>
      </div>
      <p className="break-words font-display text-base tracking-[-0.05em] text-foreground sm:text-lg">
        {value}
      </p>
    </div>
  );
}

function SessionRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 border-b border-border/70 pb-3 last:border-b-0 last:pb-0">
      <div className="mt-0.5 text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </dt>
        <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
      </div>
    </div>
  );
}

function TorrentRow({
  copied,
  expanded,
  isBusy,
  onCopyMagnet,
  onExpand,
  onRemove,
  onToggle,
  torrent,
}: {
  copied: boolean;
  expanded: boolean;
  isBusy: boolean;
  onCopyMagnet: () => Promise<void>;
  onExpand: () => void;
  onRemove: () => void;
  onToggle: () => void;
  torrent: TransmissionTorrent;
}) {
  const progressPercent = Math.round(getTorrentProgressPercent(torrent));

  return (
    <article className="w-full border-b border-border last:border-b-0">
      <div className="w-full min-w-0 py-3">
        <button
          aria-expanded={expanded}
          className="block w-full min-w-0 space-y-2 text-left"
          onClick={onExpand}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={getTorrentStatusTone(torrent)}
                  className="rounded-none"
                >
                  {getTorrentStateLabel(torrent)}
                </Badge>
                <span className="border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Queue {torrent.queue_position}
                </span>
                {isQueued(torrent) ? (
                  <span className="border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Waiting
                  </span>
                ) : null}
              </div>
            </div>
            <span className="shrink-0 pt-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors group-hover:text-foreground">
              {expanded ? "Hide details" : "See details"}
            </span>
          </div>

          <h3 className="break-words font-display text-base leading-tight tracking-[-0.04em] text-foreground sm:text-lg">
            {torrent.name}
          </h3>

          <div className="flex min-h-16 items-center gap-3">
            <Button
              aria-label={isPaused(torrent) ? "Start torrent" : "Pause torrent"}
              className="h-16 w-16 shrink-0 rounded-none px-0 text-[11px] uppercase tracking-[0.14em]"
              size="sm"
              variant={isPaused(torrent) ? "default" : "outline"}
              disabled={isBusy}
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
            >
              {isPaused(torrent) ? "Start" : "Pause"}
            </Button>

            <div className="min-w-0 flex-1 space-y-2">
              <Progress
                value={progressPercent}
                className="h-1.5 rounded-none"
              />

              <div className="flex flex-wrap items-start gap-x-5 gap-y-1.5 text-[11px]">
                <TorrentMeta
                  label="Progress"
                  value={`${progressPercent}% complete`}
                />
                <TorrentMeta label="ETA" value={compactEtaLabel(torrent)} />
                <TorrentMeta
                  label="Transfer"
                  value={compactFlowLabel(torrent)}
                />
                <TorrentMeta
                  label="Size"
                  value={compactProgressLabel(torrent)}
                />
              </div>
            </div>
          </div>

          {torrent.labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {torrent.labels.map((label) => (
                <Badge
                  key={label}
                  variant="outline"
                  className="rounded-none border-border/80 px-1.5 py-0 text-[10px] normal-case tracking-normal text-muted-foreground"
                >
                  {label}
                </Badge>
              ))}
            </div>
          ) : null}
        </button>

        <div
          className={cn(
            "grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out",
            expanded
              ? "mt-3 grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-4">
                <DetailStrip
                  label="Size"
                  value={formatBytes(torrent.total_size)}
                />
                <DetailStrip
                  label="Ratio"
                  value={formatRatio(torrent.upload_ratio)}
                />
                <DetailStrip
                  label="Added"
                  value={formatTimestamp(torrent.added_date)}
                />
                <DetailStrip
                  label="Uploaded"
                  value={formatBytes(torrent.uploaded_ever)}
                />
              </div>

              <div className="space-y-1.5 border-b border-border py-3 text-sm">
                <p className="break-words text-foreground/92">
                  {getTorrentProgressLabel(torrent)}
                </p>
                <p className="break-words text-muted-foreground">
                  {getTorrentPeerLabel(torrent)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-border py-2.5">
                {torrent.labels.length > 0 ? (
                  torrent.labels.map((label) => (
                    <Badge
                      key={label}
                      variant="outline"
                      className="rounded-none normal-case tracking-normal"
                    >
                      {label}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No labels assigned.
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-4 border-b border-border py-2.5">
                {torrent.magnet_link ? (
                  <Button
                    className="h-auto rounded-none px-0 py-0 text-[11px] font-medium uppercase tracking-[0.16em]"
                    size="sm"
                    variant="ghost"
                    onClick={onCopyMagnet}
                  >
                    <Copy className="size-4" />
                    {copied ? "Copied magnet" : "Copy magnet"}
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="h-auto rounded-none px-0 py-0 text-[11px] font-medium uppercase tracking-[0.16em]"
                      size="sm"
                      variant="ghost"
                    >
                      Actions
                      <ChevronDown className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="rounded-none">
                    <DropdownMenuLabel>Torrent</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="rounded-none"
                      disabled={isBusy}
                      onClick={onCopyMagnet}
                    >
                      <Copy className="size-4" />
                      {copied ? "Copied magnet" : "Copy magnet"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="rounded-none"
                      disabled={isBusy}
                      onClick={onRemove}
                      variant="destructive"
                    >
                      <Trash2 className="size-4" />
                      Remove torrent
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="space-y-2 py-2.5 text-sm">
                <InlineDetail
                  label="Trackers"
                  value={getTrackerHosts(torrent).join(", ") || "Unavailable"}
                />
                <InlineDetail
                  label="Download path"
                  value={torrent.download_dir}
                  breakAll
                />
                <InlineDetail
                  label="Privacy"
                  value={
                    torrent.is_private ? "Private torrent" : "Public torrent"
                  }
                />
                <InlineDetail
                  label="Piece layout"
                  value={`${torrent.piece_count ? `${torrent.piece_count} pieces` : "N/A"}${torrent.piece_size ? ` · ${formatBytes(torrent.piece_size)} each` : ""}`}
                />
                <InlineDetail
                  label="Hash"
                  value={torrent.hash_string ?? "Unavailable"}
                  breakAll
                  mono
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function TorrentMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-left">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 break-words text-[11px] leading-snug text-foreground/88">
        {value}
      </p>
    </div>
  );
}

function DetailStrip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words font-display text-sm tracking-[-0.04em] text-foreground sm:text-base">
        {value}
      </p>
    </div>
  );
}

function InlineDetail({
  breakAll = false,
  label,
  mono = false,
  value,
}: {
  breakAll?: boolean;
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 text-foreground",
          breakAll ? "break-all" : "break-words",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function compactEtaLabel(torrent: TransmissionTorrent) {
  return getTorrentEtaLabel(torrent).replace(" remaining", "");
}

function compactFlowLabel(torrent: TransmissionTorrent) {
  if (torrent.rate_download > 0 && torrent.rate_upload > 0) {
    return `${formatSpeedBps(torrent.rate_download)} down · ${formatSpeedBps(torrent.rate_upload)} up`;
  }

  if (torrent.rate_download > 0) {
    return `${formatSpeedBps(torrent.rate_download)} down`;
  }

  if (torrent.rate_upload > 0) {
    return `${formatSpeedBps(torrent.rate_upload)} up`;
  }

  if (isQueued(torrent)) {
    return "Queued";
  }

  return getTorrentStateLabel(torrent);
}

function compactProgressLabel(torrent: TransmissionTorrent) {
  if (torrent.left_until_done < 1) {
    return "Complete";
  }

  return `${formatBytes(torrent.size_when_done - torrent.left_until_done)} of ${formatBytes(torrent.size_when_done)}`;
}

function formatCatalogSwarmBadge(value: number | null, label: string) {
  return value === null ? `${label} n/a` : `${formatCompact(value)} ${label}`;
}

function formatCatalogSwarm(torrent: CatalogTorrent) {
  return torrent.seeders === null
    ? "Seeders n/a"
    : `${formatCompact(torrent.seeders)} seeding`;
}

function getChartTimeDomain(
  points: DownloadHistoryResponse["points"],
  minimumSpanMs: number,
) {
  if (points.length === 0) {
    return { startMs: 0, endMs: 0 };
  }

  const startMs = points[0]?.timestampMs ?? 0;
  const endMs = points.at(-1)?.timestampMs ?? startMs;

  if (endMs > startMs) {
    return { startMs, endMs };
  }

  const halfSpanMs = Math.max(minimumSpanMs, 60_000) / 2;
  return {
    startMs: startMs - halfSpanMs,
    endMs: endMs + halfSpanMs,
  };
}

function getMinuteAxisTicks(domainStartMs: number, domainEndMs: number) {
  const minuteMs = 60 * 1000;
  const ticks: number[] = [];
  const firstTickMs = Math.ceil(domainStartMs / minuteMs) * minuteMs;

  for (let tickMs = firstTickMs; tickMs <= domainEndMs; tickMs += minuteMs) {
    ticks.push(tickMs);
  }

  return ticks;
}

function formatCatalogPublishedAt(torrent: CatalogTorrent) {
  const timestamp =
    torrent.published ?? torrent.createdUnix ?? torrent.scrapedDate;
  return timestamp ? formatTimestamp(timestamp) : "N/A";
}

function formatCatalogSource(torrent: CatalogTorrent) {
  return torrent.source ?? "Unknown";
}

function formatHistoryAxisLabel(timestampMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestampMs));
}

function formatHistoryTooltipLabel(timestampMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
}

function formatLiveHistoryAxisLabel(timestampMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestampMs));
}

function formatLiveHistoryTooltipLabel(timestampMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "medium",
  }).format(new Date(timestampMs));
}

function formatHistoryAgeLabel(timestampMs: number) {
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - timestampMs) / 1000),
  );

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  return `${formatDuration(elapsedSeconds, 1)} ago`;
}

export default App;
