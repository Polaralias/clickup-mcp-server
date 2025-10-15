/**
 * SPDX-FileCopyrightText: © 2025 Talib Kareem <taazkareem@icloud.com>
 * SPDX-License-Identifier: MIT
 *
 * Configuration handling for ClickUp API credentials and application settings
 *
 * The required environment variables (CLICKUP_API_KEY and CLICKUP_TEAM_ID) are passed
 * securely to this file when running the hosted server at smithery.ai. Optionally,
 * they can be parsed via command line arguments when running the server locally.
 *
 * The document support is optional and can be passed via command line arguments.
 * The default value is 'false' (string), which means document support will be disabled if
 * no parameter is passed. Pass it as 'true' (string) to enable it.
 *
 * Tool filtering options:
 * - ENABLED_TOOLS: Comma-separated list of tools to enable (takes precedence over DISABLED_TOOLS)
 * - DISABLED_TOOLS: Comma-separated list of tools to disable (ignored if ENABLED_TOOLS is specified)
 *
 * Server transport options:
 * - ENABLE_SSE: Enable Server-Sent Events transport (default: false)
 * - SSE_PORT: Port for SSE server (default: 3000)
 * - ENABLE_STDIO: Enable STDIO transport (default: true)
 */

// Parse any command line environment arguments
const args = process.argv.slice(2);
const envArgs: { [key: string]: string } = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--env" && i + 1 < args.length) {
    const [key, value] = args[i + 1].split("=");
    if (key === "CLICKUP_API_KEY") envArgs.clickupApiKey = value;
    if (key === "CLICKUP_TEAM_ID") envArgs.clickupTeamId = value;
    if (key === "DOCUMENT_SUPPORT") envArgs.documentSupport = value;
    if (key === "LOG_LEVEL") envArgs.logLevel = value;
    if (key === "DISABLED_TOOLS") envArgs.disabledTools = value;
    if (key === "ENABLED_TOOLS") envArgs.enabledTools = value;
    if (key === "ENABLE_SSE") envArgs.enableSSE = value;
    if (key === "SSE_PORT") envArgs.ssePort = value;
    if (key === "ENABLE_STDIO") envArgs.enableStdio = value;
    if (key === "PORT") envArgs.port = value;
    if (key === "HOST") envArgs.host = value;
    if (key === "HTTPS_HOST") envArgs.httpsHost = value;
    i++;
  }
}

// Track where credential values were resolved from to assist logging elsewhere
const credentialSources: Record<'clickupApiKey' | 'clickupTeamId', string> = {
  clickupApiKey: envArgs.clickupApiKey
    ? "cli --env argument"
    : process.env.CLICKUP_API_KEY
      ? "environment variable"
      : "config input",
  clickupTeamId: envArgs.clickupTeamId
    ? "cli --env argument"
    : process.env.CLICKUP_TEAM_ID
      ? "environment variable"
      : "config input"
};

// Log levels enum
export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

// Parse LOG_LEVEL string to LogLevel enum
const parseLogLevel = (levelStr: string | undefined): LogLevel => {
  if (!levelStr) return LogLevel.ERROR; // Default to ERROR if not specified

  switch (levelStr.toUpperCase()) {
    case "TRACE":
      return LogLevel.TRACE;
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      // Don't use console.error as it interferes with JSON-RPC communication
      return LogLevel.ERROR;
  }
};

// Define required configuration interface
interface Config {
  clickupApiKey: string;
  clickupTeamId: string;
  enableSponsorMessage: boolean;
  documentSupport: string;
  logLevel: LogLevel;
  disabledTools: string[];
  enabledTools: string[];
  enableSSE: boolean;
  ssePort: number;
  enableStdio: boolean;
  port?: string;
  host: string;
  httpsHost?: string;
  // Security configuration (opt-in for backwards compatibility)
  enableSecurityFeatures: boolean;
  enableOriginValidation: boolean;
  enableRateLimit: boolean;
  enableCors: boolean;
  allowedOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  maxRequestSize: string;
  // HTTPS configuration
  enableHttps: boolean;
  httpsPort?: string;
  sslKeyPath?: string;
  sslCertPath?: string;
  sslCaPath?: string;
}

// Parse boolean string
const parseBoolean = (
  value: string | undefined,
  defaultValue: boolean
): boolean => {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
};

// Parse integer string
const parseInteger = (
  value: string | undefined,
  defaultValue: number
): number => {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Parse comma-separated origins list
const parseOrigins = (
  value: string | undefined,
  defaultValue: string[]
): string[] => {
  if (!value) return defaultValue;
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
};

const pickFirst = <T>(...values: (T | undefined | null)[]): T | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
};

// Load configuration from command line args or environment variables lazily
let _configuration: Config | null = null;

const buildConfiguration = (overrides: Partial<Config> = {}): Config => ({
  clickupApiKey: overrides.clickupApiKey ?? envArgs.clickupApiKey ?? process.env.CLICKUP_API_KEY ?? "",
  clickupTeamId: overrides.clickupTeamId ?? envArgs.clickupTeamId ?? process.env.CLICKUP_TEAM_ID ?? "",
  enableSponsorMessage: overrides.enableSponsorMessage ?? process.env.ENABLE_SPONSOR_MESSAGE !== "false",
  documentSupport:
    overrides.documentSupport ??
    envArgs.documentSupport ??
    process.env.DOCUMENT_SUPPORT ??
    process.env.DOCUMENT_MODULE ??
    process.env.DOCUMENT_MODEL ??
    "false",
  logLevel: overrides.logLevel ?? parseLogLevel(pickFirst(envArgs.logLevel, process.env.LOG_LEVEL)),
  disabledTools:
    overrides.disabledTools ??
    (() => {
      const source = pickFirst(envArgs.disabledTools, process.env.DISABLED_TOOLS, process.env.DISABLED_COMMANDS);
      return source
        ?.split(",")
        .map((cmd) => cmd.trim())
        .filter((cmd) => cmd !== "") ?? [];
    })(),
  enabledTools:
    overrides.enabledTools ??
    (() => {
      const source = pickFirst(envArgs.enabledTools, process.env.ENABLED_TOOLS);
      return source
        ?.split(",")
        .map((cmd) => cmd.trim())
        .filter((cmd) => cmd !== "") ?? [];
    })(),
  enableSSE: overrides.enableSSE ?? parseBoolean(pickFirst(envArgs.enableSSE, process.env.ENABLE_SSE), false),
  ssePort: overrides.ssePort ?? parseInteger(pickFirst(envArgs.ssePort, process.env.SSE_PORT), 3000),
  enableStdio: overrides.enableStdio ?? parseBoolean(
    pickFirst(envArgs.enableStdio, process.env.ENABLE_STDIO),
    true
  ),
  port: overrides.port ?? envArgs.port ?? process.env.PORT ?? "3231",
  host: overrides.host ?? envArgs.host ?? process.env.HOST ?? "0.0.0.0",
  httpsHost: overrides.httpsHost ?? envArgs.httpsHost ?? process.env.HTTPS_HOST,
  // Security configuration (opt-in for backwards compatibility)
  enableSecurityFeatures: overrides.enableSecurityFeatures ?? parseBoolean(
    process.env.ENABLE_SECURITY_FEATURES,
    false
  ),
  enableOriginValidation: overrides.enableOriginValidation ?? parseBoolean(
    process.env.ENABLE_ORIGIN_VALIDATION,
    false
  ),
  enableRateLimit: overrides.enableRateLimit ?? parseBoolean(process.env.ENABLE_RATE_LIMIT, false),
  enableCors: overrides.enableCors ?? parseBoolean(process.env.ENABLE_CORS, false),
  allowedOrigins: overrides.allowedOrigins ?? parseOrigins(process.env.ALLOWED_ORIGINS, [
    "http://127.0.0.1:3231",
    "http://localhost:3231",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://127.0.0.1:3443",
    "https://localhost:3443",
    "https://127.0.0.1:3231",
    "https://localhost:3231",
  ]),
  rateLimitMax: overrides.rateLimitMax ?? parseInteger(process.env.RATE_LIMIT_MAX, 100),
  rateLimitWindowMs: overrides.rateLimitWindowMs ?? parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  maxRequestSize: overrides.maxRequestSize ?? process.env.MAX_REQUEST_SIZE ?? "10mb",
  // HTTPS configuration
  enableHttps: overrides.enableHttps ?? parseBoolean(process.env.ENABLE_HTTPS, false),
  httpsPort: overrides.httpsPort ?? process.env.HTTPS_PORT ?? "3443",
  sslKeyPath: overrides.sslKeyPath ?? process.env.SSL_KEY_PATH,
  sslCertPath: overrides.sslCertPath ?? process.env.SSL_CERT_PATH,
  sslCaPath: overrides.sslCaPath ?? process.env.SSL_CA_PATH,
});

export const getConfiguration = (): Config => {
  if (_configuration) return _configuration;

  _configuration = buildConfiguration();
  return _configuration;
};

export const initializeConfiguration = (overrides: Partial<Config>): Config => {
  _configuration = buildConfiguration(overrides);

  if (overrides.clickupApiKey !== undefined) {
    credentialSources.clickupApiKey = "session config";
  }
  if (overrides.clickupTeamId !== undefined) {
    credentialSources.clickupTeamId = "session config";
  }

  return _configuration;
};

// Function to validate configuration
export const validateConfig = (config: Config): void => {
  const requiredVars = ["clickupApiKey", "clickupTeamId"];
  const missingEnvVars = requiredVars
    .filter((key) => !config[key as keyof Config])
    .map((key) => key);

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvVars.join(", ")}`
    );
  }
};

// Export a getter that doesn't validate on import
const config = {
  get clickupApiKey() {
    return getConfiguration().clickupApiKey;
  },
  get clickupTeamId() {
    return getConfiguration().clickupTeamId;
  },
  get enableSponsorMessage() {
    return getConfiguration().enableSponsorMessage;
  },
  get documentSupport() {
    return getConfiguration().documentSupport;
  },
  get logLevel() {
    return getConfiguration().logLevel;
  },
  get disabledTools() {
    return getConfiguration().disabledTools;
  },
  get enabledTools() {
    return getConfiguration().enabledTools;
  },
  get enableSSE() {
    return getConfiguration().enableSSE;
  },
  get ssePort() {
    return getConfiguration().ssePort;
  },
  get enableStdio() {
    return getConfiguration().enableStdio;
  },
  get port() {
    return getConfiguration().port;
  },
  get host() {
    return getConfiguration().host;
  },
  get enableSecurityFeatures() {
    return getConfiguration().enableSecurityFeatures;
  },
  get enableOriginValidation() {
    return getConfiguration().enableOriginValidation;
  },
  get enableRateLimit() {
    return getConfiguration().enableRateLimit;
  },
  get enableCors() {
    return getConfiguration().enableCors;
  },
  get allowedOrigins() {
    return getConfiguration().allowedOrigins;
  },
  get rateLimitMax() {
    return getConfiguration().rateLimitMax;
  },
  get rateLimitWindowMs() {
    return getConfiguration().rateLimitWindowMs;
  },
  get maxRequestSize() {
    return getConfiguration().maxRequestSize;
  },
  get enableHttps() {
    return getConfiguration().enableHttps;
  },
  get httpsPort() {
    return getConfiguration().httpsPort;
  },
  get httpsHost() {
    return getConfiguration().httpsHost;
  },
  get sslKeyPath() {
    return getConfiguration().sslKeyPath;
  },
  get sslCertPath() {
    return getConfiguration().sslCertPath;
  },
  get sslCaPath() {
    return getConfiguration().sslCaPath;
  },
  get credentialSources() {
    return credentialSources;
  },
};

export default config;
