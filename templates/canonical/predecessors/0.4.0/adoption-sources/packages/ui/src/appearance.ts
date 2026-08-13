export const themes = ['light', 'dark'] as const
export const styles = ['industrial', 'minimal', 'soft'] as const
export const brands = ['signal-violet', 'orange', 'emerald'] as const
export const densities = ['compact', 'default', 'comfortable'] as const

export type Theme = (typeof themes)[number]
export type Style = (typeof styles)[number]
export type Brand = (typeof brands)[number] | (string & {})
export type Density = (typeof densities)[number]

export interface Appearance {
  readonly theme: Theme
  readonly style: Style
  readonly brand: Brand
  readonly density: Density
}

export const defaultAppearance: Appearance = {
  theme: 'dark',
  style: 'industrial',
  brand: 'signal-violet',
  density: 'default',
}

export function resolveAppearance(
  input: Partial<Record<keyof Appearance, unknown>>,
  fallback: Appearance = defaultAppearance,
  options: { readonly allowedBrands?: readonly string[] } = {},
): Appearance {
  return {
    theme: includes(themes, input.theme) ? input.theme : fallback.theme,
    style: includes(styles, input.style) ? input.style : fallback.style,
    brand:
      includes(brands, input.brand) ||
      (typeof input.brand === 'string' && options.allowedBrands?.includes(input.brand))
        ? input.brand
        : fallback.brand,
    density: includes(densities, input.density) ? input.density : fallback.density,
  }
}

export function appearanceDataAttributes(appearance: Appearance) {
  return {
    'data-theme': appearance.theme,
    'data-style': appearance.style,
    'data-brand': appearance.brand,
    'data-density': appearance.density,
  } as const
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}
