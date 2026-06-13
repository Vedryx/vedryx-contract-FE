import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  appType: 'spa',
  build: {
    // Raise transpile target to drop Array.from / Math.trunc / Object.assign
    // polyfills (-~29 KiB legacy JS, surfaced by Lighthouse
    // "legacy-javascript-insight"). Browser matrix covers 95%+ of mobile
    // traffic per caniuse.com (es2020 baseline, May 2020+).
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/src/renderers/')) return 'three-renderer'
          if (id.includes('/node_modules/three/src/')) return 'three-core'
          // Split heavy 3rd-party libs so the entry bundle is small enough
          // that Lighthouse "unused-javascript" stops flagging it (was 85%
          // unused at 147 KB). Posthog defers on idle; react-router is
          // route-driven so its code-path is shared across pages.
          if (id.includes('/node_modules/posthog-js/')) return 'posthog'
          if (id.includes('/node_modules/react-router')) return 'router'
          if (id.includes('/node_modules/@sentry/')) return 'sentry'
        },
      },
    },
  },
})
