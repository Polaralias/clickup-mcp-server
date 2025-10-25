import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ZipFile } from "yazl";
import { redactString, redactUnknown } from "../redaction.js";
import type { LogLevel } from "../logging.js";

type CrashEvent = "uncaughtException" | "unhandledRejection";

type CrashListener = (value: unknown) => void;

type CrashEmitter = {
  on(event: CrashEvent, listener: CrashListener): unknown;
  off?(event: CrashEvent, listener: CrashListener): unknown;
  removeListener?(event: CrashEvent, listener: CrashListener): unknown;
  exit?(code?: number): unknown;
};

export type DiagnosticsLogEntry = {
  ts: string;
  level: LogLevel;
  subsystem: string;
  msg: string;
  extras?: Record<string, unknown>;
  correlationId?: string;
};

export type SupportBundleRequest = {
  appVersion: string;
  deviceModel: string;
  androidVersion: string;
  featureFlags: string[];
};

type CrashType = "uncaught_exception" | "unhandled_rejection";

type CrashPayload = {
  ts: string;
  type: CrashType;
  message: string;
  stack?: string;
  details?: Record<string, unknown>;
};

export class DiagnosticsManager {
  private readonly baseDir: string;
  private readonly logDir: string;
  private readonly crashDir: string;
  private readonly supportDir: string;
  private readonly maxBytes: number;
  private readonly processBinding: CrashEmitter;
  private logFilePath: string;
  private enabled = false;
  private listenersAttached = false;
  private exceptionListener?: CrashListener;
  private rejectionListener?: CrashListener;
  private memoryBuffer: string[] = [];
  private memoryBytes = 0;
  private fileChain: Promise<void> = Promise.resolve();

  constructor(options: { baseDir?: string; maxBytes?: number; processBinding?: CrashEmitter } = {}) {
    this.baseDir = options.baseDir ?? path.join(process.cwd(), "diagnostics");
    this.logDir = path.join(this.baseDir, "logs");
    this.crashDir = path.join(this.baseDir, "crash");
    this.supportDir = path.join(this.baseDir, "support");
    this.maxBytes = options.maxBytes ?? 512 * 1024;
    this.processBinding = options.processBinding ?? (process as CrashEmitter);
    this.logFilePath = path.join(this.logDir, "diagnostics.log");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }
    await this.ensureStructure();
    this.enabled = true;
    this.attachListeners();
  }

  disable(): void {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    this.detachListeners();
  }

  async recordLog(entry: DiagnosticsLogEntry): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const payload: Record<string, unknown> = {
      ts: entry.ts,
      level: entry.level,
      subsystem: entry.subsystem,
      msg: redactString(entry.msg)
    };
    if (entry.correlationId) {
      payload.correlationId = entry.correlationId;
    }
    if (entry.extras) {
      payload.extras = redactUnknown(entry.extras);
    }
    const serialized = JSON.stringify(payload);
    this.appendToMemory(serialized);
    this.fileChain = this.fileChain.then(async () => {
      await this.ensureStructure();
      await fs.appendFile(this.logFilePath, `${serialized}\n`, "utf8");
      await this.trimLogFile();
    });
    await this.fileChain.catch(() => undefined);
  }

  async exportBundle(request: SupportBundleRequest): Promise<string> {
    if (!this.enabled) {
      throw new Error("Diagnostics disabled");
    }
    await this.ensureStructure();
    await fs.mkdir(this.supportDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `support-${timestamp}.zip`;
    const destination = path.join(this.supportDir, fileName);
    const zip = new ZipFile();
    const stream = createWriteStream(destination);
    const completion = new Promise<void>((resolve, reject) => {
      zip.outputStream.pipe(stream).once("close", resolve).once("error", reject);
      stream.once("error", reject);
    });
    const metadata = {
      generatedAt: new Date().toISOString(),
      appVersion: request.appVersion,
      deviceModel: request.deviceModel,
      androidVersion: request.androidVersion,
      featureFlags: [...request.featureFlags],
      diagnosticsEnabled: this.enabled
    };
    zip.addBuffer(Buffer.from(JSON.stringify(metadata, null, 2), "utf8"), "metadata.json");
    if (await this.fileExists(this.logFilePath)) {
      const logBuffer = await fs.readFile(this.logFilePath);
      zip.addBuffer(logBuffer, "logs/diagnostics.log");
    }
    const crashFiles = await this.safeReadDir(this.crashDir);
    for (const file of crashFiles) {
      const absolute = path.join(this.crashDir, file);
      if (!(await this.isRegularFile(absolute))) {
        continue;
      }
      const buffer = await fs.readFile(absolute);
      zip.addBuffer(buffer, `crash/${file}`);
    }
    const memoryLog = this.memorySnapshot();
    if (memoryLog.length > 0) {
      zip.addBuffer(Buffer.from(memoryLog.join("\n"), "utf8"), "logs/memory.log");
    }
    zip.end();
    await completion;
    return destination;
  }

  private attachListeners(): void {
    if (this.listenersAttached) {
      return;
    }
    const exception = (error: unknown) => {
      void this.writeCrashReport("uncaught_exception", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(typeof error === "string" ? error : "Unknown error");
    };
    const rejection = (reason: unknown) => {
      void this.writeCrashReport("unhandled_rejection", reason);
      if (reason instanceof Error) {
        throw reason;
      }
      throw new Error(typeof reason === "string" ? reason : "Unhandled rejection");
    };
    this.exceptionListener = exception;
    this.rejectionListener = rejection;
    this.processBinding.on("uncaughtException", exception);
    this.processBinding.on("unhandledRejection", rejection);
    this.listenersAttached = true;
  }

  private detachListeners(): void {
    if (!this.listenersAttached) {
      return;
    }
    if (this.exceptionListener) {
      this.removeListener("uncaughtException", this.exceptionListener);
      this.exceptionListener = undefined;
    }
    if (this.rejectionListener) {
      this.removeListener("unhandledRejection", this.rejectionListener);
      this.rejectionListener = undefined;
    }
    this.listenersAttached = false;
  }

  private removeListener(event: CrashEvent, listener: CrashListener): void {
    if (typeof this.processBinding.off === "function") {
      this.processBinding.off(event, listener);
      return;
    }
    if (typeof this.processBinding.removeListener === "function") {
      this.processBinding.removeListener(event, listener);
    }
  }

  private appendToMemory(entry: string): void {
    const size = Buffer.byteLength(entry, "utf8");
    this.memoryBuffer.push(entry);
    this.memoryBytes += size;
    while (this.memoryBytes > this.maxBytes && this.memoryBuffer.length > 0) {
      const removed = this.memoryBuffer.shift();
      if (removed) {
        this.memoryBytes -= Buffer.byteLength(removed, "utf8");
      }
    }
  }

  private memorySnapshot(): string[] {
    return [...this.memoryBuffer];
  }

  private async ensureStructure(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    await fs.mkdir(this.crashDir, { recursive: true });
  }

  private async trimLogFile(): Promise<void> {
    if (!(await this.fileExists(this.logFilePath))) {
      return;
    }
    const stats = await fs.stat(this.logFilePath);
    if (stats.size <= this.maxBytes) {
      return;
    }
    const buffer = await fs.readFile(this.logFilePath);
    const start = Math.max(0, buffer.length - this.maxBytes);
    let trimmed = buffer.subarray(start);
    const newline = trimmed.indexOf(0x0a);
    if (newline !== -1) {
      trimmed = trimmed.subarray(newline + 1);
    }
    await fs.writeFile(this.logFilePath, trimmed);
  }

  private async writeCrashReport(type: CrashType, reason: unknown): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.ensureStructure();
    const crash = this.normaliseCrashPayload(type, reason);
    const payload = redactUnknown(crash) as CrashPayload;
    const fileName = `${type}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    const destination = path.join(this.crashDir, fileName);
    await fs.writeFile(destination, JSON.stringify(payload, null, 2), "utf8");
  }

  private normaliseCrashPayload(type: CrashType, reason: unknown): CrashPayload {
    const ts = new Date().toISOString();
    if (reason instanceof Error) {
      const details: Record<string, unknown> = { name: reason.name };
      if (reason.cause) {
        details.cause = reason.cause;
      }
      if (reason instanceof AggregateError) {
        details.errors = reason.errors;
      }
      return {
        ts,
        type,
        message: reason.message,
        stack: reason.stack ?? undefined,
        details
      };
    }
    if (typeof reason === "string") {
      return { ts, type, message: reason };
    }
    if (reason && typeof reason === "object") {
      return { ts, type, message: "NonError rejection", details: reason as Record<string, unknown> };
    }
    return { ts, type, message: String(reason) };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch {
      return [];
    }
  }

  private async isRegularFile(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }
}
