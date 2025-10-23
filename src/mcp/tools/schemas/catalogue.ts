import { z } from "zod";

export const CatalogueRequest = z.object({}).strict();

export const CatalogueToolItem = z
  .object({
    name: z.string(),
    description: z.string(),
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        idempotentHint: z.boolean(),
        destructiveHint: z.boolean()
      })
      .strict(),
    inputExample: z.unknown().optional(),
    pagination: z
      .object({
        supports: z.boolean(),
        fields: z.array(z.string()).default([])
      })
      .strict(),
    characterLimit: z.number().int().positive()
  })
  .strict();

export const CatalogueOutput = z
  .object({
    service: z.string(),
    version: z.string(),
    character_limit: z.number().int().positive(),
    tools: z.array(CatalogueToolItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();
