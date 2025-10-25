import { z } from "zod";
import {
  ResolvePathInput,
  ResolvePathOutput,
  SpaceItem,
  FolderItem,
  ListItem
} from "../../../mcp/tools/schemas/hierarchy.js";
import { characterLimit } from "../../../config/runtime.js";
import { err, ok, Result } from "../../../shared/Result.js";
import { mapHttpError } from "../../../shared/httpErrors.js";
import type { ClickUpGateway } from "../../../infrastructure/clickup/ClickUpGateway.js";
import { parseSpaces } from "../hierarchy/Spaces.js";
import { parseFolders } from "../hierarchy/Folders.js";
import { parseLists } from "../hierarchy/Lists.js";

type InputType = z.infer<typeof ResolvePathInput>;
type OutputType = z.infer<typeof ResolvePathOutput>;
type SpaceItemType = z.infer<typeof SpaceItem>;
type FolderItemType = z.infer<typeof FolderItem>;
type ListItemType = z.infer<typeof ListItem>;

type HttpErrorLike = { status?: number; data?: unknown };

type MatchResult<T> = { match?: T; disambiguation?: T[]; guidance?: string };

type Disambiguation = { space: SpaceItemType[]; folder: FolderItemType[]; list: ListItemType[] };

function limitArray<T>(items: T[], max: number): T[] {
  if (items.length <= max) {
    return [...items];
  }
  return items.slice(0, max);
}

function cloneSpace(item: SpaceItemType): SpaceItemType {
  const clone: SpaceItemType = { id: item.id, name: item.name };
  if (Object.prototype.hasOwnProperty.call(item, "private")) {
    clone.private = item.private ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(item, "archived")) {
    clone.archived = item.archived ?? null;
  }
  return clone;
}

function cloneFolder(item: FolderItemType): FolderItemType {
  const clone: FolderItemType = { id: item.id, name: item.name };
  if (Object.prototype.hasOwnProperty.call(item, "archived")) {
    clone.archived = item.archived ?? null;
  }
  return clone;
}

function cloneList(item: ListItemType): ListItemType {
  const clone: ListItemType = { id: item.id, name: item.name };
  if (Object.prototype.hasOwnProperty.call(item, "folderId")) {
    clone.folderId = item.folderId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(item, "spaceId")) {
    clone.spaceId = item.spaceId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(item, "archived")) {
    clone.archived = item.archived ?? null;
  }
  return clone;
}

function shrinkNames<T extends { name: string }>(items: T[]): boolean {
  let index = -1;
  let maxLength = -1;
  for (let i = 0; i < items.length; i += 1) {
    const candidate = items[i];
    if (!candidate) {
      continue;
    }
    const name = candidate.name;
    if (typeof name === "string" && name.length > maxLength) {
      index = i;
      maxLength = name.length;
    }
  }
  if (index === -1 || maxLength <= 1) {
    return false;
  }
  const current = items[index].name;
  const nextLength = Math.max(0, Math.floor(current.length / 2));
  items[index].name = current.slice(0, nextLength);
  return true;
}

function shrinkSingle(item: { name: string } | undefined): boolean {
  if (!item) {
    return false;
  }
  const name = item.name;
  if (typeof name !== "string" || name.length <= 1) {
    return false;
  }
  const nextLength = Math.max(0, Math.floor(name.length / 2));
  item.name = name.slice(0, nextLength);
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
    () => (out.disambiguation ? shrinkNames(out.disambiguation.space) : false),
    () => (out.disambiguation ? shrinkNames(out.disambiguation.folder) : false),
    () => (out.disambiguation ? shrinkNames(out.disambiguation.list) : false),
    () => shrinkSingle(out.list),
    () => shrinkSingle(out.folder),
    () => shrinkSingle(out.space)
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

function matchEntity<T extends { name: string }>(items: T[], segment: string): MatchResult<T> {
  const exact = items.filter(item => item.name === segment);
  const lower = segment.toLowerCase();
  const caseInsensitive = items.filter(item => item.name.toLowerCase() === lower);
  if (exact.length > 1) {
    return { disambiguation: exact, guidance: `Multiple matches for "${segment}".` };
  }
  if (exact.length === 1) {
    if (caseInsensitive.length > 1) {
      return { disambiguation: caseInsensitive, guidance: `Multiple matches for "${segment}".` };
    }
    return { match: exact[0] };
  }
  if (caseInsensitive.length > 1) {
    return { disambiguation: caseInsensitive, guidance: `Multiple matches for "${segment}".` };
  }
  if (caseInsensitive.length === 1) {
    return { match: caseInsensitive[0] };
  }
  const partial = items.filter(item => item.name.toLowerCase().includes(lower));
  if (partial.length > 0) {
    return { disambiguation: partial, guidance: `No exact match for "${segment}". Choose from similar options.` };
  }
  if (items.length > 0) {
    return { disambiguation: items, guidance: `No match for "${segment}". Choose from available options.` };
  }
  return { guidance: `No match for "${segment}".` };
}

async function loadAllSpaces(gateway: ClickUpGateway, teamId: number): Promise<SpaceItemType[]> {
  const limit = 100;
  const spaces: SpaceItemType[] = [];
  let page = 0;
  while (true) {
    const response = await gateway.list_spaces(teamId, page, limit, false);
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

async function loadAllFolders(gateway: ClickUpGateway, spaceId: string): Promise<FolderItemType[]> {
  const limit = 100;
  const folders: FolderItemType[] = [];
  let page = 0;
  while (true) {
    const response = await gateway.list_folders(spaceId, page, limit, false);
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
  parentId: string
): Promise<ListItemType[]> {
  const limit = 100;
  const lists: ListItemType[] = [];
  let page = 0;
  while (true) {
    const response = await gateway.list_lists_under(parentType, parentId, page, limit, false);
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

function createDisambiguation(): Disambiguation {
  return { space: [], folder: [], list: [] };
}

function prepareSpaces(items: SpaceItemType[], max: number): SpaceItemType[] {
  return limitArray(items, max).map(cloneSpace);
}

function prepareFolders(items: FolderItemType[], max: number): FolderItemType[] {
  return limitArray(items, max).map(cloneFolder);
}

function prepareLists(items: ListItemType[], max: number): ListItemType[] {
  return limitArray(items, max).map(cloneList);
}

function contextualiseGuidance(entity: string, guidance: string | undefined, fallback: string): string {
  if (guidance && guidance.length > 0) {
    const trimmed = guidance.trim();
    if (trimmed.length === 0) {
      return fallback;
    }
    if (trimmed.toLowerCase().startsWith(entity.toLowerCase())) {
      return trimmed;
    }
    return `${entity}: ${trimmed}`;
  }
  return fallback;
}

export class ResolvePath {
  constructor(private readonly gateway: ClickUpGateway) {}

  async execute(ctx: unknown, input: InputType): Promise<Result<OutputType>> {
    void ctx;
    const parsed = ResolvePathInput.safeParse(input ?? {});
    if (!parsed.success) {
      return err("INVALID_PARAMETER", "Invalid parameters", parsed.error.flatten());
    }
    const data = parsed.data;
    const segments = data.path
      .split("/")
      .map(part => part.trim())
      .filter(part => part.length > 0);
    if (segments.length === 0) {
      return err("INVALID_PARAMETER", "Path must include at least one segment");
    }
    try {
      const spaces = await loadAllSpaces(this.gateway, data.teamId);
      const spaceResult = matchEntity(spaces, segments[0]);
      if (!spaceResult.match) {
        const disambiguation = createDisambiguation();
        if (spaceResult.disambiguation && spaceResult.disambiguation.length > 0) {
          disambiguation.space = prepareSpaces(spaceResult.disambiguation, 10);
        } else {
          disambiguation.space = prepareSpaces(spaces, 10);
        }
        const out: OutputType = {
          path: data.path,
          teamId: data.teamId,
          disambiguation,
          guidance: contextualiseGuidance("Space", spaceResult.guidance, `Space "${segments[0]}" not found.`)
        };
        enforceLimit(out);
        return ok(out, out.truncated === true, out.guidance);
      }
      const resolvedSpace = cloneSpace(spaceResult.match);
      if (segments.length === 1) {
        const out: OutputType = { path: data.path, teamId: data.teamId, space: { id: resolvedSpace.id, name: resolvedSpace.name } };
        enforceLimit(out);
        return ok(out, out.truncated === true, out.guidance);
      }
      const folders = await loadAllFolders(this.gateway, resolvedSpace.id);
      const listsUnderSpace = await loadAllLists(this.gateway, "space", resolvedSpace.id);
      const second = segments[1];
      const folderResult = matchEntity(folders, second);
      if (!folderResult.match) {
        const listResult = matchEntity(listsUnderSpace, second);
        if (listResult.match) {
          const resolvedList = cloneList(listResult.match);
          const out: OutputType = {
            path: data.path,
            teamId: data.teamId,
            space: { id: resolvedSpace.id, name: resolvedSpace.name },
            list: { id: resolvedList.id, name: resolvedList.name },
            guidance: segments.length > 2 ? "List resolved; additional segments were ignored." : undefined
          };
          if (typeof out.guidance === "undefined") {
            delete out.guidance;
          }
          enforceLimit(out);
          return ok(out, out.truncated === true, out.guidance);
        }
        if (folderResult.disambiguation && folderResult.disambiguation.length > 0) {
          const disambiguation = createDisambiguation();
          disambiguation.space = [cloneSpace(resolvedSpace)];
          disambiguation.folder = prepareFolders(folderResult.disambiguation, 10);
          const out: OutputType = {
            path: data.path,
            teamId: data.teamId,
            space: { id: resolvedSpace.id, name: resolvedSpace.name },
            disambiguation,
            guidance: contextualiseGuidance("Folder", folderResult.guidance, `Multiple folders matched "${second}".`)
          };
          enforceLimit(out);
          return ok(out, out.truncated === true, out.guidance);
        }
        if (listResult.disambiguation && listResult.disambiguation.length > 0) {
          const disambiguation = createDisambiguation();
          disambiguation.space = [cloneSpace(resolvedSpace)];
          disambiguation.list = prepareLists(listResult.disambiguation, 10);
          const out: OutputType = {
            path: data.path,
            teamId: data.teamId,
            space: { id: resolvedSpace.id, name: resolvedSpace.name },
            disambiguation,
            guidance: contextualiseGuidance("List", listResult.guidance, `Multiple lists matched "${second}".`)
          };
          enforceLimit(out);
          return ok(out, out.truncated === true, out.guidance);
        }
        const disambiguation = createDisambiguation();
        disambiguation.space = [cloneSpace(resolvedSpace)];
        disambiguation.folder = prepareFolders(folders, 10);
        disambiguation.list = prepareLists(listsUnderSpace, 10);
        const out: OutputType = {
          path: data.path,
          teamId: data.teamId,
          space: { id: resolvedSpace.id, name: resolvedSpace.name },
          disambiguation,
          guidance: contextualiseGuidance("Folder", folderResult.guidance, `Folder "${second}" not found.`)
        };
        enforceLimit(out);
        return ok(out, out.truncated === true, out.guidance);
      }
      const resolvedFolder = cloneFolder(folderResult.match);
      if (segments.length === 2) {
        const out: OutputType = {
          path: data.path,
          teamId: data.teamId,
          space: { id: resolvedSpace.id, name: resolvedSpace.name },
          folder: { id: resolvedFolder.id, name: resolvedFolder.name }
        };
        enforceLimit(out);
        return ok(out, out.truncated === true, out.guidance);
      }
      const listsUnderFolder = await loadAllLists(this.gateway, "folder", resolvedFolder.id);
      const third = segments[2];
      const listResult = matchEntity(listsUnderFolder, third);
      if (!listResult.match) {
        const disambiguation = createDisambiguation();
        disambiguation.space = [cloneSpace(resolvedSpace)];
        disambiguation.folder = [cloneFolder(resolvedFolder)];
        if (listResult.disambiguation && listResult.disambiguation.length > 0) {
          disambiguation.list = prepareLists(listResult.disambiguation, 10);
        } else {
          disambiguation.list = prepareLists(listsUnderFolder, 10);
        }
        const out: OutputType = {
          path: data.path,
          teamId: data.teamId,
          space: { id: resolvedSpace.id, name: resolvedSpace.name },
          folder: { id: resolvedFolder.id, name: resolvedFolder.name },
          disambiguation,
          guidance: contextualiseGuidance("List", listResult.guidance, `List "${third}" not found.`)
        };
        enforceLimit(out);
        return ok(out, out.truncated === true, out.guidance);
      }
      const resolvedList = cloneList(listResult.match);
      const out: OutputType = {
        path: data.path,
        teamId: data.teamId,
        space: { id: resolvedSpace.id, name: resolvedSpace.name },
        folder: { id: resolvedFolder.id, name: resolvedFolder.name },
        list: { id: resolvedList.id, name: resolvedList.name },
        guidance: segments.length > 3 ? "Only space/folder/list segments are supported." : undefined
      };
      if (typeof out.guidance === "undefined") {
        delete out.guidance;
      }
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
