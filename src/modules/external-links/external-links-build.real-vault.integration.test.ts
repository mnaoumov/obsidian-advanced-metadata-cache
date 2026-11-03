import type { IncrementalFileIndexComponent } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';

import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { SettingsEditorPlugin } from '../../../scripts/helpers/names-module.ts';
import type { ExternalLink } from '../../plugin-api.ts';
import type { ExternalLinkIndexComponent } from './external-link-index-component.ts';

interface BuildTimings {
  readonly coldBuildMilliseconds: number;
  readonly coldReads: number;
  readonly error: null | string;
  readonly fileCount: number;
  readonly linkCount: number;
  readonly restoreBuildMilliseconds: number;
  readonly restoredLinkCount: number;
  readonly restoreReads: number;
  readonly saveMilliseconds: number;
}

interface CacheApi {
  readonly getExternalLinkIndexComponent: () => CacheOwner | null;
}

interface CacheOwner extends Pick<ExternalLinkIndexComponent, 'externalLinkIndex' | 'waitForBuild'> {
  readonly files: IncrementalFileIndexComponent<readonly ExternalLink[]>;
}

interface CachePlugin extends SettingsEditorPlugin {
  readonly pluginApi: CacheApi;
}

interface TimingsHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Retains the renderer's background measurement until it settles.
  __amcExternalLinkRun?: Promise<void>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The renderer publishes a completed background measurement.
  __amcExternalLinkTimings?: BuildTimings;
}

const BUILD_TIMEOUT_IN_MILLISECONDS = 3_600_000;
const POLL_IN_MILLISECONDS = 2000;

describe('external links on a real vault', () => {
  it('compares a cold build with a local IndexedDB restore and verifies that unchanged notes are not read', async () => {
    const vaultPath = getTemporaryVault().path;
    await pollInObsidian({
      intervalInMilliseconds: POLL_IN_MILLISECONDS,
      poll({ app }): boolean {
        return app.metadataCache.isCacheClean();
      },
      timeoutInMilliseconds: BUILD_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'real vault metadata cache to settle',
      until(isClean: boolean): boolean {
        return isClean;
      },
      vaultPath
    });
    await evalInObsidian({
      callback({ app }) {
        const holder = window as TimingsHolder;
        delete holder.__amcExternalLinkTimings;
        holder.__amcExternalLinkRun = run();

        async function run(): Promise<void> {
          const result = { coldBuildMilliseconds: 0, coldReads: 0, error: null as null | string, fileCount: 0, linkCount: 0, restoreBuildMilliseconds: 0, restoredLinkCount: 0, restoreReads: 0, saveMilliseconds: 0 };
          const plugin = app.plugins.getPlugin('advanced-metadata-cache') as CachePlugin | null;
          const originalRead = app.vault.cachedRead;
          let reads = 0;
          try {
            if (!plugin) {
              throw new Error('Plugin not loaded');
            }
            await setEnabled(false);
            const files = app.vault.getMarkdownFiles().filter((file) => !file.path.startsWith('Plugin data/advanced-metadata-cache/'));
            result.fileCount = files.length;
            // All measurements follow the same sequential warm-up; these are OS-cache-warm build costs.
            for (const file of files) {
              await app.vault.cachedRead(file);
            }
            app.vault.cachedRead = async (file): Promise<string> => {
              reads++;
              return await originalRead.call(app.vault, file);
            };
            const coldStart = performance.now();
            await setEnabled(true);
            const cold = getOwner();
            await cold.waitForBuild();
            result.coldBuildMilliseconds = performance.now() - coldStart;
            result.coldReads = reads;
            result.linkCount = files.reduce((count, file) => count + cold.externalLinkIndex.getLinks(file.path).length, 0);
            const saveStart = performance.now();
            await cold.files.flush();
            result.saveMilliseconds = performance.now() - saveStart;
            await setEnabled(false);
            const restoreStart = performance.now();
            await setEnabled(true);
            const restored = getOwner();
            await restored.waitForBuild();
            result.restoreBuildMilliseconds = performance.now() - restoreStart;
            result.restoreReads = reads - result.coldReads;
            result.restoredLinkCount = files.reduce((count, file) => count + restored.externalLinkIndex.getLinks(file.path).length, 0);
            await setEnabled(false);
          } catch (error) {
            result.error = String(error);
          } finally {
            // eslint-disable-next-line require-atomic-updates -- The measurement owns the wrapper until every build has settled.
            app.vault.cachedRead = originalRead;
            await setEnabled(false);
            holder.__amcExternalLinkTimings = result;
          }

          function getOwner(): CacheOwner {
            const owner = plugin?.pluginApi.getExternalLinkIndexComponent();
            if (!owner) {
              throw new Error('External links module missing');
            }
            return owner;
          }

          async function setEnabled(isEnabled: boolean): Promise<void> {
            await plugin?.pluginSettingsComponent.editAndSave((settings) => {
              Object.assign(settings, { isExternalLinksModuleEnabled: isEnabled });
            });
          }
        }
      },
      vaultPath
    });
    const timings = await pollInObsidian({
      intervalInMilliseconds: POLL_IN_MILLISECONDS,
      poll(): BuildTimings | null {
        return (window as TimingsHolder).__amcExternalLinkTimings ?? null;
      },
      timeoutInMilliseconds: BUILD_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'external-link cold and restored builds',
      until(value: BuildTimings | null): boolean {
        return value !== null;
      },
      vaultPath
    });
    console.warn('[external links build on a real vault]', JSON.stringify(timings));
    expect(timings?.error).toBeNull();
    expect(timings?.fileCount).toBeGreaterThan(0);
    expect(timings?.coldReads).toBe(timings?.fileCount);
    expect(timings?.restoreReads).toBe(0);
    expect(timings?.restoredLinkCount).toBe(timings?.linkCount);
  }, BUILD_TIMEOUT_IN_MILLISECONDS);
});
