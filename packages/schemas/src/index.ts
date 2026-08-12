import { z } from 'zod'

export const emailSchema = z.string().email()

export const urlSchema = z.string().url()

export const uuidSchema = z.string().uuid()

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
})

export const sortSchema = z.object({
  sort: z.string().trim().min(1).optional(),
  direction: z.enum(['asc', 'desc']).default('asc'),
})

export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    message: 'The end date must be on or after the start date.',
    path: ['to'],
  })

export type Pagination = z.infer<typeof paginationSchema>
export type Sort = z.infer<typeof sortSchema>
export type DateRange = z.infer<typeof dateRangeSchema>
