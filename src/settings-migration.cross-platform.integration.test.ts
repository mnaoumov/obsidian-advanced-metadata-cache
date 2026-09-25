/**
 * @file
 *
 * Integration suite for `migrateSettings`, against a real Obsidian and driven the way a proposing plugin
 * drives it: a proposal goes in through the registry, the dialog comes up, and what the user does with it
 * decides whether anything is written.
 *
 * - OK adds the proposed name to the list, keeps the one already there, switches the `Titles` module on
 *   (it starts off here, so the dialog offers to), and resolves `isApplied: true`.
 * - Cancel writes nothing and resolves `isApplied: false`, which is what keeps the proposer's value pending.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it: a
 * proposal arrives on a phone too, and the dialog is the same modal. The buttons are pressed with
 * `HTMLElement.click()` for that reason — the trusted-input helpers need Electron, and a `ButtonComponent`'s
 * click handler does not gate on `isTrusted`.
 */

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { applyPluginSettings } from '../scripts/helpers/names-module.ts';

interface MigratableSettingsLike {
  readonly titlePropertyNames?: readonly string[];
}

interface MigrateSettingsParamsLike {
  readonly proposedSettings: MigratableSettingsLike;
  readonly sourcePluginId: string;
}

interface MigrateSettingsResultLike {
  readonly isApplied: boolean;
}

/**
 * The published API, as a proposing plugin compiles against it — the slice of the root `api.d.ts` this
 * suite calls. Declared here because an `evalInObsidian` closure cannot carry a value across.
 */
interface MigrationApiLike {
  getTitlePropertyNames: () => string[];
  migrateSettings: (params: MigrateSettingsParamsLike) => Promise<MigrateSettingsResultLike>;
}

interface ObsidianDevUtilsStateBag {
  readonly pluginApiRegistry?: PluginApiRegistryWrapper;
}

interface PluginApiRecord {
  readonly api: MigrationApiLike;
  readonly apiVersion: string;
  readonly isRevoked: boolean;
}

interface PluginApiRegistry {
  readonly records?: Record<string, PluginApiRecord[] | undefined>;
}

interface PluginApiRegistryHolder {
  readonly __obsidianDevUtils?: ObsidianDevUtilsStateBag;
}

interface PluginApiRegistryWrapper {
  readonly value?: PluginApiRegistry;
}

/**
 * What one run of the scenario answered.
 */
interface SettingsMigrationProbeResult {
  readonly apiVersion: string;
  readonly isApplied: boolean;
  readonly publishedTitlePropertyNames: string[];
  readonly savedIsTitlesModuleEnabled: unknown;
  readonly savedTitlePropertyNames: unknown;
  readonly settingNames: string[];
  readonly title: string;
}

const BUTTON_TEXT_CANCEL = 'Cancel';
const BUTTON_TEXT_OK = 'OK';
const PLUGIN_ID = 'advanced-metadata-cache';
const SOURCE_PLUGIN_ID = 'alias-quick-switcher-integration-probe';

/*
 * The dialog opens in well under a second; the wait is generous, not a budget, and stays under the
 * transport's per-command cap because this closure holds one `Runtime.evaluate` open for the scenario.
 */
const DIALOG_WAIT_IN_MS = 20_000;
const SCENARIO_TIMEOUT_IN_MS = 60_000;

async function runScenario(buttonText: string): Promise<SettingsMigrationProbeResult> {
  return await evalInObsidian({
    async callback({
      app,
      BUTTON_TEXT: pressedButtonText,
      DIALOG_WAIT_IN_MS: dialogWaitInMs,
      lib: { waitUntil },
      PLUGIN_ID: pluginId,
      SOURCE_PLUGIN_ID: sourcePluginId
    }): Promise<SettingsMigrationProbeResult> {
      const plugin = app.plugins.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`${pluginId} is not loaded`);
      }

      const apiRecord = (window as PluginApiRegistryHolder).__obsidianDevUtils?.pluginApiRegistry?.value?.records?.[pluginId]
        ?.find((candidate) => !candidate.isRevoked);
      if (!apiRecord) {
        throw new Error(`${pluginId} has published no API`);
      }

      const migrationPromise = apiRecord.api.migrateSettings({
        proposedSettings: { titlePropertyNames: ['subtitle'] },
        sourcePluginId
      });

      let isSettled = false;
      /*
       * A proposal that changes nothing resolves with no dialog at all. The suite's staging rules that out,
       * but waiting on the modal alone would turn a regression into a bare timeout naming nothing, so the
       * wait settles on either outcome and the throw below says which. Never rejects — the `catch` absorbs
       * it — while the migration's own rejection still surfaces from the `await` that follows.
       */
      const settlementPromise = migrationPromise
        .then(() => {
          isSettled = true;
        })
        .catch(() => {
          isSettled = true;
        });

      await waitUntil({
        message: 'the migration dialog opens',
        predicate: () => isSettled || document.querySelector('.modal-container') !== null,
        timeoutInMilliseconds: dialogWaitInMs
      });

      const modalEl = document.querySelector('.modal-container');
      if (!modalEl) {
        await settlementPromise;
        throw new Error('the proposal changed nothing, so no migration dialog opened');
      }

      const title = modalEl.querySelector('.modal-title')?.textContent ?? '';
      const settingNames = [...modalEl.querySelectorAll('.setting-item-name')].map((nameEl) => nameEl.textContent);

      const button = [...modalEl.querySelectorAll('button')].find((candidate) => candidate.textContent === pressedButtonText);
      if (!button) {
        throw new Error(`the migration dialog has no ${pressedButtonText} button`);
      }

      button.click();

      await settlementPromise;
      const migrateSettingsResult = await migrationPromise;

      const savedRecord: unknown = await plugin.loadData();
      function readSavedValue(key: string): unknown {
        return typeof savedRecord !== 'object' || savedRecord === null ? undefined : Object.entries(savedRecord).find(([entryKey]) => entryKey === key)?.[1];
      }

      return {
        apiVersion: apiRecord.apiVersion,
        isApplied: migrateSettingsResult.isApplied,
        publishedTitlePropertyNames: apiRecord.api.getTitlePropertyNames(),
        savedIsTitlesModuleEnabled: readSavedValue('isTitlesModuleEnabled'),
        savedTitlePropertyNames: readSavedValue('titlePropertyNames'),
        settingNames,
        title
      };
    },
    input: {
      BUTTON_TEXT: buttonText,
      DIALOG_WAIT_IN_MS,
      PLUGIN_ID,
      SOURCE_PLUGIN_ID
    },
    vaultPath: getTemporaryVault().path
  });
}

describe('A plugin handing its title property over through migrateSettings', () => {
  beforeEach(async () => {
    // Stated rather than inherited: the vault is shared by every suite in this project, and both cases
    // rest on `subtitle` being absent and the module being off.
    const result = await applyPluginSettings({
      isNamesModuleEnabled: false,
      isTitlesModuleEnabled: false,
      titlePropertyNames: ['title']
    });
    expect(result.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);

  afterAll(async () => {
    await applyPluginSettings({
      isNamesModuleEnabled: false,
      isTitlesModuleEnabled: false,
      titlePropertyNames: ['title']
    });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('adds the proposed name to the list and switches the module on when the user presses OK', async () => {
    const result = await runScenario(BUTTON_TEXT_OK);

    expect(result.apiVersion).toBe('1.1.0');
    // The dialog names the plugin that asked; the manifest is absent here, so it falls back to the id.
    expect(result.title).toBe(`Title properties proposed by ${SOURCE_PLUGIN_ID}`);
    // The editable list, and the module offer that appears only while the module is off.
    expect(result.settingNames).toEqual(['Title properties', 'Titles module']);
    expect(result.isApplied).toBe(true);
    // Merged, not replaced: the user's `title` survives the handover.
    expect(result.savedTitlePropertyNames).toEqual(['title', 'subtitle']);
    expect(result.savedIsTitlesModuleEnabled).toBe(true);
    expect(result.publishedTitlePropertyNames).toEqual(['title', 'subtitle']);
  }, SCENARIO_TIMEOUT_IN_MS);

  it('writes nothing and reports it when the user cancels', async () => {
    const result = await runScenario(BUTTON_TEXT_CANCEL);

    expect(result.isApplied).toBe(false);
    expect(result.savedTitlePropertyNames).toEqual(['title']);
    expect(result.savedIsTitlesModuleEnabled).not.toBe(true);
  }, SCENARIO_TIMEOUT_IN_MS);
});
