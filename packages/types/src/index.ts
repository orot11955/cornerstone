export type Nullable<T> = T | null

export type Optional<T> = T | undefined

export type SortDirection = 'asc' | 'desc'

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

export interface PageRequest {
  page: number
  size: number
}

export interface PageResponse<T> {
  items: readonly T[]
  page: number
  size: number
  total: number
  totalPages: number
}
