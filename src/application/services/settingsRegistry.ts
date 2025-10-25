import { SettingsService } from "./SettingsService.js";

let instance: SettingsService | null = null;

export function registerSettingsService(service: SettingsService): void {
  instance = service;
}

export function getSettingsService(): SettingsService | null {
  return instance;
}
