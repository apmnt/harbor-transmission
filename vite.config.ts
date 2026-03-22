import { Buffer } from 'node:buffer'
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { torrentCatalogPlugin } from './server/catalog'
import { transmissionHistoryPlugin } from './server/history'
import { mullvadStatusPlugin } from './server/mullvad'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.TRANSMISSION_RPC_TARGET || 'http://127.0.0.1:9091'
  const username = env.TRANSMISSION_RPC_USERNAME
  const password = env.TRANSMISSION_RPC_PASSWORD || ''

  return {
    plugins: [
      react(),
      torrentCatalogPlugin(),
      transmissionHistoryPlugin({ target, username, password }),
      mullvadStatusPlugin(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/transmission': {
          target,
          changeOrigin: true,
          secure: false,
          headers:
            username !== undefined
              ? {
                  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
                }
              : undefined,
        },
      },
    },
  }
})
