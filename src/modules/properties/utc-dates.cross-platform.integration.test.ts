import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import type { AdvancedMetadataCacheApi } from '../../../api.d.ts';

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

interface ApiHolder {
  readonly __obsidianLib?: ApiState;
}

interface ApiRecord {
  readonly api: AdvancedMetadataCacheApi;
  readonly isRevoked: boolean;
}

interface ApiRecords {
  readonly records?: Record<string, readonly ApiRecord[]>;
}

interface ApiRegistry {
  readonly value?: ApiRecords;
}

interface ApiState {
  readonly pluginApiRegistry?: ApiRegistry;
}

describe('UTC dates', () => {
  afterAll(async () => {
    await applyPluginSettings({ defaultTimeZone: '', isPropertiesModuleEnabled: true });
  });

  it('queries parsed values by instant and follows a change to the default-zone setting without rebuilding', async () => {
    const setup = await applyPluginSettings({ defaultTimeZone: 'UTC', isPropertiesModuleEnabled: true });
    expect(setup.error).toBeNull();
    const initial = await evalInObsidian({
      async callback({ app, lib: { waitUntil } }) {
        const records = (window as ApiHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        const api = records?.['advanced-metadata-cache']?.find((record) => !record.isRevoked)?.api;
        if (!api) {
          throw new Error('No live API');
        }
        const propertyName = 'utcIntegrationDate';
        const fixtures = [
          ['utc-offset.md', '2026-10-26T23:00-06:00'],
          ['utc-named.md', '2026-10-27T07:00[Europe/Kyiv]'],
          ['utc-local.md', '2026-10-27T07:00'],
          ['utc-day.md', '2026-10-27']
        ];
        for (const [path, value] of fixtures) {
          if (!(path && value)) {
            continue;
          }

          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
          await app.vault.create(path, `---\n${propertyName}: "${value}"\n---\n`);
        }
        await waitUntil({
          message: 'all UTC fixtures indexed from Obsidian metadata',
          predicate: () => api.getDatedValues({ propertyNames: [propertyName] })?.length === fixtures.length,
          timeoutInMilliseconds: 10_000
        });
        const query = { from: '2026-10-27T05:00Z', propertyNames: [propertyName], timeBasis: 'utc', to: '2026-10-27T05:00Z' } as const;
        const defaultValues = await api.getDatedValuesSafe(query);
        return {
          defaultPaths: defaultValues?.map((entry) => entry.path),
          skipPaths: api.getDatedValues({ ...query, missingTimeZone: 'skip' })?.map((entry) => entry.path),
          wallClockPaths: api.getDatedValues({ from: '2026-10-26', propertyNames: [propertyName], to: '2026-10-26' })?.map((entry) => entry.path)
        };
      },
      vaultPath: getTemporaryVault().path
    });
    expect(initial.skipPaths).toEqual(['utc-offset.md', 'utc-named.md']);
    expect(initial.defaultPaths).toEqual(['utc-day.md', 'utc-offset.md', 'utc-named.md']);
    expect(initial.wallClockPaths).toEqual(['utc-offset.md']);

    const change = await applyPluginSettings({ defaultTimeZone: 'Europe/Kyiv' });
    expect(change.error).toBeNull();
    const changed = await evalInObsidian({
      async callback() {
        const records = (window as ApiHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        const api = records?.['advanced-metadata-cache']?.find((record) => !record.isRevoked)?.api;
        const values = await api?.getDatedValuesSafe({ from: '2026-10-27T05:00Z', propertyNames: ['utcIntegrationDate'], timeBasis: 'utc', to: '2026-10-27T05:00Z' });
        return values?.map((entry) => entry.path);
      },
      vaultPath: getTemporaryVault().path
    });
    expect(changed).toEqual(['utc-day.md', 'utc-offset.md', 'utc-local.md', 'utc-named.md']);
  });
});
