/**
 * SPDX-FileCopyrightText: © 2025 Talib Kareem <taazkareem@icloud.com>
 * SPDX-License-Identifier: MIT
 *
 * Shared Services Module
 * 
 * This module maintains singleton instances of services that should be shared
 * across the application to ensure consistent state.
 */

import { createClickUpServices, ClickUpServices } from './clickup/index.js';
import config from '../config.js';
import { Logger } from '../logger.js';

const logger = new Logger('SharedServices');

// Singleton instances
let clickUpServicesInstance: ClickUpServices | null = null;
let lastCredentials: { apiKey: string; teamId: string } | null = null;

/**
 * Determine whether the ClickUp credentials have changed since the
 * last time we initialized the shared services singleton.
 */
function credentialsChanged(apiKey: string, teamId: string): boolean {
  if (!lastCredentials) {
    return true;
  }

  return lastCredentials.apiKey !== apiKey || lastCredentials.teamId !== teamId;
}

/**
 * Create or refresh the ClickUp services singleton when credentials
 * change. This allows new authentication details supplied at runtime
 * (for example via MCP session configuration) to take effect without
 * requiring a process restart.
 */
export function getClickUpServices(): ClickUpServices {
  const apiKey = config.clickupApiKey;
  const teamId = config.clickupTeamId;

  if (!apiKey || !teamId) {
    throw new Error('ClickUp credentials are not configured.');
  }

  if (!clickUpServicesInstance || credentialsChanged(apiKey, teamId)) {
    if (clickUpServicesInstance) {
      logger.info('Credentials changed - reinitializing ClickUp services');
    } else {
      logger.info('Creating shared ClickUp services singleton');
    }

    clickUpServicesInstance = createClickUpServices({
      apiKey,
      teamId
    });

    lastCredentials = { apiKey, teamId };

    logger.info('Services initialization complete', {
      services: Object.keys(clickUpServicesInstance).join(', '),
      teamId
    });
  }

  return clickUpServicesInstance;
}

/**
 * Explicitly clear the cached services. Primarily useful for tests or
 * when the environment is reconfigured before handlers run.
 */
export function resetClickUpServices(): void {
  if (clickUpServicesInstance) {
    logger.debug('Resetting shared ClickUp services singleton');
  }

  clickUpServicesInstance = null;
  lastCredentials = null;
}

// Helper getters to avoid consumers caching stale references. These
// return a fresh service instance that reflects the latest credentials
// every time they are accessed.
export function getWorkspaceService() {
  return getClickUpServices().workspace;
}

export function getTaskService() {
  return getClickUpServices().task;
}

export function getListService() {
  return getClickUpServices().list;
}

export function getFolderService() {
  return getClickUpServices().folder;
}

export function getTagService() {
  return getClickUpServices().tag;
}

export function getTimeTrackingService() {
  return getClickUpServices().timeTracking;
}

export function getDocumentService() {
  return getClickUpServices().document;
}
