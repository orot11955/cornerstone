import { resolveAppearance, type Appearance } from './appearance.js'

export function applyAppearance(
  appearance: Appearance,
  element: HTMLElement = document.documentElement,
): void {
  element.dataset.theme = appearance.theme
  element.dataset.style = appearance.style
  element.dataset.brand = appearance.brand
  element.dataset.density = appearance.density
}

export function readStoredAppearance(
  storage: Pick<Storage, 'getItem'>,
  key = 'cornerstone.appearance',
  fallback?: Appearance,
): Appearance {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    return resolveAppearance(value && typeof value === 'object' ? value : {}, fallback)
  } catch {
    return resolveAppearance({}, fallback)
  }
}

export { Portal } from './portal.js'
export type { PortalProps } from './portal.js'
