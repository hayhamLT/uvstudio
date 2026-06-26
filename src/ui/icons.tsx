import type { SVGProps } from 'react'

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const IconOrbit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(30 12 12)" />
  </svg>
)
export const IconCut = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <path d="M8 7.5 20 18M8 16.5 20 6" />
  </svg>
)
export const IconLoop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9c0-2.2 3.6-4 8-4s8 1.8 8 4-3.6 4-8 4-8-1.8-8-4Z" />
    <path d="M4 9v6c0 2.2 3.6 4 8 4s8-1.8 8-4V9" />
  </svg>
)
export const IconRing = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="8" width="6" height="8" rx="1" />
    <rect x="9" y="8" width="6" height="8" rx="1" />
    <rect x="15" y="8" width="6" height="8" rx="1" />
    <path d="M12 4v16" stroke="currentColor" strokeDasharray="2 2" />
  </svg>
)
export const IconWeld = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12h5M14 12h5" />
    <path d="M10 8l4 8M14 8l-4 8" />
  </svg>
)
export const IconSelect = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 4l6 16 2.2-6.2L19.5 11 5 4Z" />
  </svg>
)
export const IconFlatten = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
    <path d="M3 14l9 5 9-5" />
  </svg>
)
export const IconPack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="1.5" />
    <rect x="5.5" y="5.5" width="6" height="8" rx="1" />
    <rect x="13" y="5.5" width="5.5" height="5" rx="1" />
    <rect x="13" y="12" width="5.5" height="6.5" rx="1" />
    <rect x="5.5" y="15" width="6" height="3.5" rx="1" />
  </svg>
)
export const IconSymmetry = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M9 7 4 12l5 5V7ZM15 7l5 5-5 5V7Z" />
  </svg>
)
export const IconAuto = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
)
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
)
export const IconExport = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
)
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 9v11M8 13l4-4 4 4" />
    <path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
  </svg>
)
export const IconShapes = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="3.4" />
    <rect x="13" y="3.6" width="7" height="7" rx="1" />
    <path d="M7 13.5 11 21H3l4-7.5Z" />
    <rect x="13" y="13.5" width="7" height="7" rx="3.5" />
  </svg>
)
export const IconHelp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2-2.5 3.5" />
    <path d="M12 17h.01" />
  </svg>
)
export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
