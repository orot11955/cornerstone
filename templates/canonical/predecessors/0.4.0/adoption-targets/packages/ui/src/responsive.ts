import type { CSSProperties } from 'react'

export const breakpoints = ['sm', 'md', 'lg', 'xl'] as const
export type Breakpoint = (typeof breakpoints)[number]
export interface ResponsiveValues<T> extends Partial<Readonly<Record<Breakpoint, T>>> {
  readonly base?: T
}
export type Responsive<T> = T | ResponsiveValues<T>
export const containerBreakpoints = ['narrow', 'regular', 'wide'] as const
export type ContainerBreakpoint = (typeof containerBreakpoints)[number]
export interface ContainerResponsiveValues<T> extends Partial<
  Readonly<Record<ContainerBreakpoint, T>>
> {
  readonly base: T
}
export type ContainerResponsive<T> = T | ContainerResponsiveValues<T>

type CustomProperties = CSSProperties & Record<`--cs-${string}`, string | number>

export function responsiveProperties<T>(
  name: string,
  value: Responsive<T> | undefined,
  serialize: (item: T) => string | number = String,
): CSSProperties {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { [`--cs-${name}`]: serialize(value as T) } as CustomProperties
  }

  const responsive = value as ResponsiveValues<T>
  const properties: Record<string, string | number> = {}
  if (responsive.base !== undefined) properties[`--cs-${name}`] = serialize(responsive.base)
  for (const breakpoint of breakpoints) {
    const item = responsive[breakpoint]
    if (item !== undefined) properties[`--cs-${name}-${breakpoint}`] = serialize(item)
  }
  return properties as CustomProperties
}

export function containerResponsiveProperties<T>(
  name: string,
  value: ContainerResponsive<T> | undefined,
  serialize: (item: T) => string | number = String,
): CSSProperties {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { [`--cs-${name}`]: serialize(value as T) } as CustomProperties
  }
  const responsive = value as ContainerResponsiveValues<T>
  const properties: Record<string, string | number> = {
    [`--cs-${name}`]: serialize(responsive.base),
  }
  for (const breakpoint of containerBreakpoints) {
    const item = responsive[breakpoint]
    if (item !== undefined) properties[`--cs-${name}-${breakpoint}`] = serialize(item)
  }
  return properties as CustomProperties
}
