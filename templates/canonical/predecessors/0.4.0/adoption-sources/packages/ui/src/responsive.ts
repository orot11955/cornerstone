import type { CSSProperties } from 'react'

export const breakpoints = ['sm', 'md', 'lg', 'xl'] as const
export type Breakpoint = (typeof breakpoints)[number]
export type Responsive<T> = T | ({ readonly base?: T } & Partial<Readonly<Record<Breakpoint, T>>>)

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

  const responsive = value as {
    readonly base?: T
  } & Partial<Readonly<Record<Breakpoint, T>>>
  const properties: Record<string, string | number> = {}
  if (responsive.base !== undefined) properties[`--cs-${name}`] = serialize(responsive.base)
  for (const breakpoint of breakpoints) {
    const item = responsive[breakpoint]
    if (item !== undefined) properties[`--cs-${name}-${breakpoint}`] = serialize(item)
  }
  return properties as CustomProperties
}
