/**
 * Cornerstone UI token source of truth.
 *
 * `styles.css` is the generated runtime representation. The component test
 * verifies that every primitive below remains present in that stylesheet.
 */
export const tokenSourceId = 'cornerstone-ui-v1'

export const foundationTokens = {
  color: {
    white: '#fff',
    black: '#09090b',
    'gray-50': '#fafafa',
    'gray-100': '#f4f4f5',
    'gray-200': '#e4e4e7',
    'gray-300': '#d4d4d8',
    'gray-500': '#71717a',
    'gray-600': '#52525b',
    'gray-700': '#3f3f46',
    'gray-800': '#27272a',
    'gray-900': '#18181b',
    'violet-400': '#a78bfa',
    'violet-500': '#8b5cf6',
    'violet-600': '#7c3aed',
    'orange-500': '#f97316',
    'emerald-500': '#10b981',
    'red-500': '#ef4444',
    'amber-500': '#f59e0b',
    'blue-500': '#3b82f6',
  },
  spacing: {
    0: '0',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    10: '2.5rem',
    12: '3rem',
  },
  typography: {
    'font-sans':
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    'font-mono': "ui-monospace, 'SFMono-Regular', Consolas, monospace",
    'font-xs': '0.75rem',
    'font-sm': '0.875rem',
    'font-md': '1rem',
    'font-lg': '1.125rem',
    'font-xl': '1.375rem',
    'line-normal': '1.5',
  },
  radius: { none: '0', sm: '0.25rem', md: '0.5rem', lg: '0.75rem', full: '9999px' },
  shadow: { sm: '0 1px 2px rgb(0 0 0 / 0.12)', md: '0 8px 24px rgb(0 0 0 / 0.18)' },
  motion: {
    'duration-fast': '120ms',
    'duration-normal': '200ms',
    'ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
  },
  breakpoint: { sm: '36rem', md: '48rem', lg: '64rem', xl: '80rem' },
  containerBreakpoint: { narrow: '28rem', regular: '44rem', wide: '60rem' },
} as const

export const semanticTokens = {
  status: {
    success: 'var(--cs-color-emerald-500)',
    warning: 'var(--cs-color-amber-500)',
    danger: 'var(--cs-color-red-500)',
    info: 'var(--cs-color-blue-500)',
  },
  component: { 'control-height': '2.5rem', 'control-padding': 'var(--cs-space-3)' },
  layout: {
    'safe-top': 'env(safe-area-inset-top, 0px)',
    'safe-right': 'env(safe-area-inset-right, 0px)',
    'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
    'safe-left': 'env(safe-area-inset-left, 0px)',
    'grid-measure-xs': '12rem',
    'grid-measure-sm': '16rem',
    'grid-measure-md': '20rem',
    'grid-measure-lg': '24rem',
  },
} as const

export const tokenDeclarations = Object.freeze([
  ...Object.entries(foundationTokens.color).map(([name, value]) => [`--cs-color-${name}`, value]),
  ...Object.entries(foundationTokens.spacing).map(([name, value]) => [`--cs-space-${name}`, value]),
  ...Object.entries(foundationTokens.typography).map(([name, value]) => [`--cs-${name}`, value]),
  ...Object.entries(foundationTokens.radius).map(([name, value]) => [`--cs-radius-${name}`, value]),
  ...Object.entries(foundationTokens.shadow).map(([name, value]) => [`--cs-shadow-${name}`, value]),
  ...Object.entries(foundationTokens.motion).map(([name, value]) => [`--cs-${name}`, value]),
  ...Object.entries(foundationTokens.breakpoint).map(([name, value]) => [
    `--cs-breakpoint-${name}`,
    value,
  ]),
  ...Object.entries(foundationTokens.containerBreakpoint).map(([name, value]) => [
    `--cs-container-breakpoint-${name}`,
    value,
  ]),
  ...Object.entries(semanticTokens.status).map(([name, value]) => [`--cs-${name}`, value]),
  ...Object.entries(semanticTokens.component).map(([name, value]) => [`--cs-${name}`, value]),
  ...Object.entries(semanticTokens.layout).map(([name, value]) => [`--cs-${name}`, value]),
] as unknown as readonly (readonly [string, string])[])

export const semanticTokenNames = [
  'bg-canvas',
  'bg-surface',
  'bg-subtle',
  'text',
  'text-muted',
  'border',
  'focus',
  'brand',
  'brand-contrast',
  'success',
  'warning',
  'danger',
  'info',
] as const

export const componentTokenNames = [
  'control-height',
  'control-padding',
  'component-radius',
  'component-shadow',
] as const

export const appearanceAxes = ['theme', 'style', 'brand', 'density'] as const
