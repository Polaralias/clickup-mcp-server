import { z } from "zod";

export const Pagination = z.object({ limit: z.number().int().min(1).max(100), page: z.number().int().min(0) }).strict();
export const TruncationMeta = z.object({ truncated: z.boolean(), guidance: z.string().optional() }).strict();
