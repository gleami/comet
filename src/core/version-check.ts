import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@rpamis/comet/latest';
const FETCH_TIMEOUT_MS = 5000;

interface NpmRegistryResponse {
  version: string;
}

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  error: string | null;
  timestamp: number | null;
}

export type UpdateCheckStrategy = 'never' | 'daily' | 'always';

export interface UpdateCheckConfig {
  strategy: UpdateCheckStrategy;
  lastCheckTime: number | null;
  cachedVersion: string | null;
}

const DEFAULT_CONFIG: UpdateCheckConfig = {
  strategy: 'daily',
  lastCheckTime: null,
  cachedVersion: null,
};

const CONFIG_FILENAME = 'update-check.json';

function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'comet');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILENAME);
}

/**
 * Resolve the effective update check strategy.
 * Environment variable COMET_UPDATE_CHECK takes highest priority.
 */
export function resolveStrategy(fileStrategy: UpdateCheckStrategy): UpdateCheckStrategy {
  const env = process.env.COMET_UPDATE_CHECK;
  if (env === 'never' || env === 'daily' || env === 'always') {
    return env;
  }
  return fileStrategy;
}

/**
 * Load the update check config from disk.
 * Returns defaults if the file doesn't exist or is corrupt.
 */
export async function loadUpdateCheckConfig(): Promise<UpdateCheckConfig> {
  try {
    const configPath = getConfigPath();
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<UpdateCheckConfig>;

    const strategy: UpdateCheckStrategy =
      parsed.strategy === 'never' || parsed.strategy === 'daily' || parsed.strategy === 'always'
        ? parsed.strategy
        : DEFAULT_CONFIG.strategy;

    return {
      strategy: resolveStrategy(strategy),
      lastCheckTime: typeof parsed.lastCheckTime === 'number' ? parsed.lastCheckTime : null,
      cachedVersion: typeof parsed.cachedVersion === 'string' ? parsed.cachedVersion : null,
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
      strategy: resolveStrategy(DEFAULT_CONFIG.strategy),
    };
  }
}

/**
 * Persist update check config to disk.
 * Creates parent directory if needed.
 */
export async function saveUpdateCheckConfig(config: UpdateCheckConfig): Promise<void> {
  try {
    const configPath = getConfigPath();
    await fs.mkdir(getConfigDir(), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // Best-effort: config write failures must not affect the CLI
  }
}

/**
 * Determine whether an update check should be performed now.
 */
export function shouldCheckUpdate(config: UpdateCheckConfig): boolean {
  if (config.strategy === 'never') return false;
  if (config.strategy === 'always') return true;
  // daily: check if last check was more than 24 hours ago
  if (config.lastCheckTime === null) return true;
  return Date.now() - config.lastCheckTime > 24 * 60 * 60 * 1000;
}

/**
 * Mark that an update check has been performed.
 * Persists the current time and version to config.
 */
export async function markUpdateCheckDone(version: string): Promise<void> {
  const config = await loadUpdateCheckConfig();
  config.lastCheckTime = Date.now();
  config.cachedVersion = version;
  await saveUpdateCheckConfig(config);
}

/**
 * Fetch the latest version tag from the npm registry.
 */
export async function fetchLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`npm registry responded with ${response.status}`);
    }
    const data = (await response.json()) as NpmRegistryResponse;
    if (typeof data.version !== 'string' || !data.version) {
      throw new Error('Invalid response from npm registry');
    }
    return data.version;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare two semver strings.
 * Returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2.
 *
 * Prerelease suffixes (e.g. "-beta.1") are stripped before comparison
 * so that "0.3.5" and "0.3.5-beta.1" compare as equal on the numeric
 * axis.  Shorter or longer suffixes compare positionally; missing
 * parts are treated as 0.  Non-numeric segments default to 0.
 */
export function compareVersions(v1: string, v2: string): -1 | 0 | 1 {
  const strip = (v: string) => v.split('-')[0];
  const parts1 = strip(v1).split('.').map(Number);
  const parts2 = strip(v2).split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const a = Number.isFinite(parts1[i]) ? parts1[i] : 0;
    const b = Number.isFinite(parts2[i]) ? parts2[i] : 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

/**
 * Check the npm registry for the latest version and compare it against the
 * current installed version.  Network / parse errors are returned as an
 * `error` field instead of thrown, so callers can degrade gracefully.
 */
export async function checkForUpdate(currentVersion: string): Promise<VersionCheckResult> {
  try {
    const latestVersion = await fetchLatestVersion();
    const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;
    return { currentVersion, latestVersion, hasUpdate, error: null, timestamp: Date.now() };
  } catch (error) {
    return {
      currentVersion,
      latestVersion: '',
      hasUpdate: false,
      error: error instanceof Error ? error.message : 'Unknown error checking for update',
      timestamp: null,
    };
  }
}

/**
 * Check for update and auto-persist the check timestamp.
 * Returns the check result (for callers that need it).
 */
export async function checkForUpdateAndPersist(
  currentVersion: string,
): Promise<VersionCheckResult> {
  const result = await checkForUpdate(currentVersion);
  if (!result.error) {
    await markUpdateCheckDone(result.latestVersion);
  }
  return result;
}

/**
 * Perform an automatic startup version check.
 * Best-effort: runs async, never throws, prints notification to stderr on update.
 */
export async function performStartupCheck(currentVersion: string): Promise<void> {
  try {
    const config = await loadUpdateCheckConfig();
    if (!shouldCheckUpdate(config)) return;

    const result = await checkForUpdateAndPersist(currentVersion);
    if (result.hasUpdate) {
      console.error(`\n  ╭─ Comet Update ───────────────────────────╮`);
      console.error(
        `  │  New version available: v${result.currentVersion} → v${result.latestVersion}  │`,
      );
      console.error(`  │  Run 'comet update' to upgrade.           │`);
      console.error(`  ╰──────────────────────────────────────────╯\n`);
    }
  } catch {
    // Silent — startup check must never affect CLI behavior
  }
}
