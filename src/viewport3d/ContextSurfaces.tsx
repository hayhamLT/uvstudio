import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../state/store'

/** Renders the non-screen "reference geometry" group as an OPAQUE grey shell
 *  whose brightness (black→white) is set via the panel slider. No textures, no
 *  mapping. Opaque avoids the front/back blend artifacts that semi-transparent
 *  double-sided shells produce. */
export default function ContextSurfaces() {
  const contextShells = useStore((s) => s.contextShells)
  const shade = useStore((s) => s.contextShade)
  // soloing a screen hides everything else, reference geometry included
  const visible = useStore((s) => s.contextVisible && s.soloScreen === null)
  // build the grey in sRGB so the on-screen brightness matches the slider value
  // (e.g. 0.5 → #808080, a true visual 50% grey — not linear-space ~73%)
  const color = useMemo(() => new THREE.Color().setRGB(shade, shade, shade, THREE.SRGBColorSpace), [shade])

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
          <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
