import type { AbortSignalComponent } from '@mnaoumov/obsidian-lib/components/abort-signal-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  CachedMetadata,
  TAbstractFile
} from 'obsidian';

import { getCanvasReferences } from '@mnaoumov/obsidian-lib/canvas';
import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { CorePluginToggleComponent } from '@mnaoumov/obsidian-lib/components/core-plugin-toggle-component';
import { isCanvasFile } from '@mnaoumov/obsidian-lib/file-system';
import { loop } from '@mnaoumov/obsidian-lib/loop';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';
import { TFile } from 'obsidian';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { BacklinkCacheComponent } from './backlink-cache-component.ts';

import { reloadBacklinksView } from './backlink-core-plugin.ts';
import { MetadataCacheGetCachePatchComponent } from './patches/metadata-cache-get-cache-patch-component.ts';

export function isCanvasPluginEnabled(app: App): boolean {
  return !!app.internalPlugins.getEnabledPluginById(InternalPluginName.Canvas);
}

const canvasMetadataCacheMap = new Map<string, CachedMetadata>();

interface CanvasComponentConstructorParams {
  readonly abortSignalComponent: AbortSignalComponent;
  readonly app: App;
  readonly backlinkCacheComponent: BacklinkCacheComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class CanvasComponent extends ComponentEx {
  private readonly abortSignalComponent: AbortSignalComponent;
  private readonly app: App;
  private readonly backlinkCacheComponent: BacklinkCacheComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: CanvasComponentConstructorParams) {
    super();

    this.app = params.app;
    this.abortSignalComponent = params.abortSignalComponent;
    this.backlinkCacheComponent = params.backlinkCacheComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public getCache(path: string): CachedMetadata | null {
    return canvasMetadataCacheMap.get(path) ?? null;
  }

  public override onload(): void {
    this.addChild(
      new MetadataCacheGetCachePatchComponent({
        canvasComponent: this,
        metadataCache: this.app.metadataCache
      })
    );

    this.registerEvent(this.app.vault.on('create', this.handleFileCreateOrModify.bind(this)));
    this.registerEvent(this.app.vault.on('modify', this.handleFileCreateOrModify.bind(this)));
    this.registerEvent(this.app.vault.on('delete', this.handleFileDelete.bind(this)));
    this.registerEvent(this.app.vault.on('rename', this.handleFileRename.bind(this)));

    /*
     * Runs the enable at load when Canvas is already enabled, then on each edge of its `enabled` flag, which
     * Obsidian publishes through the `change` signal of `app.internalPlugins` - a toggle not driven by the user
     * included. The disable also runs on unload while Canvas is enabled, so the synthetic canvas caches never
     * outlive the plugin.
     */
    this.addChild(
      new CorePluginToggleComponent({
        app: this.app,
        corePluginId: InternalPluginName.Canvas,
        onDisable: (): void => {
          this.onCanvasCorePluginDisable();
        },
        onEnable: (): void => {
          this.onCanvasCorePluginEnable();
        },
        shouldCallOnDisableOnUnload: true
      })
    );
  }

  private handleFileCreateOrModify(file: TAbstractFile): void {
    if (!isCanvasFile(file) || !(file instanceof TFile)) {
      return;
    }
    invokeAsyncSafely(async () => {
      await this.initCanvasMetadataCache(file);
      this.backlinkCacheComponent.triggerRefresh(file.path);
    });
  }

  private handleFileDelete(file: TAbstractFile): void {
    if (!isCanvasFile(file)) {
      return;
    }
    canvasMetadataCacheMap.delete(file.path);
  }

  private handleFileRename(file: TAbstractFile, oldPath: string): void {
    if (!isCanvasFile(file)) {
      return;
    }
    const canvasMetadataCache = canvasMetadataCacheMap.get(oldPath);
    if (canvasMetadataCache) {
      canvasMetadataCacheMap.set(file.path, canvasMetadataCache);
    }
    canvasMetadataCacheMap.delete(oldPath);
  }

  private async initCanvasMetadataCache(file: TFile): Promise<void> {
    if (!isCanvasFile(file)) {
      return;
    }

    const references = await getCanvasReferences(this.app, file);

    const cachedMetadata: CachedMetadata = {
      frontmatterLinks: []
    };

    // Store the canvas references in a synthetic per-file metadata cache so that
    // `metadataCache.getCache(canvasPath)` exposes them.
    // Obsidian natively resolves canvas backlinks (Backlinks pane, graph, `getBacklinksForFile`,
    // `resolvedLinks`) as of 1.12.4, but still leaves the per-file `getCache` empty for canvas
    // files — the one canvas surface the plugin still fills.
    for (const reference of references) {
      cachedMetadata.frontmatterLinks?.push(reference);
    }

    /*
     * Kept in memory only, and served through the `getCache` patch. It is never written into Obsidian's own
     * `fileCache` / `metadataCache`, which are persisted: Obsidian keeps a canvas's hash empty there, a real
     * hash made core `iterateAllRefs` count every canvas reference twice (once from the cache, once from the
     * canvas link updater), and `Advanced Canvas` keys its full canvas entry on that same content hash, so it
     * adopted this partial one - without the `frontmatter` - and kept it until the vault cache was rebuilt.
     */
    canvasMetadataCacheMap.set(file.path, cachedMetadata);
    await this.removeLegacyPersistedEntry(file);
  }

  private onCanvasCorePluginDisable(): void {
    this.removeCanvasMetadataCache();
    invokeAsyncSafely(async () => {
      await reloadBacklinksView(this.app);
    });
  }

  private onCanvasCorePluginEnable(): void {
    this.repairCanvasIndex();
    invokeAsyncSafely(async () => {
      await this.processAllCanvasFiles();
      await reloadBacklinksView(this.app);
    });
  }

  private async processAllCanvasFiles(): Promise<void> {
    await loop({
      abortSignal: this.abortSignalComponent.abortSignal,
      buildNoticeMessage: ({ item, iterationString }) => `Processing backlinks ${iterationString} - ${item.path}`,
      items: this.app.vault.getFiles().filter((file) => isCanvasFile(file)),
      pluginNoticeComponent: this.pluginNoticeComponent,
      processItem: async (canvasFile) => {
        await this.initCanvasMetadataCache(canvasFile);
        this.backlinkCacheComponent.triggerRefresh(canvasFile.path);
      },
      progressBarTitle: 'Processing canvas files...',
      shouldContinueOnError: true,
      shouldShowNotice: this.pluginSettingsComponent.settings.shouldShowProgressBarOnLoad
    });
  }

  private removeCanvasMetadataCache(): void {
    const canvasFiles = this.app.vault.getFiles().filter((file) => isCanvasFile(file));
    for (const file of canvasFiles) {
      if (this.abortSignalComponent.abortSignal.aborted) {
        return;
      }
      this.app.metadataCache.deletePath(file.path);
      this.backlinkCacheComponent.triggerRemove(file.path);
    }
  }

  /*
   * Before this was fixed, the entry above was also persisted, as a `{ frontmatterLinks }` object at the
   * canvas's content hash, and a vault keeps it across updates. Nothing else writes that shape for a canvas:
   * Obsidian writes no metadata entry for one and `Advanced Canvas` stamps `v` on its own. So it is dropped, the hash is put
   * back to the empty one Obsidian keeps, and the file is recomputed, which lets `Advanced Canvas` (when
   * installed) build its own entry instead of the one it adopted.
   */
  private async removeLegacyPersistedEntry(file: TFile): Promise<void> {
    const metadataCache = this.app.metadataCache;
    const hash = metadataCache.getFileInfo(file.path)?.hash;
    if (!hash || !isLegacyCanvasEntry(metadataCache.metadataCache[hash])) {
      return;
    }

    metadataCache.saveMetaCache(hash, castTo<CachedMetadata>(null));
    metadataCache.saveFileCache(file.path, {
      hash: '',
      mtime: file.stat.mtime,
      size: file.stat.size
    });
    await metadataCache.computeFileMetadataAsync(file);
  }

  /*
   * Works around Obsidian's own defect, measured in 1.14.2 with this plugin disabled: disabling the core Canvas
   * plugin unloads its canvas index, and enabling it again never loads that same object back. The index registers
   * the vault handlers in its `onload`, so every canvas created after the toggle gets no `resolvedLinks` until a
   * restart - and this plugin leaves canvas `resolvedLinks` to Obsidian rather than mirroring into them. A loaded
   * index is left alone, so this is a no-op whenever Obsidian behaves.
   */
  private repairCanvasIndex(): void {
    const canvasIndex = this.app.internalPlugins.getPluginById(InternalPluginName.Canvas)?.instance.index;
    if (canvasIndex && !canvasIndex._loaded) {
      canvasIndex.load();
    }
  }
}

function isLegacyCanvasEntry(cachedMetadata: CachedMetadata | undefined): boolean {
  if (!cachedMetadata) {
    return false;
  }
  const keys = Object.keys(cachedMetadata);
  return keys.length === 1 && keys[0] === 'frontmatterLinks';
}
