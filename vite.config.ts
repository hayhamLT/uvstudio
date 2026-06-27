import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

// https://vite.dev/config/
// The `test` block is consumed by Vitest; cast keeps it off Vite's UserConfig type.
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

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [react(), tailwindcss(), emitVersionJson()],
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any)
