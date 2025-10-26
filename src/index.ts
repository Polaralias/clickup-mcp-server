import { createRequire } from "node:module";
import { loadRuntimeConfig } from "./config/runtime.js";

const require = createRequire(import.meta.url);

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

function shouldUseHttp(): boolean {
  const runtime = loadRuntimeConfig();
  if (runtime.transport.kind === "http") {
    return true;
  }
  if (isTruthy(process.env.SMITHERY_HTTP)) {
    return true;
  }
  return Boolean(process.env.PORT);
}

const targetHost = shouldUseHttp() ? "./hosts/http.js" : "./hosts/stdio.js";

require(targetHost);
