import { z } from "zod";
import { WorkspaceOverviewInput, WorkspaceOverviewOutput, SpaceItem, FolderItem, ListItem } from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/Errors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import { parseSpaces } from "./Spaces.js";
import { parseFolders } from "./Folders.js";
import { parseLists } from "./Lists.js";

type InputType = z.infer<typeof WorkspaceOverviewInput>;
type OutputType = z.infer<typeof WorkspaceOverviewOutput>;
type SpaceItemType = z.infer<typeof SpaceItem>;
type FolderItemType = z.infer<typeof FolderItem>;
type ListItemType = z.infer<typeof ListItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type OverviewFolder = { id: string; name: string; lists: { id: string; name: string }[] };
type OverviewSpace = { id: string; name: string; folders: OverviewFolder[] };

function cloneList(item: ListItemType): { id: string; name: string } {
  return { id: item.id, name: item.name };
}

function cloneFolder(item: FolderItemType): OverviewFolder {
  return { id: item.id, name: item.name, lists: [] };
}

function cloneSpace(item: SpaceItemType): OverviewSpace {
  return { id: item.id, name: item.name, folders: [] };
}

function shrinkListNames(spaces: OverviewSpace[]): boolean {
  let spaceIndex = -1;
  let folderIndex = -1;
  let listIndex = -1;
  let maxLength = -1;
  for (let i = 0; i < spaces.length; i += 1) {
    const space = spaces[i];
    if (!space) {
      continue;
    }
    for (let j = 0; j < space.folders.length; j += 1) {
      const folder = space.folders[j];
      if (!folder) {
        continue;
      }
      for (let k = 0; k < folder.lists.length; k += 1) {
        const list = folder.lists[k];
        const name = list?.name;
        if (typeof name === "string" && name.length > maxLength) {
          spaceIndex = i;
          folderIndex = j;
          listIndex = k;
          maxLength = name.length;
        }
      }
    }
  }
  if (spaceIndex === -1 || folderIndex === -1 || listIndex === -1 || maxLength <= 1) {
    return false;
  }
  const target = spaces[spaceIndex].folders[folderIndex].lists[listIndex];
  const nextLength = Math.max(0, Math.floor(target.name.length / 2));
  target.name = target.name.slice(0, nextLength);
  return true;
}

function shrinkFolderNames(spaces: OverviewSpace[]): boolean {
  let spaceIndex = -1;
  let folderIndex = -1;
  let maxLength = -1;
  for (let i = 0; i < spaces.length; i += 1) {
    const space = spaces[i];
    if (!space) {
      continue;
    }
    for (let j = 0; j < space.folders.length; j += 1) {
      const folder = space.folders[j];
      const name = folder?.name;
      if (typeof name === "string" && name.length > maxLength) {
        spaceIndex = i;
        folderIndex = j;
        maxLength = name.length;
      }
    }
  }
  if (spaceIndex === -1 || folderIndex === -1 || maxLength <= 1) {
    return false;
  }
  const folder = spaces[spaceIndex].folders[folderIndex];
  const nextLength = Math.max(0, Math.floor(folder.name.length / 2));
  folder.name = folder.name.slice(0, nextLength);
  return true;
}

function shrinkSpaceNames(spaces: OverviewSpace[]): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < spaces.length; i += 1) {
    const name = spaces[i]?.name;
    if (typeof name === "string" && name.length > maxLength) {
      index = i;
      maxLength = name.length;
    }
  }
  if (index === -1 || maxLength <= 1) {
    return false;
  }
  const space = spaces[index];
  const nextLength = Math.max(0, Math.floor(space.name.length / 2));
  space.name = space.name.slice(0, nextLength);
  return true;
}

function enforceLimit(out: OutputType): void {
  const limit = characterLimit();
  let payload = JSON.stringify(out);
  if (payload.length <= limit) {
    return;
  }
  let truncated = false;
  const shrinkers: Array<() => boolean> = [
    () => shrinkListNames(out.spaces),
    () => shrinkFolderNames(out.spaces),
    () => shrinkSpaceNames(out.spaces)
  ];
  for (const shrink of shrinkers) {
    while (payload.length > limit) {
      if (!shrink()) {
        break;
      }
      truncated = true;
      payload = JSON.stringify(out);
    }
  }
  if (payload.length > limit) {
    truncated = true;
  }
  if (truncated) {
    out.truncated = true;
    out.guidance = "Output trimmed to character_limit";
  }
}

async function loadAllSpaces(gateway: ClickUpGateway, teamId: number, includeArchived: boolean): Promise<SpaceItemType[]> {
  const limit = 100;
  const spaces: SpaceItemType[] = [];
  let page = 0;
  while (true) {
    const response = await gateway.list_spaces(teamId, page, limit, includeArchived);
    const parsed = parseSpaces(response);
    spaces.push(...parsed.items);
    const hasMore = parsed.total !== null ? (page + 1) * limit < parsed.total : parsed.items.length === limit;
    if (!hasMore || parsed.items.length === 0) {
      break;
    }
    page += 1;
    if (page >= 100) {
      break;
    }
  }
  return spaces;
}

async function loadAllFolders(gateway: ClickUpGateway, spaceId: string, includeArchived: boolean): Promise<FolderItemType[]> {
  const limit = 100;
  const folders: FolderItemType[] = [];
  let page = 0;
  while (true) {
    const response = await gateway.list_folders(spaceId, page, limit, includeArchived);
    const parsed = parseFolders(response);
    folders.push(...parsed.items);
    const hasMore = parsed.total !== null ? (page + 1) * limit < parsed.total : parsed.items.length === limit;
    if (!hasMore || parsed.items.length === 0) {
      break;
    }
    page += 1;
    if (page >= 100) {
      break;
    }
  }
  return folders;
}

async function loadAllLists(
  gateway: ClickUpGateway,
  parentType: "space" | "folder",
  parentId: string,
  includeArchived: boolean
): Promise<ListItemType[]> {
  const limit = 100;
  const lists: ListItemType[] = [];
  let page = 0;
  while (true) {
    const response = await gateway.list_lists_under(parentType, parentId, page, limit, includeArchived);
    const parsed = parseLists(response);
    lists.push(...parsed.items);
    const hasMore = parsed.total !== null ? (page + 1) * limit < parsed.total : parsed.items.length === limit;
    if (!hasMore || parsed.items.length === 0) {
      break;
    }
    page += 1;
    if (page >= 100) {
      break;
    }
  }
  return lists;
}

function groupLists(folders: FolderItemType[], listsUnderSpace: ListItemType[]): OverviewFolder[] {
  const folderMap = new Map<string, OverviewFolder>();
  for (const folder of folders) {
    folderMap.set(folder.id, cloneFolder(folder));
  }
  const rootLists: OverviewFolder = { id: "", name: "Direct lists", lists: [] };
  for (const list of listsUnderSpace) {
    if (list.folderId) {
      const existing = folderMap.get(list.folderId);
      if (existing) {
        existing.lists.push(cloneList(list));
      }
    } else {
      rootLists.lists.push(cloneList(list));
    }
  }
  const result: OverviewFolder[] = Array.from(folderMap.values());
  if (rootLists.lists.length > 0) {
    result.push(rootLists);
  }
  return result;
}

export class WorkspaceOverview {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = WorkspaceOverviewInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    try {
      const spacesRaw = await loadAllSpaces(this.gateway, data.teamId, data.includeArchived);
      const overviewSpaces: OverviewSpace[] = [];
      for (const space of spacesRaw) {
        const spaceNode = cloneSpace(space);
        const foldersRaw = await loadAllFolders(this.gateway, space.id, data.includeArchived);
        const listsUnderSpace = await loadAllLists(this.gateway, "space", space.id, data.includeArchived);
        const folders = groupLists(foldersRaw, listsUnderSpace);
        for (const folder of folders) {
          if (folder.id !== "") {
            const listsUnderFolder = await loadAllLists(this.gateway, "folder", folder.id, data.includeArchived);
            const seen = new Set(folder.lists.map(item => item.id));
            for (const entry of listsUnderFolder) {
              if (!seen.has(entry.id)) {
                folder.lists.push(cloneList(entry));
                seen.add(entry.id);
              }
            }
          }
          spaceNode.folders.push({ id: folder.id, name: folder.name, lists: folder.lists.map(item => ({ id: item.id, name: item.name })) });
        }
        overviewSpaces.push(spaceNode);
      }
      const out: OutputType = { teamId: data.teamId, spaces: overviewSpaces };
      enforceLimit(out);
      return ok(out, out.truncated === true, out.guidance);
    } catch (error) {
      const httpError = error as HttpErrorLike;
      if (httpError && typeof httpError.status === "number") {
        const mapped = mapHttpError(httpError.status, httpError.data);
        return err(mapped.code, mapped.message, mapped.details);
      }
      const message = error instanceof Error ? error.message : String(error);
      return err("UNKNOWN", message);
    }
  }
}
