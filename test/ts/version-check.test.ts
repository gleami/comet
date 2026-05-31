import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import {
  compareVersions,
  extractLatestChangelog,
  loadUpdateCheckConfig,
  saveUpdateCheckConfig,
  shouldCheckUpdate,
  markUpdateCheckDone,
  resolveStrategy,
  checkForUpdateAndPersist,
  performStartupCheck,
} from '../../src/core/version-check.js';

describe('compareVersions', () => {
  it('compares equal versions', () => {
    expect(compareVersions('0.3.5', '0.3.5')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
  });

  it('detects when current is older than latest', () => {
    expect(compareVersions('0.3.4', '0.3.5')).toBe(-1);
    expect(compareVersions('0.3.5', '0.4.0')).toBe(-1);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
  });

  it('detects when current is newer than latest', () => {
    expect(compareVersions('0.4.0', '0.3.5')).toBe(1);
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('handles unequal part lengths', () => {
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
    expect(compareVersions('1.0.0.0', '1.0.0')).toBe(0);
  });
});

describe('resolveStrategy', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.COMET_UPDATE_CHECK;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns file strategy when env is not set', () => {
    expect(resolveStrategy('daily')).toBe('daily');
    expect(resolveStrategy('never')).toBe('never');
    expect(resolveStrategy('always')).toBe('always');
  });

  it('env var COMET_UPDATE_CHECK overrides file strategy', () => {
    process.env.COMET_UPDATE_CHECK = 'never';
    expect(resolveStrategy('daily')).toBe('never');

    process.env.COMET_UPDATE_CHECK = 'always';
    expect(resolveStrategy('daily')).toBe('always');

    process.env.COMET_UPDATE_CHECK = 'daily';
    expect(resolveStrategy('never')).toBe('daily');
  });

  it('ignores invalid env values', () => {
    process.env.COMET_UPDATE_CHECK = 'invalid';
    expect(resolveStrategy('daily')).toBe('daily');
  });
});

describe('loadUpdateCheckConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-vc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', async () => {
    const config = await loadUpdateCheckConfig();
    expect(config.strategy).toBe('daily');
    expect(config.lastCheckTime).toBeNull();
    expect(config.cachedVersion).toBeNull();
  });

  it('reads config from file when it exists', async () => {
    const configDir = path.join(tmpDir, '.config', 'comet');
    const configPath = path.join(configDir, 'update-check.json');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ strategy: 'never', lastCheckTime: 1234567890000, cachedVersion: '0.3.5' }),
      'utf-8',
    );

    const config = await loadUpdateCheckConfig();
    expect(config.strategy).toBe('never');
    expect(config.lastCheckTime).toBe(1234567890000);
    expect(config.cachedVersion).toBe('0.3.5');
  });

  it('handles corrupt config gracefully', async () => {
    const configDir = path.join(tmpDir, '.config', 'comet');
    const configPath = path.join(configDir, 'update-check.json');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, 'not-json', 'utf-8');

    const config = await loadUpdateCheckConfig();
    expect(config.strategy).toBe('daily');
    expect(config.lastCheckTime).toBeNull();
    expect(config.cachedVersion).toBeNull();
  });
});

describe('shouldCheckUpdate', () => {
  it('never returns false', () => {
    expect(shouldCheckUpdate({ strategy: 'never', lastCheckTime: null, cachedVersion: null })).toBe(false);
    expect(shouldCheckUpdate({ strategy: 'never', lastCheckTime: Date.now(), cachedVersion: '0.3.5' })).toBe(false);
  });

  it('always returns true', () => {
    expect(shouldCheckUpdate({ strategy: 'always', lastCheckTime: null, cachedVersion: null })).toBe(true);
    expect(shouldCheckUpdate({ strategy: 'always', lastCheckTime: Date.now(), cachedVersion: '0.3.5' })).toBe(true);
  });

  it('daily returns true when never checked before', () => {
    expect(shouldCheckUpdate({ strategy: 'daily', lastCheckTime: null, cachedVersion: null })).toBe(true);
  });

  it('daily returns false when checked less than 24h ago', () => {
    expect(
      shouldCheckUpdate({
        strategy: 'daily',
        lastCheckTime: Date.now() - 60 * 60 * 1000, // 1 hour ago
        cachedVersion: '0.3.5',
      }),
    ).toBe(false);
  });

  it('daily returns true when checked more than 24h ago', () => {
    expect(
      shouldCheckUpdate({
        strategy: 'daily',
        lastCheckTime: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        cachedVersion: '0.3.4',
      }),
    ).toBe(true);
  });
});

describe('saveUpdateCheckConfig and markUpdateCheckDone', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-vc-save-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('save and reload produces same config', async () => {
    const config = { strategy: 'never' as const, lastCheckTime: 1234567890000, cachedVersion: '0.3.5' };
    await saveUpdateCheckConfig(config);

    const loaded = await loadUpdateCheckConfig();
    expect(loaded.strategy).toBe('never');
    expect(loaded.lastCheckTime).toBe(1234567890000);
    expect(loaded.cachedVersion).toBe('0.3.5');
  });

  it('markUpdateCheckDone writes timestamp and version', async () => {
    const before = Date.now();
    await markUpdateCheckDone('0.4.0');
    const after = Date.now();

    const loaded = await loadUpdateCheckConfig();
    expect(loaded.cachedVersion).toBe('0.4.0');
    expect(loaded.lastCheckTime).toBeGreaterThanOrEqual(before);
    expect(loaded.lastCheckTime).toBeLessThanOrEqual(after);
  });

  it('markUpdateCheckDone preserves strategy from loaded config', async () => {
    await saveUpdateCheckConfig({ strategy: 'never', lastCheckTime: null, cachedVersion: null });
    await markUpdateCheckDone('0.5.0');

    const loaded = await loadUpdateCheckConfig();
    expect(loaded.strategy).toBe('never');
    expect(loaded.cachedVersion).toBe('0.5.0');
  });
});

describe('checkForUpdateAndPersist', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-vc-check-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does not throw when network is unavailable (returns error field)', async () => {
    const result = await checkForUpdateAndPersist('0.3.5');
    if (result.error) {
      expect(result.error).toBeTruthy();
      expect(result.hasUpdate).toBe(false);
    } else {
      expect(result.latestVersion).toBeTruthy();
    }
  });
});

describe('performStartupCheck', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-vc-startup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('never throws (best-effort)', async () => {
    await expect(performStartupCheck('0.3.5')).resolves.toBeUndefined();
  });
});

describe('extractLatestChangelog', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-vc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('extracts the first changelog section', async () => {
    const content = `# Changelog

## What's Changed [0.4.0] - 2026-06-01

### Added

- **Online self-update**: Version check before update.

### Fixed

- **Bug fix**: Something.

## What's Changed [0.3.5] - 2026-05-29

### Added

- Old feature.
`;

    const tmpFile = path.join(tmpDir, 'CHANGELOG.md');
    await fs.writeFile(tmpFile, content, 'utf-8');

    const result = await extractLatestChangelog(tmpFile);
    expect(result).toBe(
      `## What's Changed [0.4.0] - 2026-06-01

### Added

- **Online self-update**: Version check before update.

### Fixed

- **Bug fix**: Something.`,
    );
  });

  it('returns null for unreadable file', async () => {
    await expect(extractLatestChangelog(path.join(tmpDir, 'nonexistent.md'))).resolves.toBeNull();
  });
});