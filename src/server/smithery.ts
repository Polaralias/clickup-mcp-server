import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createServer } from "./factory.js";
import { fromEnv, validateOrThrow } from "../shared/config/schema.js";

type SmitheryCommandContext = {
  env?: Record<string, string | undefined>;
};

export function createServerFromSmithery(
  context: SmitheryCommandContext | undefined
): Server {
  const combinedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...(context?.env ?? {})
  };
  if (context?.env) {
    for (const [key, value] of Object.entries(context.env)) {
      if (value === undefined) {
        continue;
      }
      process.env[key] = value;
    }
  }
  const config = fromEnv(combinedEnv);
  validateOrThrow(config);
  return createServer(config);
}
