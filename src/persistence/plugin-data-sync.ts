/**
 * @file
 *
 * This device's choice of whether the plugin's shared state is synchronized through the vault, and where.
 *
 * Every `SharedDataStore` the plugin opens (heading observations, property names) is opened here, at one permanent
 * discovery anchor and with this device's consent. A disabled store makes no adapter call, so a device that never
 * turns sync on never creates a folder: its state stays in the local IndexedDB replica.
 *
 * Both choices live in IndexedDB, never in the synchronized settings: a synced `data.json` must not enroll a new
 * device, and a different anchor is a different store.
 */

import type { DataStoreMergeKind } from '@mnaoumov/obsidian-lib/data-stores/data-store-replica';
import type { App } from 'obsidian';

import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';
import { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';
import { noopAsync } from '@mnaoumov/typescript-lib/function';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import {
  DEFAULT_PLUGIN_DATA_FOLDER,
  LEGACY_PLUGIN_DATA_FOLDER,
  PLUGIN_ID,
  validatePluginDataFolder
} from './storage-paths.ts';

const STORE_ID = 'plugin-data-sync-v1';
const SYNC_ENABLED_KEY = 'sync-enabled';
const ANCHOR_FOLDER_KEY = 'anchor-folder';
const TARGET_FOLDER_KEY = 'target-folder';

/**
 * The store whose presence at the legacy folder enrolls an upgraded device: heading times are history a user opted
 * into and cannot rebuild. Property names are re-registered by their consumers and by the date-property scan, so their
 * journals alone never do.
 */
const HEADING_STORE_ID = 'heading-observations-v1';

interface OpenedStore {
  readonly shared: SharedDataStore;
  readonly storeId: string;
}

interface PluginDataSyncConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface PluginDataSyncOpenSharedParams {
  readonly kind: DataStoreMergeKind;
  readonly local: LocalDataStore;
  readonly storeId: string;
}

/**
 * Owns this device's sync consent, the discovery anchor and the relocation of every shared store.
 */
export class PluginDataSync {
  /**
   * The permanent discovery anchor every shared store is opened at.
   *
   * @returns The vault-relative folder.
   */
  public get anchorFolder(): string {
    return this.anchor;
  }

  /**
   * Whether this device synchronizes the shared state through the vault.
   *
   * @returns The consent, `false` until loaded.
   */
  public get isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  /**
   * The folders that hold, or will hold, this plugin's synchronized state: the anchor, every folder a move used, and
   * the folder the last move asked for.
   *
   * @returns Unique vault-relative folders, anchor first.
   */
  public get storeFolders(): string[] {
    const folders = [this.anchor];
    for (const { shared, storeId } of this.stores) {
      const suffix = `/${PLUGIN_ID}/${storeId}`;
      for (const root of shared.transportRoots) {
        if (root.endsWith(suffix)) {
          folders.push(root.slice(0, -suffix.length));
        }
      }
    }
    if (this.targetFolder !== null) {
      folders.push(this.targetFolder);
    }
    return [...new Set(folders)];
  }

  private anchor = DEFAULT_PLUGIN_DATA_FOLDER;
  private readonly app: App;
  private readonly changedCallbacks = new Set<() => void>();
  private loading: null | Promise<LocalDataStore> = null;
  private operation: Promise<void> = noopAsync();
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private prefixes: null | string[] = null;
  private readonly stores = new Set<OpenedStore>();
  private syncEnabled = false;
  private targetFolder: null | string = null;

  public constructor(params: PluginDataSyncConstructorParams) {
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Closes the device-local connection, once its load has settled. The shared stores belong to their owners, who
   * close their own.
   *
   * @returns Completion of the close.
   */
  public async close(): Promise<void> {
    const loading = this.loading;
    this.loading = null;
    this.changedCallbacks.clear();
    this.stores.clear();
    this.prefixes = null;
    const local = await loading?.catch(() => null);
    local?.close();
  }

  /**
   * Reads the consent and the anchor. Memoized; every other member waits for it.
   *
   * @returns Completion of the load.
   */
  public async ensureLoaded(): Promise<void> {
    await this.getLocal();
  }

  /**
   * Whether a path lies inside this plugin's synchronized state, wherever it is or was.
   *
   * @param path - Vault-relative path.
   * @returns Whether an index must skip the path.
   */
  public isPluginDataPath(path: string): boolean {
    // Called once per note by every index's startup pass, so the folders are worked out once per change.
    this.prefixes ??= [...new Set([...this.storeFolders, DEFAULT_PLUGIN_DATA_FOLDER, LEGACY_PLUGIN_DATA_FOLDER])].map((folder) => `${folder}/${PLUGIN_ID}/`);
    return this.prefixes.some((prefix) => path.startsWith(prefix))
      // The folder the synchronized settings name, where another device may already have moved the store.
      || path.startsWith(`${this.pluginSettingsComponent.settings.pluginDataFolder}/${PLUGIN_ID}/`);
  }

  /**
   * Calls back after the consent changed or a move finished.
   *
   * @param callback - The callback.
   * @returns A function that stops the callbacks.
   */
  public onChanged(callback: () => void): () => void {
    this.changedCallbacks.add(callback);
    return () => {
      this.changedCallbacks.delete(callback);
    };
  }

  /**
   * Opens a shared store at the anchor with this device's consent, and catches it up with the last requested move.
   *
   * @param params - The merge rule, the store's dedicated local replica and its id.
   * @returns The opened store, registered until {@link PluginDataSync.release}.
   */
  public async openShared(params: PluginDataSyncOpenSharedParams): Promise<SharedDataStore> {
    await this.ensureLoaded();
    const shared = await SharedDataStore.open({
      adapter: this.app.vault.adapter,
      folder: this.anchor,
      isSyncEnabled: this.syncEnabled,
      kind: params.kind,
      local: params.local,
      pluginId: PLUGIN_ID,
      storeId: params.storeId
    });
    if (this.syncEnabled && this.targetFolder !== null) {
      // A store that was closed during the move follows it the first time it opens again.
      await shared.relocate({ folder: this.targetFolder });
    }
    this.stores.add({ shared, storeId: params.storeId });
    this.prefixes = null;
    return shared;
  }

  /**
   * Stops tracking a store its owner has closed.
   *
   * @param shared - The closed store.
   */
  public release(shared: SharedDataStore): void {
    for (const store of this.stores) {
      if (store.shared === shared) {
        this.stores.delete(store);
      }
    }
    this.prefixes = null;
  }

  /**
   * Moves every open shared store, and every store opened later, to a new folder. History is copied and verified by the
   * library, and the source is kept as a reader.
   *
   * @param folder - The vault-relative destination.
   */
  public async relocate(folder: string): Promise<void> {
    const error = validatePluginDataFolder(folder);
    if (error) {
      throw new Error(error);
    }
    await this.run(async () => {
      if (!this.syncEnabled) {
        throw new Error('Turn on sync between devices before moving the plugin data folder: a device that does not sync keeps its data in its own local storage, with no folder to move.');
      }
      const local = await this.getLocal();
      // Remembered first, so a store closed right now, or an interrupted copy, still follows the move.
      await local.set(TARGET_FOLDER_KEY, folder);
      this.targetFolder = folder;
      for (const { shared } of this.stores) {
        await shared.relocate({ folder });
      }
    });
    this.notifyChanged();
  }

  /**
   * Changes this device's consent. Enabling publishes a complete checkpoint of each open store; disabling keeps every
   * file already in the vault, and the local replica keeps the full state.
   *
   * @param isEnabled - Whether this device synchronizes.
   */
  public async setSyncEnabled(isEnabled: boolean): Promise<void> {
    await this.run(async () => {
      const local = await this.getLocal();
      if (!isEnabled) {
        // Persisted first: a crash must not turn transport back on.
        await local.set(SYNC_ENABLED_KEY, false);
        this.syncEnabled = false;
        for (const { shared } of this.stores) {
          await shared.setSyncEnabled(false);
        }
        return;
      }

      const anchor = await this.resolveAnchor(local);
      if (anchor !== this.anchor && this.stores.size > 0) {
        // An earlier version's history arrived at the legacy folder after the stores opened here.
        await local.set(ANCHOR_FOLDER_KEY, anchor);
        throw new Error(`This plugin's history from another device has arrived in \`${anchor}\`. Restart Obsidian, then turn sync on again, so this device joins it.`);
      }
      this.anchor = anchor;
      try {
        for (const { shared } of this.stores) {
          await shared.setSyncEnabled(true);
          if (this.targetFolder !== null) {
            await shared.relocate({ folder: this.targetFolder });
          }
        }
        // Committed only once transport works, so a failed setup is retried explicitly.
        await local.set(ANCHOR_FOLDER_KEY, anchor);
        await local.set(SYNC_ENABLED_KEY, true);
        this.syncEnabled = true;
      } catch (error) {
        for (const { shared } of this.stores) {
          await shared.setSyncEnabled(false);
        }
        throw error;
      }
    });
    this.notifyChanged();
  }

  private async getLocal(): Promise<LocalDataStore> {
    this.loading ??= this.load();
    return await this.loading;
  }

  private async load(): Promise<LocalDataStore> {
    const local = await LocalDataStore.open({ pluginId: PLUGIN_ID, storeId: STORE_ID, vaultId: this.app.appId });
    try {
      let syncEnabled = await local.get(SYNC_ENABLED_KEY);
      if (syncEnabled === undefined) {
        syncEnabled = this.pluginSettingsComponent.settings.isHeadingsModuleEnabled
          && await this.app.vault.adapter.exists(`${LEGACY_PLUGIN_DATA_FOLDER}/${PLUGIN_ID}/${HEADING_STORE_ID}`);
        await local.set(SYNC_ENABLED_KEY, syncEnabled);
      }
      this.syncEnabled = syncEnabled === true;
      this.anchor = await this.resolveAnchor(local);
      if (this.syncEnabled) {
        await local.set(ANCHOR_FOLDER_KEY, this.anchor);
      }
      const targetFolder = await local.get(TARGET_FOLDER_KEY);
      this.targetFolder = typeof targetFolder === 'string' ? targetFolder : null;
      this.prefixes = null;
      return local;
    } catch (error) {
      local.close();
      throw error;
    }
  }

  private notifyChanged(): void {
    this.prefixes = null;
    for (const callback of this.changedCallbacks) {
      callback();
    }
  }

  /**
   * Picks the anchor: the one this device fixed when it first synchronized, else the legacy folder when the vault
   * already holds this plugin's history there, else the default folder.
   *
   * @param local - The device-local store.
   * @returns The anchor folder.
   */
  private async resolveAnchor(local: LocalDataStore): Promise<string> {
    const stored = await local.get(ANCHOR_FOLDER_KEY);
    if (typeof stored === 'string') {
      return stored;
    }
    return await this.app.vault.adapter.exists(`${LEGACY_PLUGIN_DATA_FOLDER}/${PLUGIN_ID}`) ? LEGACY_PLUGIN_DATA_FOLDER : DEFAULT_PLUGIN_DATA_FOLDER;
  }

  private async run(callback: () => Promise<void>): Promise<void> {
    const run = this.operation.catch(() => undefined).then(callback);
    this.operation = run;
    await run;
  }
}
