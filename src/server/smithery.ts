import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createServer } from "./factory.js";
import { fromEnv, validateOrThrow } from "../shared/config/schema.js";

type SmitheryCommandContext = {
  env?: Record<string, string | undefined>;
};

export function createServerFromSmithery(
  context: SmitheryCommandContext | undefined
): Server {
  const smitheryEnv = context?.env ?? {};
  for (const [key, value] of Object.entries(smitheryEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const config = fromEnv();
  validateOrThrow(config);
  return createServer(config);
}
