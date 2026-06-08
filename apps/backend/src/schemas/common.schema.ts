import { z } from "zod";

export const idSchema = z.string().trim().min(1, "Required");

export const idParamSchema = z.object({
  id: idSchema,
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(50).optional(),
  sortBy: z.string().trim().max(50).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
