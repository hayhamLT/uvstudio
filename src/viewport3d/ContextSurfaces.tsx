import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../state/store'

/** Renders the non-screen "reference geometry" group as a grey shell whose
 *  brightness (black→white) and opacity (ghost→solid) are set via the panel
 *  sliders. No textures, no mapping.
 *
 *  Transparency, done flicker-free: below 100% the material switches to
 *  `transparent` with `depthWrite: false`. Writing no depth means transparent
 *  fragments can never z-fight each other (the classic shimmer of transparent
 *  double-sided shells comes from depth-writing in camera-dependent draw
 *  order), and DoubleSide only disables culling — each triangle still draws
 *  exactly once, so a single-sheet wall never double-blends against itself.
 *  Screens keep writing depth, so reference geometry behind a screen stays
 *  hidden while screens behind reference geometry glow through the ghost —
 *  which is the point of dimming it. At exactly 100% it renders opaque with
 *  real depth, restoring true occlusion. */
export default function ContextSurfaces() {
  const contextShells = useStore((s) => s.contextShells)
  const shade = useStore((s) => s.contextShade)
  const opacity = useStore((s) => s.contextOpacity)
  // soloing a screen hides everything else, reference geometry included
  const visible = useStore((s) => s.contextVisible && s.soloScreen === null)
  // build the grey in sRGB so the on-screen brightness matches the slider value
  // (e.g. 0.5 → #808080, a true visual 50% grey — not linear-space ~73%)
  const color = useMemo(() => new THREE.Color().setRGB(shade, shade, shade, THREE.SRGBColorSpace), [shade])
  const ghost = opacity < 0.995

  const geos = useMemo(() => {
    return contextShells.map((cs) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(cs.shell.positions.slice(), 3))
      g.setIndex(Array.from(cs.shell.triangles))
      g.computeVertexNormals()
      return g
    })
  }, [contextShells])

  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])

  if (!visible) return null
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} renderOrder={-1}>
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent={ghost}
            opacity={ghost ? opacity : 1}
            depthWrite={!ghost}
          />
        </mesh>
      ))}
    </group>
  )
}
