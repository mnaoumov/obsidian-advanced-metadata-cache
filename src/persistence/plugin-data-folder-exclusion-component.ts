/**
 * @file
 *
 * Keeps the folders that hold this plugin's synchronized state out of the user's way while this device syncs, and
 * explains them.
 *
 * Each folder goes into Obsidian's **Excluded files** (`userIgnoreFilters`), so its journals stay out of search, the
 * graph and the quick switcher, and gets a `README.md` saying what it is and that it must not be removed.
 *
 * The default folder is shared with other plugins of the same author, which keep their own subfolders and may write
 * the folder's README themselves. So this plugin writes the top-level README only when there is none, keeps its own
 * README inside its subfolder current, and gives up its Excluded files entry only once no other plugin's subfolder is
 * left beside its own.
 *
 * The entries this plugin added are remembered per device, so an entry the user already had is never recorded as
 * ours, and so never removed.
 */

import type { App } from 'obsidian';

import { registerAsyncEvent } from '@mnaoumov/obsidian-lib/components/async-events-component';
import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { noopAsync } from '@mnaoumov/typescript-lib/function';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginDataSync } from './plugin-data-sync.ts';

import { PLUGIN_ID } from './storage-paths.ts';

const USER_IGNORE_FILTERS_CONFIG_KEY = 'userIgnoreFilters';
const MANAGED_IGNORE_FILTERS_LOCAL_STORAGE_KEY = `${PLUGIN_ID}:managed-ignore-filters-v1`;
const README_FILE_NAME = 'README.md';

/**
 * Where a README sends a user who wants the whole story.
 */
export const PLUGIN_DATA_FOLDER_DOCS_URL = 'https://mnaoumov.dev/obsidian/plugin-sync-data/';

/**
 * The folder's top-level README, written only when the folder has none.
 */
export const PLUGIN_DATA_FOLDER_README = `# Plugin sync data - do not remove

This folder holds data that Obsidian plugins keep in your vault so that it can sync between your devices. Each plugin keeps its own subfolder, with a README of its own.

- Do not delete, move or rename this folder or anything in it, and do not edit these files by hand.
- Keep this folder synchronized on every device that uses the vault.
- The folder is listed in Obsidian's **Settings → Files and links → Excluded files**, so it stays out of search, the graph and the quick switcher.

Learn more: ${PLUGIN_DATA_FOLDER_DOCS_URL}
`;

/**
 * The README inside this plugin's own subfolder, kept current.
 */
export const PLUGIN_SUBFOLDER_README = `# Advanced Metadata Cache sync data - do not remove

The \`Advanced Metadata Cache\` plugin keeps the state it shares between your devices here: when each heading was created, modified and last seen, and the names of the properties other plugins asked it to index.

- Do not delete, move or rename this folder or anything in it, and do not edit these files by hand. Heading times are history, not a cache: what is removed cannot be rebuilt.
- To stop syncing, turn off **Sync between devices** in the plugin's settings on every device. Each device keeps its own copy in its local storage. Once no device syncs, this folder may be deleted.
- To put it somewhere else, use **Plugin data folder** and **Move** in the plugin's settings, rather than moving it by hand.

The plugin writes this file, so any change you make to it is lost.

Learn more: ${PLUGIN_DATA_FOLDER_DOCS_URL}
`;

interface PluginDataFolderExclusionComponentConstructorParams {
  readonly app: App;
  readonly pluginDataSync: PluginDataSync;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Keeps Excluded files in step with the store's folders, and writes their READMEs.
 */
export class PluginDataFolderExclusionComponent extends LayoutReadyComponent {
  private readonly pluginDataSync: PluginDataSync;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private reconciliation: Promise<void> = noopAsync();

  public constructor(params: PluginDataFolderExclusionComponentConstructorParams) {
    super(params.app);
    this.pluginDataSync = params.pluginDataSync;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Brings Excluded files and the README files up to date. Serialized, so overlapping triggers never race.
   *
   * @returns Completion of this reconciliation.
   */
  public reconcile(): Promise<void> {
    const run = this.reconciliation.catch(() => undefined).then(() => this.reconcileImpl());
    this.reconciliation = run;
    return run;
  }

  protected override onLayoutReady(): void {
    const schedule = this.scheduleReconcile.bind(this);
    registerAsyncEvent(
      this,
      this.pluginSettingsComponent.on('saveSettings', (newState, oldState) => {
        if (newState.effectiveValues.pluginDataFolder !== oldState.effectiveValues.pluginDataFolder) {
          schedule();
        }
      })
    );
    this.register(this.pluginDataSync.onChanged(schedule));
    schedule();
  }

  /**
   * Whether a folder holds another plugin's subfolder beside this plugin's own.
   *
   * @param folder - The vault-relative folder.
   * @returns Whether another plugin still uses the folder.
   */
  private async isSharedWithAnotherPlugin(folder: string): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(folder)) {
      return false;
    }
    const listed = await adapter.list(folder);
    return listed.folders.some((child) => child !== `${folder}/${PLUGIN_ID}`);
  }

  private readManagedFilters(): string[] {
    const value: unknown = this.app.loadLocalStorage(MANAGED_IGNORE_FILTERS_LOCAL_STORAGE_KEY);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private async reconcileImpl(): Promise<void> {
    await this.pluginDataSync.ensureLoaded();
    const folders = this.pluginDataSync.isSyncEnabled
      ? [...new Set([...this.pluginDataSync.storeFolders, this.pluginSettingsComponent.settings.pluginDataFolder])]
      : [];

    // Obsidian never indexes a hidden folder, so an entry for one would only be noise.
    const desiredFilters = folders.filter((folder) => folder.split('/').every((segment) => !segment.startsWith('.'))).map((folder) => `${folder}/`);
    const keptFilters: string[] = [];
    for (const filter of this.readManagedFilters()) {
      if (!desiredFilters.includes(filter) && await this.isSharedWithAnotherPlugin(filter.slice(0, -1))) {
        keptFilters.push(filter);
      }
    }
    this.updateFilters([...desiredFilters, ...keptFilters]);

    for (const folder of folders) {
      if (await this.app.vault.adapter.exists(`${folder}/${PLUGIN_ID}`)) {
        await this.writeReadmes(folder);
      }
    }
  }

  private scheduleReconcile(): void {
    invokeAsyncSafely(() => this.reconcile());
  }

  private updateFilters(desiredFilters: readonly string[]): void {
    const managedFilters = this.readManagedFilters();
    const currentFilters = this.app.vault.getConfig(USER_IGNORE_FILTERS_CONFIG_KEY) ?? [];
    const nextFilters = currentFilters.filter((filter) => !managedFilters.includes(filter) || desiredFilters.includes(filter));
    const nextManagedFilters = managedFilters.filter((filter) => desiredFilters.includes(filter) && nextFilters.includes(filter));
    for (const filter of desiredFilters) {
      if (nextFilters.includes(filter)) {
        continue;
      }

      nextFilters.push(filter);
      nextManagedFilters.push(filter);
    }

    if (nextFilters.length !== currentFilters.length || nextFilters.some((filter, index) => filter !== currentFilters[index])) {
      this.app.vault.setConfig(USER_IGNORE_FILTERS_CONFIG_KEY, nextFilters);
    }
    this.app.saveLocalStorage(MANAGED_IGNORE_FILTERS_LOCAL_STORAGE_KEY, nextManagedFilters.length > 0 ? nextManagedFilters : null);
  }

  private async writeReadmes(folder: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const topPath = `${folder}/${README_FILE_NAME}`;
    // Another plugin may have written its own; it says the same thing, so it is never overwritten.
    if (!await adapter.exists(topPath)) {
      await adapter.write(topPath, PLUGIN_DATA_FOLDER_README);
    }
    const ownPath = `${folder}/${PLUGIN_ID}/${README_FILE_NAME}`;
    if (await adapter.exists(ownPath) && await adapter.read(ownPath) === PLUGIN_SUBFOLDER_README) {
      return;
    }
    await adapter.write(ownPath, PLUGIN_SUBFOLDER_README);
  }
}
