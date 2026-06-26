import { useEffect, useRef, type ChangeEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { live } from '../state/live'
import { useFileDrop } from './useFileDrop'
import { isEmbeddedHost } from './env'
import { importMapFiles, importModelFile, isModelFile, openModelPicker } from './importMap'

const embedded = isEmbeddedHost()

const hash = (name: string) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/** Small icon button used inside a screen row. */
function RowBtn({
  title,
  onClick,
  active,
  danger,
  disabled,
  children,
}: {
  title: string
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded ring-focus transition disabled:opacity-25',
        active
          ? 'bg-brand-500/25 text-brand-300'
          : danger
            ? 'text-fog-400 enabled:hover:bg-bad/20 enabled:hover:text-bad'
            : 'text-fog-400 enabled:hover:bg-ink-700 enabled:hover:text-fog-100',
      )}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

/** Preview of a screen's current content (image / PSD layer canvas). */
function ScreenThumb({ name, hue }: { name: string; hue: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const uvVersion = useStore((s) => s.uvVersion)
  const shellIds = useStore((s) => s.mapObjects.find((o) => o.name === name)?.shellIds)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = '#0c0f14'
    ctx.fillRect(0, 0, cv.width, cv.height)
    const img = live.objTextures.get(name)?.image as HTMLImageElement | HTMLCanvasElement | undefined
    const iw = (img as HTMLImageElement)?.naturalWidth || (img as HTMLCanvasElement)?.width || 0
    const ih = (img as HTMLImageElement)?.naturalHeight || (img as HTMLCanvasElement)?.height || 0
    if (!img || !iw || !ih) {
      ctx.fillStyle = `hsl(${hue} 40% 26%)`
      ctx.fillRect(0, 0, cv.width, cv.height)
      return
    }

    // Crop to the region of the texture the screen's UVs actually sample, so the
    // thumbnail previews what lands on the object — not the whole source image.
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity
    for (const id of shellIds ?? []) {
      const uv = live.uv.get(id)
      if (!uv) continue
      for (let i = 0; i < uv.length; i += 2) {
        const u = uv[i]
        const v = uv[i + 1]
        if (u < u0) u0 = u
        if (u > u1) u1 = u
        if (v < v0) v0 = v
        if (v > v1) v1 = v
      }
    }

    // source crop rect in image pixels (UVs are flipY: image top → v=1)
    let sx = 0,
      sy = 0,
      sw = iw,
      sh = ih
    if (u1 > u0 && v1 > v0) {
      const cl = (n: number) => Math.min(1, Math.max(0, n))
      sx = cl(u0) * iw
      sw = (cl(u1) - cl(u0)) * iw
      sy = (1 - cl(v1)) * ih
      sh = (cl(v1) - cl(v0)) * ih
    }

    const s = Math.min(cv.width / sw, cv.height / sh)
    const w = sw * s
    const h = sh * s
    ctx.drawImage(img, sx, sy, sw, sh, (cv.width - w) / 2, (cv.height - h) / 2, w, h)
  }, [name, hue, uvVersion, shellIds])
  return (
    <canvas
      ref={ref}
      width={56}
      height={40}
      className="h-10 w-14 shrink-0 rounded border border-line bg-ink-950"
    />
  )
}

function ScreenRow({ name }: { name: string }) {
  const isSel = useStore((s) => s.selectedObject === name)
  const layeredMode = useStore((s) => s.layeredMode)
  const mapped = useStore((s) => s.mappedObjects.includes(name))
  const regions = useStore((s) => s.regions)
  const region = useStore((s) => s.assignment[name])
  const hidden = useStore((s) => s.hiddenScreens.includes(name))
  const solo = useStore((s) => s.soloScreen === name)
  useStore((s) => s.uvVersion) // refresh hasContent after add/remove

  const selectObject = useStore((s) => s.selectObject)
  const setObjectImage = useStore((s) => s.setObjectImage)
  const toggleHidden = useStore((s) => s.toggleHidden)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const assign = useStore((s) => s.assign)
  const runMapping = useStore((s) => s.runMapping)
  const resOverride = useStore((s) => s.screenRes[name])
  const setScreenRes = useStore((s) => s.setScreenRes)
  const shellIds = useStore((s) => s.mapObjects.find((o) => o.name === name)?.shellIds)

  const hasContent = live.objTextures.has(name)
  const hue = hash(name)
  // resolution the app found = the pixel size of the texture REGION this screen's
  // UVs cover (a chunk screen samples a slice of a bigger PSD), so it tracks any
  // re-target; the user can override it.
  const mediaImg = live.objTextures.get(name)?.image as
    | (CanvasImageSource & { width?: number; naturalWidth?: number; height?: number; naturalHeight?: number })
    | undefined
  const fullW = (mediaImg as { naturalWidth?: number })?.naturalWidth || (mediaImg as { width?: number })?.width || 0
  const fullH = (mediaImg as { naturalHeight?: number })?.naturalHeight || (mediaImg as { height?: number })?.height || 0
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity
  for (const id of shellIds ?? []) {
    const uv = live.uv.get(id)
    if (!uv) continue
    for (let i = 0; i < uv.length; i += 2) {
      if (uv[i] < u0) u0 = uv[i]
      if (uv[i] > u1) u1 = uv[i]
      if (uv[i + 1] < v0) v0 = uv[i + 1]
      if (uv[i + 1] > v1) v1 = uv[i + 1]
    }
  }
  const cl = (n: number) => Math.min(1, Math.max(0, n))
  const sub = u1 > u0 && v1 > v0 && (u1 - u0 < 0.999 || v1 - v0 < 0.999)
  const autoW = sub ? Math.round((cl(u1) - cl(u0)) * fullW) : fullW
  const autoH = sub ? Math.round((cl(v1) - cl(v0)) * fullH) : fullH
  const resW = resOverride?.w ?? autoW
  const resH = resOverride?.h ?? autoH
  const resMismatch = !!resOverride && autoW > 0 && (resOverride.w !== autoW || resOverride.h !== autoH)
  const fileRef = useRef<HTMLInputElement>(null)
  const { dragging, ref: dropRef } = useFileDrop((files) => {
    const f = files[0]
    if (f) setObjectImage(name, f)
  })
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) await setObjectImage(name, f)
    e.target.value = ''
  }

  const regionLabel = (id: number) => {
    const r = regions.find((x) => x.id === id)
    return r ? r.label || `Region ${id + 1}` : `Region ${id + 1}`
  }

  const status = mapped ? 'Mapped' : hasContent ? 'Not mapped' : 'No image'
  const statusColor = mapped ? 'text-good' : hasContent ? 'text-fog-400' : 'text-fog-500'

  return (
    <div
      ref={dropRef}
      onClick={() => selectObject(name)}
      className={clsx(
        'group/row relative cursor-pointer rounded-lg border px-2 py-2 transition',
        dragging
          ? 'border-brand-400 bg-brand-500/15'
          : isSel
            ? 'border-brand-500/40 bg-brand-500/10'
            : 'border-transparent hover:bg-ink-700/40',
        hidden && !isSel && 'opacity-45',
      )}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg text-[11px] font-medium text-brand-200">
          Drop image → {name}
        </div>
      )}

      {/* resting row: thumbnail · name + status · (hover/selected) actions */}
      <div className="flex items-center gap-2.5">
        <ScreenThumb name={name} hue={hue} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `hsl(${hue} 55% 58%)` }} />
            <span className="truncate text-sm text-fog-100">{name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span className={statusColor}>{status}</span>
            {resW > 0 && (
              <span className={resOverride ? 'text-brand-300' : 'text-fog-500'} title={resOverride ? 'custom resolution' : 'detected from media'}>
                · {resW}×{resH}
              </span>
            )}
          </div>
        </div>

        {/* actions appear on hover, stay visible when selected */}
        <div
          className={clsx(
            'flex shrink-0 items-center gap-0.5 transition-opacity',
            isSel ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
          )}
        >
          <RowBtn title={hasContent ? 'Replace image' : 'Add image'} onClick={() => fileRef.current?.click()}>
            {hasContent ? (
              <>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M12 3v12M8 7l4-4 4 4" />
              </>
            ) : (
              <path d="M12 5v14M5 12h14" />
            )}
          </RowBtn>
          {/* one control cycles: visible → solo → hidden → visible */}
          <RowBtn
            title={solo ? 'Soloed · click to hide' : hidden ? 'Hidden · click to show' : 'Visible · click to solo'}
            active={solo}
            onClick={() => {
              if (solo) {
                toggleSolo(name) // solo → hidden
                toggleHidden(name)
              } else if (hidden) {
                toggleHidden(name) // hidden → visible
              } else {
                toggleSolo(name) // visible → solo
              }
            }}
          >
            {solo ? (
              <>
                <circle cx="12" cy="12" r="4" />
                <circle cx="12" cy="12" r="9" opacity="0.4" />
              </>
            ) : hidden ? (
              <>
                <path d="M3 3l18 18" />
                <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-2.2 2.9M6.7 6.7A18 18 0 0 0 2 12s4 7 10 7a10.9 10.9 0 0 0 3.3-.5" />
              </>
            ) : (
              <>
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </RowBtn>
        </div>
      </div>

      {/* atlas mode: region picker (layered mode uses the thumbnail instead) */}
      {!layeredMode && (
        <select
          value={region ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value
            assign(name, v === '' ? null : Number(v))
            runMapping()
          }}
          className="mt-2 w-full rounded-md border border-line bg-ink-800 px-2 py-1 text-xs text-fog-200 ring-focus"
        >
          <option value="">— region —</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {regionLabel(r.id)}
            </option>
          ))}
        </select>
      )}

      {/* selected row expands to its config — transform tools live in the 2D viewer */}
      {isSel && (
        <>
        {/* render resolution — detected from media, editable to the real LED size */}
        <div
          className="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fog-500">Res</span>
          <input
            type="number"
            min={0}
            value={resW || ''}
            placeholder={String(autoW || '—')}
            onChange={(e) => setScreenRes(name, Number(e.target.value), resH)}
            className="w-16 rounded-md border border-line bg-ink-800 px-1.5 py-0.5 text-right text-[11px] text-fog-200 ring-focus"
          />
          <span className="text-fog-500">×</span>
          <input
            type="number"
            min={0}
            value={resH || ''}
            placeholder={String(autoH || '—')}
            onChange={(e) => setScreenRes(name, resW, Number(e.target.value))}
            className="w-16 rounded-md border border-line bg-ink-800 px-1.5 py-0.5 text-right text-[11px] text-fog-200 ring-focus"
          />
          <span className="text-[10px] text-fog-500">px</span>
          {resOverride && (
            <button
              onClick={() => setScreenRes(name, 0, 0)}
              title="Reset to detected resolution"
              className="rounded px-1 text-[10px] text-fog-400 hover:bg-ink-700 hover:text-fog-100"
            >
              auto
            </button>
          )}
          {resMismatch && (
            <span className="text-[10px] text-warn" title="applied media doesn't match this resolution">
              media {autoW}×{autoH}
            </span>
          )}
        </div>
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*,.psd" className="hidden" onChange={onFile} />
    </div>
  )
}

export default function MapPanel() {
  const mapObjects = useStore((s) => s.mapObjects)
  const layeredMode = useStore((s) => s.layeredMode)
  const atlas = useStore((s) => s.atlas)
  const screenOrder = useStore((s) => s.screenOrder)
  const contextCount = useStore((s) => s.contextCount)
  const contextShade = useStore((s) => s.contextShade)
  const setContextShade = useStore((s) => s.setContextShade)
  const contextVisible = useStore((s) => s.contextVisible)
  const setContextVisible = useStore((s) => s.setContextVisible)

  // ordered list of screens (draw order), tolerant of any out-of-sync names
  const ordered = (() => {
    const known = new Set(mapObjects.map((o) => o.name))
    const out = screenOrder.filter((n) => known.has(n))
    for (const o of mapObjects) if (!out.includes(o.name)) out.push(o.name)
    return out
  })()

  const modelRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef<HTMLInputElement>(null)
  const onModel = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const model = files.find(isModelFile)
    if (model) await importModelFile(model, null, files.filter((f) => f !== model && !isModelFile(f)))
    e.target.value = ''
  }
  const onImages = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) await importMapFiles(e.target.files)
    e.target.value = ''
  }

  const hasContentAnywhere = !!atlas || layeredMode

  return (
    <aside className="flex h-full w-80 flex-col overflow-y-auto border-l border-line bg-ink-900/60">
      {/* screens */}
      <div className="px-2.5 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fog-400/70">Screens</span>
      </div>

      <div className="flex flex-col gap-0.5 px-2 pb-4">
        {mapObjects.length === 0 ? (
          <div className="mx-1 flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-4 py-8 text-center">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fog-500" strokeLinejoin="round">
              <path d="M12 3 21 8v8l-9 5-9-5V8l9-5Z" />
              <path d="M3.5 8 12 13l8.5-5M12 13v8" />
            </svg>
            <div className="text-xs text-fog-400">No model loaded yet.</div>
            <button
              onClick={() => openModelPicker(modelRef.current)}
              className="rounded-md bg-brand-500/90 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-brand-400 ring-focus"
            >
              Import GLB
            </button>
            {!embedded && (
              <div className="text-[10px] text-fog-500/70">or drag a GLB / glTF onto the 3D view</div>
            )}
          </div>
        ) : (
          <>
            {!hasContentAnywhere && contextCount === 0 && (
              <div className="mx-1 mb-1 flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-3 py-4 text-center">
                <div className="text-xs text-fog-400">No content yet.</div>
                <button
                  onClick={() => imagesRef.current?.click()}
                  className="rounded-md bg-brand-500/90 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-brand-400 ring-focus"
                >
                  Add images
                </button>
                {!embedded && (
                  <div className="text-[10px] text-fog-500/70">or drop a map / images onto the 2D view</div>
                )}
              </div>
            )}
            {ordered.map((name) => (
              <ScreenRow key={name} name={name} />
            ))}
          </>
        )}
      </div>

      {/* reference geometry (non-screen objects) */}
      {contextCount > 0 && (
        <div className="border-t border-line px-3 py-3">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-fog-400/70">
            <span>Reference geometry</span>
            <span className="flex items-center gap-1.5 normal-case tracking-normal text-fog-400">
              {contextCount} obj
              <button
                onClick={() => setContextVisible(!contextVisible)}
                title={contextVisible ? 'Hide reference geometry' : 'Show reference geometry'}
                className="flex h-5 w-5 items-center justify-center rounded text-fog-400 hover:bg-ink-700 hover:text-fog-100"
              >
                {contextVisible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
            </span>
          </div>
          <div className={`flex items-center gap-2 ${!contextVisible ? 'pointer-events-none opacity-40' : ''}`}>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ring-white/15"
              style={{ background: greyHex(contextShade) }}
            />
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.005}
              value={contextShade}
              onChange={(e) => setContextShade(Number(e.target.value))}
              title="Reference brightness (black → 50% white)"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-white"
              style={{ background: 'linear-gradient(to right, #000, #808080)' }}
            />
          </div>
        </div>
      )}

      <input ref={modelRef} type="file" accept=".gltf,.glb,.psd,image/*" multiple className="hidden" onChange={onModel} />
      <input ref={imagesRef} type="file" accept="image/*,.psd" multiple className="hidden" onChange={onImages} />
    </aside>
  )
}

/** A 0..1 brightness as a #rrggbb grey, for the slider's swatch preview. */
function greyHex(shade: number) {
  const v = Math.round(Math.max(0, Math.min(1, shade)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${v}${v}${v}`
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-2.2 2.9M6.7 6.7A18 18 0 0 0 2 12s4 7 10 7a10.9 10.9 0 0 0 3.3-.5" />
    </svg>
  )
}
