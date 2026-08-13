export const themes = ['light', 'dark'] as const
export const styles = ['industrial', 'minimal', 'soft'] as const
export const brands = ['signal-violet', 'orange', 'emerald'] as const
export const densities = ['compact', 'default', 'comfortable'] as const

export type Theme = (typeof themes)[number]
export type Style = (typeof styles)[number]
export type Brand = (typeof brands)[number] | (string & {})
export type Density = (typeof densities)[number]

export interface BrandPalette {
  readonly accent: string
  readonly contrast: string
  readonly focus: string
}

export interface BrandDefinition {
  readonly name: string
  readonly accent: string
  readonly contrast: string
  readonly focus?: string
  readonly theme?: Partial<Readonly<Record<Theme, Partial<BrandPalette>>>>
}

export interface AppearanceRegistry {
  readonly brands: readonly string[]
  readonly definitions: Readonly<Record<string, BrandDefinition>>
  readonly resolve: (
    input: Partial<Record<keyof Appearance, unknown>>,
    fallback?: Appearance,
  ) => Appearance
}

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

const builtinBrandDefinitions = [
  { name: 'signal-violet', accent: '#7c3aed', contrast: '#ffffff', focus: '#7c3aed' },
  { name: 'orange', accent: '#f97316', contrast: '#09090b', focus: '#c2410c' },
  { name: 'emerald', accent: '#10b981', contrast: '#09090b', focus: '#047857' },
] as const

export function defineBrand(definition: BrandDefinition): BrandDefinition {
  if (brands.includes(definition.name as (typeof brands)[number]) || definition.name === 'custom') {
    throw new Error('Built-in and reserved brand names cannot be redefined.')
  }
  return validateBrand(definition)
}

function validateBrand(definition: BrandDefinition): BrandDefinition {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(definition.name)) {
    throw new Error('Brand name must be a lowercase URL-safe slug.')
  }
  const palettes = [definition, ...Object.values(definition.theme ?? {})]
  for (const palette of palettes) {
    const accent = palette.accent ?? definition.accent
    const contrast = palette.contrast ?? definition.contrast
    const focus = palette.focus ?? definition.focus
    if (
      !isSafeColor(accent) ||
      !isSafeColor(contrast) ||
      (focus !== undefined && !isSafeColor(focus))
    ) {
      throw new Error('Brand colors must use a #rgb or #rrggbb value.')
    }
    if (contrastRatio(accent, contrast) < 4.5) {
      throw new Error('Brand accent and contrast must have at least 4.5:1 contrast.')
    }
  }
  const theme = definition.theme
    ? Object.freeze(
        Object.fromEntries(
          Object.entries(definition.theme).map(([name, palette]) => [
            name,
            Object.freeze({ ...palette }),
          ]),
        ),
      )
    : undefined
  return theme ? Object.freeze({ ...definition, theme }) : Object.freeze({ ...definition })
}

export function createAppearanceRegistry(
  customDefinitions: readonly BrandDefinition[] = [],
): AppearanceRegistry {
  const normalized = [
    ...builtinBrandDefinitions.map(validateBrand),
    ...customDefinitions.map(defineBrand),
  ]
  const names = normalized.map(({ name }) => name)
  if (new Set(names).size !== names.length) throw new Error('Brand names must be unique.')
  const definitionMap = Object.freeze(
    Object.fromEntries(normalized.map((definition) => [definition.name, definition])),
  ) as Readonly<Record<string, BrandDefinition>>
  return Object.freeze({
    brands: Object.freeze(names),
    definitions: definitionMap,
    resolve: (input: Partial<Record<keyof Appearance, unknown>>, fallback = defaultAppearance) =>
      resolveAppearance(input, fallback, { allowedBrands: names }),
  })
}

export const defaultAppearanceRegistry = createAppearanceRegistry()

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

export interface AppearancePresentation {
  readonly attributes: ReturnType<typeof appearanceDataAttributes>
  readonly style: Readonly<Record<`--cs-${string}`, string>>
}

export function appearancePresentation(
  appearance: Appearance,
  registry: AppearanceRegistry = defaultAppearanceRegistry,
): AppearancePresentation {
  const definition = registry.definitions[appearance.brand]
  if (!definition) return { attributes: appearanceDataAttributes(appearance), style: {} }
  const palette = { ...definition, ...definition.theme?.[appearance.theme] }
  return {
    attributes: appearanceDataAttributes(appearance),
    style: {
      '--cs-brand': palette.accent,
      '--cs-brand-contrast': palette.contrast,
      '--cs-focus': palette.focus ?? palette.accent,
    },
  }
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function isSafeColor(value: string): boolean {
  return /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value)
}

function contrastRatio(first: string, second: string): number {
  const luminance = (value: string) => {
    const hex =
      value.length === 4
        ? [...value.slice(1)].map((item) => `${item}${item}`).join('')
        : value.slice(1)
    const channels = [0, 2, 4].map(
      (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
    )
    const linear = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
  }
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}
