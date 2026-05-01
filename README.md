# transmission-harbor

Mobile-first Transmission manager for macOS, built with React, Vite, Tailwind CSS v4, and shadcn-style UI components.

The app is designed around Transmission's existing web interface and RPC model. The upstream Transmission source is available locally in `transmission/`, and the current implementation uses `transmission/web/src/remote.js`, `transmission/web/src/torrent.js`, and `transmission/web/src/torrent-row.js` as the behavioral reference.

## What is implemented

- Mobile-first queue dashboard with desktop-friendly two-column layout
- Transmission RPC polling with `X-Transmission-Session-Id` retry handling
- Session telemetry panel for speed limits, queue settings, ratios, and free space
- Mullvad VPN status with public exit detection, active usage, and current exit IP/location
- Prowlarr-backed torrent search across your configured indexers
- Local torrents-csv search backed by DuckDB + Parquet (`/api/catalog/search`)
- Weekly download-speed history chart backed by a local 30-second SQLite history store
- One-click magnet adds from search results using Transmission's native `torrent-add` URL flow
- Torrent cards with queue state, progress, ETA, peer details, labels, and quick start/pause controls
- Demo fallback when the local Transmission RPC endpoint is unavailable
- Vite dev middleware for a local Transmission daemon, Mullvad public-status checks on macOS

## Run it

```bash
bun install
bun run catalog:build
bun run dev
```

By default the Vite dev server proxies `/transmission/*` to `http://127.0.0.1:9091`, which matches the usual local Transmission setup on macOS.

The app also exposes `/api/mullvad/status` during `bun run dev` and `bun run preview`. That endpoint queries Mullvad's public connection-check APIs, which works for direct Mullvad connections and Tailscale sessions using Mullvad as an exit node.

The torrent search uses a local Harbor endpoint (`/api/prowlarr/search`) that proxies to Prowlarr `/api/v1/search` with your server-side API key.
The local torrents-csv search uses `/api/catalog/search`. It reads `data/torrents-catalog.parquet`, and can generate that file from `torrents-csv-data/torrents.csv`.

The app also exposes `/api/history/download-speed`. While the dev or preview server is running, Harbor saves Transmission download-speed samples into a local SQLite database, serves the latest week as chart data, and prunes rows older than 7 days. On macOS the default path is `~/Library/Application Support/harbor-transmission/harbor-history.sqlite`. Override it with `HARBOR_HISTORY_DATABASE_PATH` if needed.

`bun run dev` now starts Vite with `--host`, so it binds on your LAN and can be opened from your phone using the network URL shown in the terminal.

## Configuration

Create a `.env.local` file to configure your services:

```bash
TRANSMISSION_RPC_TARGET=http://127.0.0.1:9091
TRANSMISSION_RPC_USERNAME=
TRANSMISSION_RPC_PASSWORD=
PROWLARR_TARGET=http://localhost:9696
PROWLARR_API_KEY=
PROWLARR_TIMEOUT_MS=20000
VITE_TRANSMISSION_RPC_URL=/transmission/rpc
VITE_MULLVAD_STATUS_URL=/api/mullvad/status
```

### Environment Variables

- `TRANSMISSION_RPC_TARGET` - Transmission RPC endpoint for dev proxy (server-side)
- `TRANSMISSION_RPC_USERNAME` - Transmission RPC username (server-side)
- `TRANSMISSION_RPC_PASSWORD` - Transmission RPC password (server-side)
- `PROWLARR_TARGET` - Prowlarr API base URL for the local Harbor proxy (server-side)
- `PROWLARR_API_KEY` - Prowlarr API key used by the local Harbor proxy (server-side)
- `PROWLARR_TIMEOUT_MS` - Prowlarr request timeout in milliseconds for Harbor's local proxy (default: `20000`)
- `VITE_TRANSMISSION_RPC_URL` - Client-side Transmission RPC URL (default: `/transmission/rpc`)
- `VITE_MULLVAD_STATUS_URL` - Mullvad status endpoint (default: `/api/mullvad/status`)

### Prowlarr Setup

1. Ensure Prowlarr is running and accessible
2. Add Prowlarr server settings to `.env.local`:
   ```bash
   PROWLARR_TARGET=http://localhost:9696
   PROWLARR_API_KEY=your-prowlarr-api-key
   ```
3. Restart the dev server

## Scripts

```bash
bun run catalog:build
bun run history:verify
bun run dev
bun run build
bun run lint
bun run preview
```

## Reference material

- Local upstream codebase: `transmission/`
- Transmission web UI reference: `transmission/web/`
- Main RPC/session examples:
  - `transmission/web/src/remote.js`
  - `transmission/web/src/torrent.js`
  - `transmission/web/src/torrent-row.js`
- Prowlarr API documentation: https://prowlarr.wiki/information/api

## Current limitations

- Production use still needs same-origin infrastructure for Transmission RPC, or explicit compatible endpoint URLs.
- Prowlarr must be accessible from the client environment for torrent search to work.
- The weekly history chart only fills while Harbor's own server process is running, because the 30-second sampler lives in the local Vite middleware.
- The demo mode is intentional fallback UI for disconnected development; it is not a daemon simulator.
