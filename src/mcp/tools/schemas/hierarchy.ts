import { z } from "zod";

export const Page = z
  .object({ limit: z.number().int().min(1).max(100).default(50), page: z.number().int().min(0).default(0) })
  .strict();

export const ListWorkspacesInput = z.object({}).strict();
export const WorkspaceItem = z
  .object({ id: z.number().int(), name: z.string(), color: z.string().nullable().optional() })
  .strict();
export const ListWorkspacesOutput = z
  .object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
    results: z.array(WorkspaceItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ListSpacesInput = z
  .object({
    teamId: z.number().int().positive(),
    includeArchived: z.boolean().default(false),
    ...Page.shape
  })
  .strict();
export const SpaceItem = z
  .object({
    id: z.string(),
    name: z.string(),
    private: z.boolean().nullable().optional(),
    archived: z.boolean().nullable().optional()
  })
  .strict();
export const ListSpacesOutput = z
  .object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
    results: z.array(SpaceItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ListFoldersInput = z
  .object({
    spaceId: z.string().min(1),
    includeArchived: z.boolean().default(false),
    ...Page.shape
  })
  .strict();
export const FolderItem = z.object({ id: z.string(), name: z.string(), archived: z.boolean().nullable().optional() }).strict();
export const ListFoldersOutput = z
  .object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
    results: z.array(FolderItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ListListsInput = z
  .object({
    parentType: z.enum(["space", "folder"]),
    parentId: z.string().min(1),
    includeArchived: z.boolean().default(false),
    ...Page.shape
  })
  .strict();
export const ListItem = z
  .object({
    id: z.string(),
    name: z.string(),
    folderId: z.string().nullable().optional(),
    spaceId: z.string().nullable().optional(),
    archived: z.boolean().nullable().optional()
  })
  .strict();
export const ListListsOutput = z
  .object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
    results: z.array(ListItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ListTagsForSpaceInput = z.object({ spaceId: z.string().min(1) }).strict();
export const TagItem = z
  .object({ name: z.string(), tag_fg: z.string().nullable().optional(), tag_bg: z.string().nullable().optional() })
  .strict();
export const ListTagsForSpaceOutput = z
  .object({
    spaceId: z.string(),
    results: z.array(TagItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ListMembersInput = z.object({ teamId: z.number().int().positive(), ...Page.shape }).strict();
export const MemberItem = z
  .object({ id: z.number().int(), username: z.string().nullable(), email: z.string().nullable(), initials: z.string().nullable() })
  .strict();
export const ListMembersOutput = z
  .object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
    results: z.array(MemberItem),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ResolveMembersInput = z
  .object({ teamId: z.number().int().positive(), queries: z.array(z.string().min(1)).min(1).max(50) })
  .strict();
export const ResolveMembersOutput = z
  .object({
    resolved: z.array(z.object({ query: z.string(), matches: z.array(MemberItem) })).default([]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const ResolvePathInput = z.object({ teamId: z.number().int().positive(), path: z.string().min(1) }).strict();
export const ResolvePathOutput = z
  .object({
    path: z.string(),
    teamId: z.number().int(),
    space: z.object({ id: z.string(), name: z.string() }).optional(),
    folder: z.object({ id: z.string(), name: z.string() }).optional(),
    list: z.object({ id: z.string(), name: z.string() }).optional(),
    disambiguation: z
      .object({ space: z.array(SpaceItem).default([]), folder: z.array(FolderItem).default([]), list: z.array(ListItem).default([]) })
      .strict()
      .optional(),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();

export const WorkspaceOverviewInput = z
  .object({ teamId: z.number().int().positive(), includeArchived: z.boolean().default(false) })
  .strict();
export const WorkspaceOverviewOutput = z
  .object({
    teamId: z.number().int(),
    spaces: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            folders: z
              .array(z.object({ id: z.string(), name: z.string(), lists: z.array(z.object({ id: z.string(), name: z.string() })).default([]) }).strict())
              .default([])
          })
          .strict()
      )
      .default([]),
    truncated: z.boolean().optional(),
    guidance: z.string().optional()
  })
  .strict();
