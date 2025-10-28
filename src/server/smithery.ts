import createServer, {
  configSchema,
  type SmitheryCommandContext
} from "../index.js";

export { configSchema };
export type { SmitheryCommandContext };

type SmitheryEntryPoint = ((
  context?: SmitheryCommandContext
) => ReturnType<typeof createServer>) & {
  configSchema: typeof configSchema;
};

const createServerFromSmithery: SmitheryEntryPoint = Object.assign(
  async (context?: SmitheryCommandContext) => createServer(context),
  { configSchema }
);

const createServerWithSchema: SmitheryEntryPoint = Object.assign(createServer, {
  configSchema
});

export { createServerFromSmithery };

export default createServerWithSchema;
