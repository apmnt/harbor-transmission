# tmanager

Mobile-first Transmission manager for macOS, built with React, Vite, Tailwind CSS v4, and shadcn-style UI components.

The app is designed around Transmission's existing web interface and RPC model. The upstream Transmission source is available locally in `transmission/`, and the current implementation uses `transmission/web/src/remote.js`, `transmission/web/src/torrent.js`, and `transmission/web/src/torrent-row.js` as the behavioral reference.

## What is implemented

- Mobile-first queue dashboard with desktop-friendly two-column layout
- Transmission RPC polling with `X-Transmission-Session-Id` retry handling
- Session telemetry panel for speed limits, queue settings, ratios, and free space
- Mullvad VPN status with public exit detection, active usage, and current exit IP/location
- DuckDB-backed torrent catalog search over a generated Parquet dataset
- Weekly download-speed history chart backed by a local 30-second SQLite history store
- One-click magnet adds from the catalog UI using Transmission's native `torrent-add` URL flow
- Torrent cards with queue state, progress, ETA, peer details, labels, and quick start/pause controls
- Demo fallback when the local Transmission RPC endpoint is unavailable
- Vite dev middleware for a local Transmission daemon, DuckDB catalog search, and Mullvad public-status checks on macOS

## Run it

```bash
bun install
bun run catalog:build
bun run dev
```

By default the Vite dev server proxies `/transmission/*` to `http://127.0.0.1:9091`, which matches the usual local Transmission setup on macOS.

The app also exposes `/api/mullvad/status` during `bun run dev` and `bun run preview`. That endpoint queries Mullvad's public connection-check APIs, which works for direct Mullvad connections and Tailscale sessions using Mullvad as an exit node.

The torrent catalog lives at `/api/catalog/search`. It queries `data/torrents-catalog.parquet` with DuckDB. If the Parquet file is missing and `torrents-csv-data/torrents.csv` exists, the server will generate the Parquet file on the first catalog request.

The app also exposes `/api/history/download-speed`. While the dev or preview server is running, Harbor saves Transmission download-speed samples into a local SQLite database, serves the latest week as chart data, and prunes rows older than 7 days. On macOS the default path is `~/Library/Application Support/harbor-transmission/harbor-history.sqlite`. Override it with `HARBOR_HISTORY_DATABASE_PATH` if needed.

`bun run dev` now starts Vite with `--host`, so it binds on your LAN and can be opened from your phone using the network URL shown in the terminal.

## Optional local configuration

Create a `.env.local` file if your daemon is not at the default endpoint or if your local RPC requires basic auth during development.

```bash
TRANSMISSION_RPC_TARGET=http://127.0.0.1:9091
TRANSMISSION_RPC_USERNAME=
TRANSMISSION_RPC_PASSWORD=
VITE_TRANSMISSION_RPC_URL=/transmission/rpc
VITE_TORRENT_CATALOG_URL=/api/catalog/search
VITE_MULLVAD_STATUS_URL=/api/mullvad/status
```

Notes:

- `TRANSMISSION_RPC_TARGET`, `TRANSMISSION_RPC_USERNAME`, and `TRANSMISSION_RPC_PASSWORD` are used by the Vite dev proxy.
- `VITE_TRANSMISSION_RPC_URL` is the client-side RPC URL. The default is `/transmission/rpc`.
- `VITE_TORRENT_CATALOG_URL` is the client-side DuckDB search endpoint. The default is `/api/catalog/search`.
- `VITE_MULLVAD_STATUS_URL` is the client-side Mullvad status URL. The default is `/api/mullvad/status`.
- For a production/static deployment, serve the built app behind a proxy that exposes Transmission RPC at the same origin, or set `VITE_TRANSMISSION_RPC_URL` to a compatible endpoint.
- For a production/static deployment, expose same-origin endpoints compatible with `/api/catalog/search`, `/api/mullvad/status`, and `/api/history/download-speed`, or point the client at compatible replacements.

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

## Current limitations

- Production use still needs same-origin infrastructure for Transmission RPC, catalog search, and Mullvad status, or explicit compatible endpoint URLs for all three.
- The weekly history chart only fills while Harbor's own server process is running, because the 30-second sampler lives in the local Vite middleware.
- The demo mode is intentional fallback UI for disconnected development; it is not a daemon simulator.
