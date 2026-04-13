import type { AppTab } from '../appTabs'

const common = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
} as const

const sw = 1.65

type Props = { tab: AppTab; className?: string }

/** Icono de módulo (sidebar, dashboard, etc.); usa currentColor */
export function ModuleIcon({ tab, className }: Props) {
  const cn = className ? `module-icon ${className}` : 'module-icon'
  switch (tab) {
    case 'dashboard':
      return (
        <svg {...common} className={cn} aria-hidden>
          <path
            d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-8H10v8H5a1 1 0 0 1-1-1v-9.5Z"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'generar':
      return (
        <svg {...common} className={cn} aria-hidden>
          <rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" strokeWidth={sw} />
          <path d="M8 9.5h8M8 13h5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
          <circle cx="17" cy="7.5" r="1.2" fill="currentColor" />
        </svg>
      )
    case 'trazabilidad':
      return (
        <svg {...common} className={cn} aria-hidden>
          <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth={sw} />
          <path d="M16 16 20 20" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
          <path d="M8 10.5h5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        </svg>
      )
    case 'maestros':
      return (
        <svg {...common} className={cn} aria-hidden>
          <ellipse cx="12" cy="6.5" rx="7" ry="2.5" stroke="currentColor" strokeWidth={sw} />
          <path d="M5 6.5v5c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-5" stroke="currentColor" strokeWidth={sw} />
          <path d="M5 11.5v5c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-5" stroke="currentColor" strokeWidth={sw} />
        </svg>
      )
    case 'usuarios':
      return (
        <svg {...common} className={cn} aria-hidden>
          <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth={sw} />
          <path
            d="M3.5 19c.85-2.8 3.53-4.5 5.5-4.5s4.65 1.7 5.5 4.5"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <circle cx="17" cy="8" r="2.5" stroke="currentColor" strokeWidth={sw} />
          <path d="M14 19h7" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        </svg>
      )
  }
}
