# tmanager

Mobile-first Transmission manager for macOS, built with React, Vite, Tailwind CSS v4, and shadcn-style UI components.

The app is designed around Transmission's existing web interface and RPC model. The upstream Transmission source is available locally in `transmission/`, and the current implementation uses `transmission/web/src/remote.js`, `transmission/web/src/torrent.js`, and `transmission/web/src/torrent-row.js` as the behavioral reference.

## What is implemented

- Mobile-first queue dashboard with desktop-friendly two-column layout
- Transmission RPC polling with `X-Transmission-Session-Id` retry handling
- Session telemetry panel for speed limits, queue settings, ratios, and free space
- Mullvad VPN status with tunnel state, active exit usage, and current relay/server when available
- Torrent cards with queue state, progress, ETA, peer details, labels, and quick start/pause controls
- Demo fallback when the local Transmission RPC endpoint is unavailable
- Vite dev middleware for a local Transmission daemon and Mullvad CLI status on macOS

## Run it

```bash
bun install
bun run dev
```

By default the Vite dev server proxies `/transmission/*` to `http://127.0.0.1:9091`, which matches the usual local Transmission setup on macOS.

The app also exposes `/api/mullvad/status` during `bun run dev` and `bun run preview`. That endpoint shells out to the local `mullvad status --json` CLI command, so the Mullvad desktop app or CLI needs to be installed on the same Mac.

`bun run dev` now starts Vite with `--host`, so it binds on your LAN and can be opened from your phone using the network URL shown in the terminal.

## Optional local configuration

Create a `.env.local` file if your daemon is not at the default endpoint or if your local RPC requires basic auth during development.

```bash
TRANSMISSION_RPC_TARGET=http://127.0.0.1:9091
TRANSMISSION_RPC_USERNAME=
TRANSMISSION_RPC_PASSWORD=
MULLVAD_CLI_PATH=mullvad
VITE_TRANSMISSION_RPC_URL=/transmission/rpc
VITE_MULLVAD_STATUS_URL=/api/mullvad/status
```

Notes:

- `TRANSMISSION_RPC_TARGET`, `TRANSMISSION_RPC_USERNAME`, and `TRANSMISSION_RPC_PASSWORD` are used by the Vite dev proxy.
- `MULLVAD_CLI_PATH` sets which Mullvad CLI binary the local status endpoint executes. The default is `mullvad`.
- `VITE_TRANSMISSION_RPC_URL` is the client-side RPC URL. The default is `/transmission/rpc`.
- `VITE_MULLVAD_STATUS_URL` is the client-side Mullvad status URL. The default is `/api/mullvad/status`.
- For a production/static deployment, serve the built app behind a proxy that exposes Transmission RPC at the same origin, or set `VITE_TRANSMISSION_RPC_URL` to a compatible endpoint.
- For a production/static deployment, expose a same-origin endpoint compatible with `/api/mullvad/status`, or set `VITE_MULLVAD_STATUS_URL` to wherever that endpoint lives.

## Scripts

```bash
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

- Production use still needs same-origin infrastructure for Transmission RPC and Mullvad status, or explicit compatible endpoint URLs for both.
- The demo mode is intentional fallback UI for disconnected development; it is not a daemon simulator.
