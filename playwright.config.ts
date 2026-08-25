import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end smoke tests for the tool at `/app/`.
 *
 * These run against the DEV server on purpose: `src/state/store.ts` exposes
 * `window.uvStore` only in dev, which lets a test drive the real pipeline
 * (load the demo arena → map → inspect UVs) without checking binary GLB/PSD
 * fixtures into the repo.
 *
 * WebGL: headless Chromium has no GPU, so ANGLE is pointed at SwiftShader —
 * without it every <Canvas> fails to get a context and the viewport tests are
 * meaningless rather than failing loudly.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199/app/',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120_000,
  },
})
