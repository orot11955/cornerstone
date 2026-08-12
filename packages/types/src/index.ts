export type Nullable<T> = T | null

export type Optional<T> = T | undefined

export type SortDirection = 'asc' | 'desc'

export interface PageRequest {
  page: number
  size: number
}

export interface PageResponse<T> {
  items: T[]
  page: number
  size: number
  total: number
  totalPages: number
}
