import {
  appearancePresentation,
  defaultAppearanceRegistry,
  resolveAppearance,
  type Appearance,
  type AppearanceRegistry,
} from './appearance.js'

export function applyAppearance(
  appearance: Appearance,
  element: HTMLElement = document.documentElement,
  registry: AppearanceRegistry = defaultAppearanceRegistry,
): void {
  const presentation = appearancePresentation(appearance, registry)
  Object.assign(element.dataset, {
    theme: presentation.attributes['data-theme'],
    style: presentation.attributes['data-style'],
    brand: presentation.attributes['data-brand'],
    density: presentation.attributes['data-density'],
  })
  for (const [name, value] of Object.entries(presentation.style))
    element.style.setProperty(name, value)
}

export function readStoredAppearance(
  storage: Pick<Storage, 'getItem'>,
  key = 'cornerstone.appearance',
  fallback?: Appearance,
  registry: AppearanceRegistry = defaultAppearanceRegistry,
): Appearance {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    return registry.resolve(value && typeof value === 'object' ? value : {}, fallback)
  } catch {
    return registry.resolve({}, fallback)
  }
}

export { Portal } from './portal.js'
export type { PortalProps } from './portal.js'
export { Dialog } from './dialog.js'
export type { DialogContentProps, DialogRootProps } from './dialog.js'
export { Drawer, Menu, Popover, Tabs, Toast, Tooltip, computeFloatingPosition } from './overlay.js'
export type {
  DrawerContentProps,
  FloatingAlign,
  FloatingContentOptions,
  FloatingPlacement,
  FloatingPosition,
  FloatingPositionOptions,
  FloatingRect,
  FloatingViewport,
  MenuContentProps,
  MenuRootProps,
  PopoverContentProps,
  PopoverRootProps,
  TabsRootProps,
  TooltipContentProps,
  ToastRootProps,
  TooltipRootProps,
} from './overlay.js'
