import { z } from 'zod'

export const emailSchema = z
  .string()
  .max(1024)
  .transform((value) => value.normalize('NFKC').trim().toLowerCase())
  .pipe(z.string().email().max(254))

export const urlSchema = z.string().url()

export const uuidSchema = z.string().uuid()

export const paginationSchema = z
  .object({
    page: z.coerce.number().int().safe().min(1).default(1),
    size: z.coerce.number().int().safe().min(1).max(100).default(20),
  })
  .strict()

export const sortSchema = z
  .object({
    sort: z.string().trim().min(1).max(64).optional(),
    direction: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict()

export const isoInstantSchema = z.iso.datetime({ offset: true })

export const dateRangeSchema = z
  .object({
    from: isoInstantSchema.optional(),
    to: isoInstantSchema.optional(),
  })
  .strict()
  .refine(({ from, to }) => !from || !to || Date.parse(from) <= Date.parse(to), {
    message: 'The end date must be on or after the start date.',
    path: ['to'],
  })

export type Pagination = z.infer<typeof paginationSchema>
export type Sort = z.infer<typeof sortSchema>
export type DateRange = z.infer<typeof dateRangeSchema>
