import { DiagnosticsManager, type SupportBundleRequest } from "../../shared/diagnostics/DiagnosticsManager.js";

type SettingsState = {
  diagnosticsEnabled: boolean;
};

export class SettingsService {
  private state: SettingsState;

  constructor(private readonly diagnostics: DiagnosticsManager) {
    this.state = { diagnosticsEnabled: diagnostics.isEnabled() };
  }

  getSettings(): SettingsState {
    return { ...this.state };
  }

  async setDiagnosticsEnabled(enabled: boolean): Promise<void> {
    if (this.state.diagnosticsEnabled === enabled) {
      return;
    }
    if (enabled) {
      await this.diagnostics.enable();
    } else {
      this.diagnostics.disable();
    }
    this.state = { diagnosticsEnabled: enabled };
  }

  async exportSupportBundle(request: SupportBundleRequest): Promise<string> {
    if (!this.state.diagnosticsEnabled) {
      throw new Error("Diagnostics disabled");
    }
    return this.diagnostics.exportBundle(request);
  }
}
