// `vitest/config` re-exports Vite's defineConfig with the `test` block typed,
// so the config no longer needs an `as any` cast at the bottom.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
const pkgVersion = pkg.version

// Publish a tiny public version manifest into the build output. The desktop app
// fetches https://uv.preshow.link/version.json on launch to detect newer builds.
function emitVersionJson() {
  return {
    name: 'emit-version-json',
    apply: 'build' as const,
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(
          {
            app: pkgVersion,
            plugin: pkgVersion,
            url: 'https://github.com/hayhamLT/uvstudio/releases/latest',
          },
          null,
          2,
        ),
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Content-Security-Policy for the TOOL page (`/app/`).
//
// Only the app page gets it: the marketing page (`index.html`) is hand-written
// with one inline <script>, which a strict `script-src 'self'` would break, and
// it handles no user data. The tool is the page that reads local files, is
// embedded into preshow.link, and talks to the network — so it's the one worth
// locking down.
//
// `frame-ancestors` deliberately allows preshow.link: the built `app/` bundle
// is embedded there on purpose (see web.yml).
// ---------------------------------------------------------------------------
const APP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' https://preshow.link https://*.preshow.link",
  "script-src 'self'",
  // Tailwind ships a stylesheet, but React/three still set inline style attributes
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob: https://api.github.com",
].join('; ')

// Inject the CSP as a <meta> tag at BUILD time only — GitHub Pages can't send
// headers, and doing it in dev would kill Vite's HMR websocket + inline scripts.
function emitAppCsp() {
  return {
    name: 'emit-app-csp',
    apply: 'build' as const,
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string, ctx: { path: string }) {
        if (!ctx.path.includes('app/')) return html
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${APP_CSP}" />`,
        )
      },
    },
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  // honor a PORT from the environment (preview harnesses); default 5173 locally.
  // via globalThis so tsc needs no @types/node for the bare `process` global.
  // ignore .claude/ — permission-settings writes there mid-session and every
  // change would full-reload the dev app (wiping its state).
  server: {
    port: Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PORT) || 5173,
    watch: { ignored: ['**/.claude/**'] },
  },
  plugins: [react(), tailwindcss(), emitVersionJson(), emitAppCsp()],
  // Multi-page build: `/` is the static marketing site (index.html, plain HTML —
  // no bundling needed), `/app/` is the actual React tool. Kept as two Rollup
  // entries so both get hashed/optimized output under one `dist/`.
  build: {
    // three's core is ~725kB and cannot be deferred in a 3D tool — set the bar
    // just above it so the warning still fires for anything NEW that gets big.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: { main: 'index.html', app: 'app/index.html' },
      output: {
        // Split the heavy, slow-moving vendors into their own long-lived chunks
        // so a change to app code doesn't invalidate ~1MB of three.js in every
        // user's cache. `ag-psd` also gets a readable name (its entry is
        // `dist/index.js`, which otherwise produces a chunk literally called
        // "dist").
        advancedChunks: {
          groups: [
            // core three only — `examples/jsm` (GLTF loader/exporter) stays in
            // its own on-demand chunks, which is the point of importing it lazily
            { name: 'three', test: /node_modules[\\/]three[\\/](?!examples[\\/])/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'ag-psd', test: /node_modules[\\/]ag-psd[\\/]/ },
          ],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
