import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import createServer, {
  configSchema,
  type SmitheryCommandContext
} from "../index.js";

export { configSchema };
export type { SmitheryCommandContext };

export function createServerFromSmithery(
  context?: SmitheryCommandContext
): Server {
  return createServer(context);
}

export default createServer;
