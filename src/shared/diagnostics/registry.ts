import { DiagnosticsManager, type DiagnosticsLogEntry } from "./DiagnosticsManager.js";

let instance: DiagnosticsManager | null = null;

export function registerDiagnosticsManager(manager: DiagnosticsManager): void {
  instance = manager;
}

export function getDiagnosticsManager(): DiagnosticsManager | null {
  return instance;
}

export function captureDiagnosticsLog(entry: DiagnosticsLogEntry): void {
  if (!instance) {
    return;
  }
  void instance.recordLog(entry).catch(() => undefined);
}
