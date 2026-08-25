import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/** Collect anything the page reports as broken, so a test can assert on it. */
function watchForErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

test('the tool boots clean', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/app/')
  // the landing "import orb" is the entry point of the whole app
  await expect(page.getByLabel('Import model')).toBeVisible()
  expect(errors, errors.join('\n')).toEqual([])
})

test('H opens the shortcuts overlay and Escape closes it', async ({ page }) => {
  await page.goto('/app/')
  await expect(page.getByLabel('Import model')).toBeVisible()

  await page.keyboard.press('h')
  const help = page.getByRole('dialog', { name: /shortcut/i })
  await expect(help).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
})

test('Preferences opens from the landing page and Escape closes it', async ({ page }) => {
  await page.goto('/app/')
  await page.getByLabel('Preferences').click()
  const prefs = page.getByRole('dialog', { name: /preferences/i })
  await expect(prefs).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(prefs).toBeHidden()
})

test('the demo scene loads, maps, and renders both viewports', async ({ page }) => {
  const errors = watchForErrors(page)
  await page.goto('/app/')
  await expect(page.getByLabel('Import model')).toBeVisible()

  // drive the real store (dev-only handle) — no binary fixture needed
  await page.evaluate(async () => {
    await (window as unknown as { uvStore: { getState(): { loadDemoArena(): Promise<void> } } })
      .uvStore.getState()
      .loadDemoArena()
  })

  // the viewports mount WebGL canvases once a scene exists
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

  const state = await page.evaluate(() => {
    const s = (
      window as unknown as {
        uvStore: { getState(): { mapObjects: unknown[]; mappedObjects: string[]; hasUV: boolean } }
      }
    ).uvStore.getState()
    const live = (window as unknown as { uvLive: { uv: Map<number, Float32Array> } }).uvLive
    return {
      objects: s.mapObjects.length,
      mapped: s.mappedObjects.length,
      hasUV: s.hasUV,
      // every mapped shell must hold finite UVs — NaNs here mean the solver blew up
      finite: [...live.uv.values()].every((a) => a.every((n) => Number.isFinite(n))),
    }
  })

  expect(state.objects).toBeGreaterThan(0)
  expect(state.mapped).toBeGreaterThan(0)
  expect(state.hasUV).toBe(true)
  expect(state.finite).toBe(true)
  expect(errors, errors.join('\n')).toEqual([])
})

test('undo and redo round-trip a screen transform', async ({ page }) => {
  await page.goto('/app/')
  await page.evaluate(async () => {
    await (window as unknown as { uvStore: { getState(): { loadDemoArena(): Promise<void> } } })
      .uvStore.getState()
      .loadDemoArena()
  })
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

  const result = await page.evaluate(() => {
    type Store = {
      getState(): {
        selectedObject: string | null
        mapObjects: { name: string; shellIds: number[] }[]
        rotateObject(name: string, dir: 'cw' | 'ccw'): void
        undo(): void
        redo(): void
      }
    }
    const store = (window as unknown as { uvStore: Store }).uvStore
    const live = (window as unknown as { uvLive: { uv: Map<number, Float32Array> } }).uvLive
    const obj = store.getState().mapObjects[0]
    const id = obj.shellIds[0]
    const snap = () => Array.from(live.uv.get(id) ?? [])
    const before = snap()
    store.getState().rotateObject(obj.name, 'cw')
    const rotated = snap()
    store.getState().undo()
    const undone = snap()
    store.getState().redo()
    const redone = snap()
    const same = (a: number[], b: number[]) =>
      a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-5)
    return {
      rotateChanged: !same(before, rotated),
      undoRestored: same(before, undone),
      redoReapplied: same(rotated, redone),
    }
  })

  expect(result.rotateChanged).toBe(true)
  expect(result.undoRestored).toBe(true)
  expect(result.redoReapplied).toBe(true)
})
