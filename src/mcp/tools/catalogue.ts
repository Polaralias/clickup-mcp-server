export type ToolDef = {
  name: string;
  description: string;
  annotations?: {
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
  };
};

type CatalogueAnnotations = {
  readOnlyHint: boolean;
  idempotentHint: boolean;
  destructiveHint: boolean;
};

type CataloguePagination = { supports: boolean; fields: string[] };

type CatalogueItem = {
  name: string;
  description: string;
  annotations: CatalogueAnnotations;
  pagination: CataloguePagination;
  characterLimit: number;
  inputExample?: unknown;
};

type VariableField = {
  length(): number;
  truncate(): void;
};

function resolveAnnotations(source?: ToolDef["annotations"]): CatalogueAnnotations {
  return {
    readOnlyHint: source?.readOnlyHint ?? false,
    idempotentHint: source?.idempotentHint ?? false,
    destructiveHint: source?.destructiveHint ?? false
  };
}

function resolveInputExample(name: string): unknown {
  if (name === "clickup_doc_search") {
    return { workspaceId: 123, query: "incident", limit: 10, page: 0 };
  }
  if (name === "clickup_bulk_doc_search") {
    return { workspaceId: 123, queries: ["runbook", "oncall"], options: { limit: 10, concurrency: 3 } };
  }
  if (name === "clickup_task_fuzzy_search") {
    return { query: "login bug", limit: 20 };
  }
  if (name === "clickup_bulk_task_fuzzy_search") {
    return { queries: ["login", "signup"], options: { limit: 20, concurrency: 3 } };
  }
  if (name === "health") {
    return {};
  }
  return undefined;
}

function resolvePagination(name: string): CataloguePagination {
  if (name.includes("_doc_search")) {
    return { supports: true, fields: ["limit", "page"] };
  }
  return { supports: false, fields: [] };
}

function halfString(value: string): string {
  if (value.length === 0) {
    return value;
  }
  const nextLength = Math.floor(value.length / 2);
  if (nextLength <= 0) {
    return "";
  }
  return value.slice(0, nextLength);
}

function buildVariableFields(items: CatalogueItem[]): VariableField[] {
  const fields: VariableField[] = [];
  for (const item of items) {
    fields.push({
      length: () => item.description.length,
      truncate: () => {
        item.description = halfString(item.description);
      }
    });
    if (typeof item.inputExample !== "undefined") {
      let exampleString = typeof item.inputExample === "string" ? item.inputExample : JSON.stringify(item.inputExample);
      fields.push({
        length: () => exampleString.length,
        truncate: () => {
          exampleString = halfString(exampleString);
          item.inputExample = exampleString;
        }
      });
    }
  }
  return fields;
}

function findLongestField(fields: VariableField[]): VariableField | undefined {
  let candidate: VariableField | undefined;
  for (const field of fields) {
    const size = field.length();
    if (size <= 0) {
      continue;
    }
    if (!candidate) {
      candidate = field;
      continue;
    }
    if (size > candidate.length()) {
      candidate = field;
    }
  }
  return candidate;
}

export function buildCatalogue(
  service: string,
  version: string,
  charLimit: number,
  tools: ToolDef[]
): {
  payload: {
    service: string;
    version: string;
    character_limit: number;
    tools: CatalogueItem[];
    truncated?: boolean;
    guidance?: string;
  };
} {
  const items: CatalogueItem[] = tools.map(tool => {
    const annotations = resolveAnnotations(tool.annotations);
    const pagination = resolvePagination(tool.name);
    const item: CatalogueItem = {
      name: tool.name,
      description: tool.description,
      annotations,
      pagination,
      characterLimit: charLimit
    };
    const example = resolveInputExample(tool.name);
    if (typeof example !== "undefined") {
      item.inputExample = example;
    }
    return item;
  });
  const payload: {
    service: string;
    version: string;
    character_limit: number;
    tools: CatalogueItem[];
    truncated?: boolean;
    guidance?: string;
  } = {
    service,
    version,
    character_limit: charLimit,
    tools: items
  };
  const fields = buildVariableFields(items);
  let truncated = false;
  const limit = charLimit;
  const measure = () => JSON.stringify(payload).length;
  while (measure() > limit) {
    const field = findLongestField(fields);
    if (!field) {
      break;
    }
    truncated = true;
    field.truncate();
  }
  if (measure() > limit) {
    payload.tools = [];
    truncated = true;
  }
  if (truncated) {
    payload.truncated = true;
    payload.guidance = "Output trimmed to character_limit";
  }
  return { payload };
}
