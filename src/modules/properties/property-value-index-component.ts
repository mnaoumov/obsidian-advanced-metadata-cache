import type {
  App,
  Debouncer,
  FrontMatterCache,
  TAbstractFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import { debounce } from 'obsidian';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { PropertyValueIndex } from './property-value-index.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import { isDatePropertyName } from './date-properties.ts';

interface PropertyValueIndexComponentConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly propertyValueIndex: PropertyValueIndex;
}

/**
 * How long changes are gathered before the index is written to disk. Not reset by each change, so a vault
 * edited without pause is still saved this often.
 */
export const SAVE_DEBOUNCE_IN_MILLISECONDS = 5000;

const SYNCHRONIZE_INTERVAL_IN_MILLISECONDS = 30_000;
const SYNCHRONIZE_DEBOUNCE_IN_MILLISECONDS = 1000;

/**
 * The `Properties` module: keeps the {@link PropertyValueIndex} current for as long as it is on.
 *
 * On layout ready it loads the saved index, which answers at once, then rebuilds it from the metadata cache
 * once that is ready — a read of the cache Obsidian already holds for each note, never of the note itself —
 * and then follows the vault's own events. The `Safe` answers wait for that rebuild. Every property whose
 * assigned type is `date` or `datetime`, or whose name matches the `datePropertyNames` setting, is
 * registered along the way, in each casing a note spells it, so the ordered index holds every dated value
 * without a consumer having to name the properties; a type assigned later is caught by
 * `metadataTypeManager`'s own `changed` event, and a name added to the setting by its `saveSettings`. The
 * index is written to disk on a debounce and once more when the module is switched off, and its values are
 * cleared from memory at both edges, since nothing keeps them current while the module is off.
 */
export class PropertyValueIndexComponent extends LayoutReadyComponent {
  /**
   * Whether the index has been rebuilt from the metadata cache since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly builtPromise: Promise<void>;
  private datePropertyNamesKey = '';
  private isBuiltValue = false;
  private isLoaded = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly propertyValueIndex: PropertyValueIndex;
  private readonly requestSave: Debouncer<[], void>;
  private resolveBuiltPromise: () => void = noop;

  public constructor(params: PropertyValueIndexComponentConstructorParams) {
    super(params.app);

    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.propertyValueIndex = params.propertyValueIndex;
    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });
    this.requestSave = debounce(() => {
      invokeAsyncSafely(() => this.propertyValueIndex.save());
    }, SAVE_DEBOUNCE_IN_MILLISECONDS);
  }

  public override onunload(): void {
    this.requestSave.cancel();

    // Not before the load: what a registration made dirty is a names-only state that would overwrite the file.
    if (this.isLoaded && this.propertyValueIndex.isDirty) {
      // `save` serializes before its first `await`, so clearing straight after it still saves this state.
      invokeAsyncSafely(() => this.propertyValueIndex.save());
    }
    invokeAsyncSafely(() => this.propertyValueIndex.close());

    this.propertyValueIndex.clear();
    // A caller still waiting is answered by the index, which answers `null` while the module is off.
    this.resolveBuiltPromise();
    super.onunload();
  }

  /**
   * Starts indexing a property. While the index is already built, the new property is filled from the
   * metadata cache at once, so the next answer is complete; before that, the rebuild fills it.
   *
   * @param propertyName - The property name.
   */
  public registerPropertyName(propertyName: string): void {
    if (!this.propertyValueIndex.register(propertyName)) {
      return;
    }

    // Before the build, the build fills it and saves: a save before the load would overwrite the file.
    if (!this.isBuiltValue) {
      return;
    }

    this.refreshAll();
    this.requestSave();
  }

  /**
   * Waits for the rebuild from the metadata cache, or for the module to be switched off first.
   *
   * @returns A {@link Promise} that resolves once the index is built.
   */
  public async waitForBuild(): Promise<void> {
    await this.builtPromise;
  }

  protected override async onLayoutReady(): Promise<void> {
    const synchronize = async (): Promise<void> => {
      if (!(this.isBuiltValue && await this.propertyValueIndex.synchronize()) || this.isUnloaded()) {
        return;
      }

      this.refreshAll();
      this.requestSave();
    };
    const requestSynchronize = debounce(() => {
      invokeAsyncSafely(synchronize);
    }, SYNCHRONIZE_DEBOUNCE_IN_MILLISECONDS);
    this.register(() => requestSynchronize.cancel());
    this.registerInterval(window.setInterval(() => {
      invokeAsyncSafely(synchronize);
    }, SYNCHRONIZE_INTERVAL_IN_MILLISECONDS));
    this.registerDomEvent(window, 'focus', () => {
      invokeAsyncSafely(synchronize);
    });
    await this.propertyValueIndex.load();

    if (this.isUnloaded()) {
      return;
    }

    this.isLoaded = true;

    /*
     * Registered BEFORE the rebuild, which awaits the metadata cache: a `changed` arriving meanwhile is
     * already the newer answer, and the rebuild reading the same cache afterwards agrees with it.
     */
    this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => {
      if (isPluginDataPath(file.path)) {
        if (!file.path.endsWith('/have.md')) {
          requestSynchronize();
        }
        return;
      }
      // A date property new to the index has values in other notes too, which only a full refresh reads.
      if (this.registerDateProperties(cache.frontmatter) && this.isBuiltValue) {
        this.refreshAll();
      } else {
        this.propertyValueIndex.refresh({ frontmatter: cache.frontmatter, path: file.path });
      }

      this.requestSave();
    }));

    this.registerEvent(this.app.metadataTypeManager.on('changed', () => {
      this.handleDatePropertiesChange();
    }));

    this.datePropertyNamesKey = this.getDatePropertyNamesKey();
    const saveSettingsEventRef = this.pluginSettingsComponent.on('saveSettings', () => {
      this.handleSaveSettings();
    });
    this.register(() => {
      this.pluginSettingsComponent.offref(saveSettingsEventRef);
    });

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.handleDelete(abstractFile);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.handleRename(abstractFile, oldPath);
    }));

    await ensureMetadataCacheReady(this.app);

    if (this.isUnloaded()) {
      return;
    }

    this.refreshAll();
    this.isBuiltValue = true;
    this.resolveBuiltPromise();
    this.requestSave();
  }

  private getDatePropertyNamesKey(): string {
    return this.pluginSettingsComponent.settings.datePropertyNames.join('\n');
  }

  /**
   * Registers the properties a type was just assigned to, or a name setting just matched. Before the build,
   * the build does it.
   */
  private handleDatePropertiesChange(): void {
    if (!this.isBuiltValue || !this.registerDatePropertiesInVault()) {
      return;
    }

    this.refreshAll();
    this.requestSave();
  }

  private handleDelete(abstractFile: TAbstractFile): void {
    if (isFolder(abstractFile)) {
      this.propertyValueIndex.deleteSubtree(abstractFile.path);
    } else {
      this.propertyValueIndex.delete(abstractFile.path);
    }

    this.requestSave();
  }

  /**
   * Moves a renamed note's values with it. A folder's descendants each fire a `rename` of their own too,
   * in an order that is not a contract; the subtree move here and the per-file moves are each a no-op for
   * a path already moved, so the same state is reached in either order.
   *
   * @param abstractFile - The file or folder, at its new path.
   * @param oldPath - The path it had.
   */
  private handleRename(abstractFile: TAbstractFile, oldPath: string): void {
    if (isFolder(abstractFile)) {
      this.propertyValueIndex.renameSubtree(oldPath, abstractFile.path);
    } else {
      this.propertyValueIndex.rename(oldPath, abstractFile.path);
    }

    this.requestSave();
  }

  /**
   * Re-reads the date properties when their names changed. Only an addition registers anything: a removed
   * name stays indexed, as a property retyped away from a date does.
   */
  private handleSaveSettings(): void {
    const datePropertyNamesKey = this.getDatePropertyNamesKey();

    if (this.datePropertyNamesKey === datePropertyNamesKey) {
      return;
    }

    this.datePropertyNamesKey = datePropertyNamesKey;
    this.handleDatePropertiesChange();
  }

  /**
   * Reads every note's registered properties from the metadata cache, and forgets the notes that are gone.
   * The date properties are registered first, so a note read early is read for one a later note
   * introduces.
   */
  private refreshAll(): void {
    this.registerDatePropertiesInVault();
    const files = this.app.vault.getMarkdownFiles();
    this.propertyValueIndex.retain(new Set(files.map((file) => file.path)));

    for (const file of files) {
      this.propertyValueIndex.refresh({ frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter, path: file.path });
    }
  }

  /**
   * Registers each property of a note that holds dates, by its assigned type or by its name.
   *
   * @param frontmatter - The note's frontmatter.
   * @returns Whether any of them is new.
   */
  private registerDateProperties(frontmatter: FrontMatterCache | undefined): boolean {
    let isNew = false;

    for (const propertyName of Object.keys(frontmatter ?? {})) {
      if (isDatePropertyName(this.app, this.pluginSettingsComponent.settings, propertyName)) {
        isNew = this.propertyValueIndex.register(propertyName) || isNew;
      }
    }

    return isNew;
  }

  /**
   * Registers every date property any note carries.
   *
   * @returns Whether any of them is new.
   */
  private registerDatePropertiesInVault(): boolean {
    let isNew = false;

    for (const file of this.app.vault.getMarkdownFiles()) {
      isNew = this.registerDateProperties(this.app.metadataCache.getFileCache(file)?.frontmatter) || isNew;
    }

    return isNew;
  }
}
