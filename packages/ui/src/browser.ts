import type { Appearance } from './index.js'

export function applyAppearance(
  appearance: Appearance,
  element: HTMLElement = document.documentElement,
): void {
  element.dataset.theme = appearance.theme
  element.dataset.style = appearance.style
  element.dataset.brand = appearance.brand
  element.dataset.density = appearance.density
}
