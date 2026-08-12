export const appearanceAttributes = [
  'data-theme',
  'data-style',
  'data-brand',
  'data-density',
] as const

export type Theme = 'light' | 'dark'
export type Style = 'industrial' | 'minimal' | 'soft'
export type Brand = 'signal-violet' | 'orange' | 'emerald' | (string & {})
export type Density = 'compact' | 'default' | 'comfortable'

export interface Appearance {
  readonly theme: Theme
  readonly style: Style
  readonly brand: Brand
  readonly density: Density
}
