import type { AbortSignalComponent } from '@mnaoumov/obsidian-lib/components/abort-signal-component';
import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { PathOrFile } from '@mnaoumov/obsidian-lib/file-system';
import type { CustomArrayDict } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  Debouncer,
  Reference
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import {
  getFileOrNull,
  getPath,
  isCanvasFile
} from '@mnaoumov/obsidian-lib/file-system';
import {
  extractReferenceFile,
  splitSubpath
} from '@mnaoumov/obsidian-lib/link';
import { loop } from '@mnaoumov/obsidian-lib/loop';
import {
  ensureMetadataCacheReady,
  getReferences
} from '@mnaoumov/obsidian-lib/metadata-cache';
import { sortReferences } from '@mnaoumov/obsidian-lib/reference';
import { getMarkdownFilesSorted } from '@mnaoumov/obsidian-lib/vault';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  CustomArrayDictImpl,
  ViewType
} from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  debounce,
  MarkdownView,
  TAbstractFile,
  TFile
} from 'obsidian';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import {
  BacklinksCorePluginComponent,
  reloadBacklinksView
} from './backlink-core-plugin.ts';
import {
  CanvasComponent,
  isCanvasPluginEnabled
} from './canvas.ts';
import { MetadataCacheGetBacklinksForFilePatchComponent } from './patches/metadata-cache-get-backlinks-for-file-patch-component.ts';
import { MetadataCacheUpdateRelatedLinksPatchComponent } from './patches/metadata-cache-update-related-links-patch-component.ts';

interface AddToMapSetParams {
  readonly key: string;
  readonly map: Map<string, Set<string>>;
  readonly value: string;
}

interface BacklinkCacheComponentAddBacklinkParams {
  readonly link: Reference;
  readonly sourcePath: string;
  readonly targetPath: string;
}

interface BacklinkCacheComponentAddUnresolvedReferencesParams {
  readonly dict: CustomArrayDict<Reference>;
  readonly references: Reference[];
  readonly sourcePath: string;
}
interface BacklinkCacheComponentConstructorParams {
  readonly abortSignalComponent: AbortSignalComponent;
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

const INTERVAL_IN_MILLISECONDS = 500;
const MARKDOWN_EXTENSION = '.md';

enum Action {
  Refresh,
  Remove
}

export class BacklinkCacheComponent extends LayoutReadyComponent {
  private readonly abortSignalComponent: AbortSignalComponent;
  private backlinksForFilePatchComponent: MetadataCacheGetBacklinksForFilePatchComponent | null = null;
  private readonly backlinksMap = new Map<string, Map<string, Set<Reference>>>();

  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private debouncedProcessPendingActions?: Debouncer<[], Promise<void>>;
  private isBuilt = false;

  /**
   * Every reference of every note, by the link path it is written with ({@link getLinkPathKey}) and then by the
   * note. Kept for resolved references too, and resolved only when asked: a target created, deleted or renamed
   * changes whether a reference resolves without changing the note that holds it, so an index of the unresolved
   * ones alone would need every such event to re-read its sources.
   */
  private readonly linkPathReferencesMap = new Map<string, Map<string, Set<Reference>>>();

  private readonly linksMap = new Map<string, Set<string>>();
  private readonly pendingActions = new Map<string, Action>();
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resolvedBasenameMap = new Map<string, Set<string>>();
  private readonly sourceLinkPathKeysMap = new Map<string, Set<string>>();
  private readonly unresolvedBasenameMap = new Map<string, Set<string>>();
  private readonly unresolvedLinksMap = new Map<string, Set<string>>();

  public constructor(params: BacklinkCacheComponentConstructorParams) {
    super(params.app);

    this.abortSignalComponent = params.abortSignalComponent;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public getBacklinksForFile(pathOrFile: PathOrFile): CustomArrayDict<Reference> {
    const notePathLinksMap = this.backlinksMap.get(getPath(this.app, pathOrFile)) ?? new Map<string, Set<Reference>>();
    const dict = new CustomArrayDictImpl<Reference>();

    for (const [notePath, links] of notePathLinksMap) {
      this.abortSignalComponent.abortSignal.throwIfAborted();
      for (const link of sortReferences([...links])) {
        this.abortSignalComponent.abortSignal.throwIfAborted();
        dict.add(notePath, link);
      }
    }

    invokeAsyncSafely(this.processPendingActions.bind(this));
    return dict;
  }

  /**
   * Answers `getBacklinksForFile()` the way a caller of the core method is answered right now: from this
   * cache once the patch is installed, and from Obsidian's own implementation until then, when the cache
   * has not been filled yet.
   *
   * @param pathOrFile - The path or file to get the backlinks for.
   * @returns The backlinks for the file. Empty for a path no file answers to, before the patch is
   *   installed.
   */
  public getBacklinksForFileAsCore(pathOrFile: PathOrFile): CustomArrayDict<Reference> {
    return this.backlinksForFilePatchComponent ? this.getBacklinksForFile(pathOrFile) : this.getBacklinksForFileOriginalOrEmpty(pathOrFile);
  }

  /**
   * {@link getBacklinksForFileAsCore}, waiting for pending changes to be processed first once the patch is
   * installed.
   *
   * @param pathOrFile - The path or file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  public async getBacklinksForFileAsCoreSafe(pathOrFile: PathOrFile): Promise<CustomArrayDict<Reference>> {
    return this.backlinksForFilePatchComponent
      ? await this.getBacklinksForFileSafe(pathOrFile)
      : this.getBacklinksForFileOriginalOrEmpty(pathOrFile);
  }

  /**
   * Calls Obsidian's own `getBacklinksForFile()`, bypassing this cache.
   *
   * @param file - The file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  public getBacklinksForFileOriginal(file: TFile): CustomArrayDict<Reference> {
    return this.backlinksForFilePatchComponent?.getBacklinksForFileOriginal(file) ?? this.app.metadataCache.getBacklinksForFile(file);
  }

  /**
   * Finds the references that link to a name no file answers to.
   *
   * @param linkPath - The link path as written, with or without a subpath, matched case-insensitively and with a
   *   trailing `.md` ignored.
   * @returns The references that do not resolve right now, keyed by the path of each linking note.
   */
  public getUnresolvedBacklinks(linkPath: string): CustomArrayDict<Reference> {
    const linkPathKey = getLinkPathKey(linkPath);
    const dict = new CustomArrayDictImpl<Reference>();

    if (!this.isBuilt) {
      // Until the walk has filled the index, the sources are the ones Obsidian's own map names.
      for (const [sourcePath, unresolvedLinkCounts] of Object.entries(this.app.metadataCache.unresolvedLinks)) {
        if (Object.keys(unresolvedLinkCounts).every((unresolvedLinkPath) => getLinkPathKey(unresolvedLinkPath) !== linkPathKey)) {
          continue;
        }

        const cache = this.app.metadataCache.getCache(sourcePath);
        const references = cache ? getReferences({ cache }).filter((reference) => getLinkPathKey(reference.link) === linkPathKey) : [];
        this.addUnresolvedReferences({ dict, references, sourcePath });
      }

      return dict;
    }

    for (const [sourcePath, references] of this.linkPathReferencesMap.get(linkPathKey) ?? []) {
      this.abortSignalComponent.abortSignal.throwIfAborted();
      this.addUnresolvedReferences({ dict, references: [...references], sourcePath });
    }

    invokeAsyncSafely(this.processPendingActions.bind(this));
    return dict;
  }

  /**
   * {@link getUnresolvedBacklinks}, waiting for pending changes to be processed first.
   *
   * @param linkPath - The link path as written.
   * @returns The references that do not resolve right now, keyed by the path of each linking note.
   */
  public async getUnresolvedBacklinksSafe(linkPath: string): Promise<CustomArrayDict<Reference>> {
    await this.processPendingActions();
    return this.getUnresolvedBacklinks(linkPath);
  }

  public async refreshBacklinkPanels(): Promise<void> {
    await reloadBacklinksView(this.app);

    for (const leaf of this.app.workspace.getLeavesOfType(ViewType.Markdown)) {
      if (this.abortSignalComponent.abortSignal.aborted) {
        return;
      }

      if (!(leaf.view instanceof MarkdownView) || !leaf.view.backlinks) {
        continue;
      }

      leaf.view.backlinks.recomputeBacklink(leaf.view.backlinks.file);
    }
  }

  public triggerRefresh(path: string): void {
    this.setPendingAction(path, Action.Refresh);
  }

  public triggerRemove(path: string): void {
    this.setPendingAction(path, Action.Remove);
  }

  public updateRelatedLinks(fileNames: string[]): void {
    for (const sourcePath of this.getSourcePathsToReResolve(fileNames)) {
      const sourceFile = this.app.vault.getFileByPath(sourcePath);
      if (sourceFile) {
        this.app.metadataCache.queueFileForLinkResolution(sourceFile);
      }
    }
  }

  protected override async onLayoutReady(): Promise<void> {
    this.backlinksForFilePatchComponent = this.addChild(
      new MetadataCacheGetBacklinksForFilePatchComponent({
        backlinkCacheComponent: this,
        metadataCache: this.app.metadataCache
      })
    );
    this.addChild(
      new MetadataCacheUpdateRelatedLinksPatchComponent({
        backlinkCacheComponent: this,
        metadataCache: this.app.metadataCache
      })
    );

    this.debouncedProcessPendingActions = debounce(this.processPendingActions.bind(this), INTERVAL_IN_MILLISECONDS, true);

    this.addChild(new BacklinksCorePluginComponent(this.app));
    this.addChild(
      new CanvasComponent({
        abortSignalComponent: this.abortSignalComponent,
        app: this.app,
        backlinkCacheComponent: this,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent
      })
    );
    // The listeners go in BEFORE the initial walk. The walk reads the cache Obsidian already holds, so a
    // note Obsidian parses while the walk is running must reach the index through its `changed` event,
    // which is only heard if something is listening by then.
    this.registerEvent(this.app.vault.on('rename', this.handleFileRename.bind(this)));
    this.registerEvent(this.app.vault.on('delete', this.handleFileDelete.bind(this)));
    this.registerEvent(this.app.vault.on('create', this.handleFileCreate.bind(this)));
    this.registerEvent(this.app.vault.on('modify', this.handleFileModify.bind(this)));
    this.registerEvent(this.app.metadataCache.on('changed', this.handleMetadataChanged.bind(this)));
    await ensureMetadataCacheReady(this.app);
    await this.processAllNotes();
    this.isBuilt = !this.abortSignalComponent.abortSignal.aborted;
  }

  private addBacklink(params: BacklinkCacheComponentAddBacklinkParams): void {
    const { link, sourcePath, targetPath } = params;
    let notePathLinksMap = this.backlinksMap.get(targetPath);

    if (!notePathLinksMap) {
      notePathLinksMap = new Map<string, Set<Reference>>();
      this.backlinksMap.set(targetPath, notePathLinksMap);
    }

    let linkSet = notePathLinksMap.get(sourcePath);

    if (!linkSet) {
      linkSet = new Set<Reference>();
      notePathLinksMap.set(sourcePath, linkSet);
    }

    linkSet.add(link);
    this.linksMap.get(sourcePath)?.add(targetPath);
  }

  private addUnresolvedReferences(params: BacklinkCacheComponentAddUnresolvedReferencesParams): void {
    const { dict, references, sourcePath } = params;

    for (const reference of sortReferences(references)) {
      if (!extractReferenceFile({ app: this.app, reference, sourcePathOrFile: sourcePath })) {
        dict.add(sourcePath, reference);
      }
    }
  }

  private getBacklinksForFileOriginalOrEmpty(pathOrFile: PathOrFile): CustomArrayDict<Reference> {
    const file = getFileOrNull({ app: this.app, pathOrFile });
    return file ? this.getBacklinksForFileOriginal(file) : new CustomArrayDictImpl<Reference>();
  }

  private async getBacklinksForFileSafe(pathOrFile: PathOrFile): Promise<CustomArrayDict<Reference>> {
    await this.processPendingActions();
    return this.getBacklinksForFile(pathOrFile);
  }

  private getSourcePathsToReResolve(fileNames: string[]): Set<string> {
    const sourcePaths = new Set<string>();
    const loweredFileNames = fileNames.map((fileName) => fileName.toLowerCase());

    for (const loweredFileName of loweredFileNames) {
      addAllToSet(sourcePaths, this.resolvedBasenameMap.get(loweredFileName));
    }

    for (const loweredFileName of loweredFileNames) {
      addAllToSet(sourcePaths, this.unresolvedBasenameMap.get(loweredFileName));
      if (loweredFileName.endsWith(MARKDOWN_EXTENSION)) {
        addAllToSet(sourcePaths, this.unresolvedBasenameMap.get(loweredFileName.slice(0, -MARKDOWN_EXTENSION.length)));
      }
    }

    return sourcePaths;
  }

  private handleFileCreate(file: TAbstractFile): void {
    if (file instanceof TFile) {
      this.setPendingAction(file.path, Action.Refresh);
    }
  }

  private handleFileDelete(file: TAbstractFile): void {
    this.setPendingAction(file.path, Action.Remove);
  }

  private handleFileModify(file: TAbstractFile): void {
    if (file instanceof TFile) {
      this.setPendingAction(file.path, Action.Refresh);
    }
  }

  private handleFileRename(file: TAbstractFile, oldPath: string): void {
    this.setPendingAction(oldPath, Action.Remove);
    this.setPendingAction(file.path, Action.Refresh);
  }

  private handleMetadataChanged(file: TFile): void {
    this.setPendingAction(file.path, Action.Refresh);
  }

  private async processAllNotes(): Promise<void> {
    await loop({
      abortSignal: this.abortSignalComponent.abortSignal,
      buildNoticeMessage: ({ item, iterationString }) => `Processing backlinks ${iterationString} - ${item.path}`,
      items: getMarkdownFilesSorted(this.app),
      pluginNoticeComponent: this.pluginNoticeComponent,
      processItem: (note) => {
        this.refreshBacklinks(note.path);
      },
      progressBarTitle: 'Initializing...',
      shouldContinueOnError: true,
      shouldShowNotice: this.pluginSettingsComponent.settings.shouldShowProgressBarOnLoad
    });
  }

  private async processPendingActions(): Promise<void> {
    // Drained until it stays empty, not processed as one snapshot: the panel refresh awaits, and a vault or
    // metadata event that fires meanwhile queues another action. With a single snapshot that action waited
    // for the next call, so `getBacklinksForFileSafe()` could answer from a cache it had promised was current.
    while (this.pendingActions.size > 0) {
      const pathActions = [...this.pendingActions];
      this.pendingActions.clear();

      for (const [path, action] of pathActions) {
        if (this.abortSignalComponent.abortSignal.aborted) {
          return;
        }

        switch (action) {
          case Action.Refresh: {
            this.refreshBacklinks(path);
            break;
          }
          case Action.Remove: {
            this.removeBacklinks(path);
            break;
          }
          default: {
            throw new Error('Unknown action');
          }
        }
      }

      if (this.pluginSettingsComponent.settings.shouldAutomaticallyRefreshBacklinkPanels) {
        await this.refreshBacklinkPanels();
      }
    }
  }

  private refreshBacklinks(notePath: string): void {
    this.consoleDebugComponent.consoleDebug(`Refreshing backlinks for ${notePath}`);
    this.removeLinkedPathEntries(notePath);

    const noteFile = getFileOrNull({
      app: this.app,
      pathOrFile: notePath
    });

    if (!noteFile) {
      return;
    }

    if (isCanvasFile(noteFile) && !isCanvasPluginEnabled(this.app)) {
      return;
    }

    /* v8 ignore start -- removeLinkedPathEntries always deletes notePath from linksMap before this point. */
    if (!this.linksMap.has(notePath)) {
      /* v8 ignore stop */
      this.linksMap.set(notePath, new Set<string>());
    }

    // The cache Obsidian ALREADY holds, and deliberately not `getCacheSafe`: that saves any dirty open view
    // of the note first, and every caller here runs on an automatic trigger — a `modify`, a `changed`, a
    // backlinks-pane recompute — so it forced a second save of whatever the user or another plugin had
    // just put into the editor. A `modify` read can see the pre-edit cache; the `changed` Obsidian fires
    // once it has re-parsed the note queues a second refresh, which sees the new one. `getFileCache`
    // goes through `getCache`, so a canvas still reaches the canvas patch.
    const cache = this.app.metadataCache.getFileCache(noteFile);

    if (!cache) {
      return;
    }

    for (const link of getReferences({ cache })) {
      if (this.abortSignalComponent.abortSignal.aborted) {
        return;
      }

      const linkPathKey = getLinkPathKey(link.link);
      let sourceReferences = this.linkPathReferencesMap.get(linkPathKey)?.get(notePath);
      if (!sourceReferences) {
        sourceReferences = new Set<Reference>();
        let sourceReferencesMap = this.linkPathReferencesMap.get(linkPathKey);
        if (!sourceReferencesMap) {
          sourceReferencesMap = new Map<string, Set<Reference>>();
          this.linkPathReferencesMap.set(linkPathKey, sourceReferencesMap);
        }
        sourceReferencesMap.set(notePath, sourceReferences);
      }
      sourceReferences.add(link);
      addToMapSet({ key: notePath, map: this.sourceLinkPathKeysMap, value: linkPathKey });

      const resolvedLinkFile = extractReferenceFile({
        app: this.app,
        reference: link,
        sourcePathOrFile: notePath
      });
      if (resolvedLinkFile) {
        this.addBacklink({ link, sourcePath: notePath, targetPath: resolvedLinkFile.path });

        // A SELF-link is deliberately not indexed here. `resolvedBasenameMap` answers "when a file with
        // this basename changes, which notes must be re-resolved?", and the answer never usefully
        // includes the changed note itself: whatever resolved it already resolved it. Indexing it would
        // make `updateRelatedLinks` queue the note for re-resolution in response to its own change,
        // which fires `changed`, which refreshes its backlinks, which queues it again — a feedback
        // cycle that stalls the editor for as long as it runs (issue #17). The self-backlink itself is
        // still recorded above, so the backlink panel is unaffected.
        if (resolvedLinkFile.path !== notePath) {
          addToMapSet({ key: getBasenameLower(resolvedLinkFile.path), map: this.resolvedBasenameMap, value: notePath });
        }
        continue;
      }

      const nonExistingLinkFile = extractReferenceFile({
        app: this.app,
        reference: link,
        shouldAllowNonExistingFile: true,
        sourcePathOrFile: notePath
      });
      if (nonExistingLinkFile) {
        this.addBacklink({ link, sourcePath: notePath, targetPath: nonExistingLinkFile.path });
      }

      const { linkPath } = splitSubpath(link.link);
      const unresolvedBasename = getBasenameLower(linkPath);
      addToMapSet({ key: unresolvedBasename, map: this.unresolvedBasenameMap, value: notePath });
      addToMapSet({ key: notePath, map: this.unresolvedLinksMap, value: unresolvedBasename });
    }
  }

  private removeBacklinks(path: string): void {
    this.consoleDebugComponent.consoleDebug(`Removing backlinks for ${path}`);
    this.removePathEntries(path);
  }

  private removeLinkedPathEntries(path: string): void {
    const linkedNotePaths = this.linksMap.get(path) ?? [];

    for (const linkedNotePath of linkedNotePaths) {
      if (this.abortSignalComponent.abortSignal.aborted) {
        return;
      }
      this.backlinksMap.get(linkedNotePath)?.delete(path);
      this.resolvedBasenameMap.get(getBasenameLower(linkedNotePath))?.delete(path);
    }

    this.linksMap.delete(path);

    const unresolvedBasenames = this.unresolvedLinksMap.get(path) ?? [];

    for (const unresolvedBasename of unresolvedBasenames) {
      if (this.abortSignalComponent.abortSignal.aborted) {
        return;
      }
      this.unresolvedBasenameMap.get(unresolvedBasename)?.delete(path);
    }

    this.unresolvedLinksMap.delete(path);

    for (const linkPathKey of this.sourceLinkPathKeysMap.get(path) ?? []) {
      const sourceReferencesMap = this.linkPathReferencesMap.get(linkPathKey);
      sourceReferencesMap?.delete(path);
      if (sourceReferencesMap?.size === 0) {
        this.linkPathReferencesMap.delete(linkPathKey);
      }
    }

    this.sourceLinkPathKeysMap.delete(path);
  }

  private removePathEntries(path: string): void {
    this.consoleDebugComponent.consoleDebug(`Removing ${path} entries`);
    this.backlinksMap.delete(path);
    this.removeLinkedPathEntries(path);
  }

  private setPendingAction(path: string, action: Action): void {
    this.pendingActions.set(path, action);
    this.debouncedProcessPendingActions?.();
  }
}

function addAllToSet(target: Set<string>, source: Set<string> | undefined): void {
  if (!source) {
    return;
  }

  for (const value of source) {
    target.add(value);
  }
}

function addToMapSet(params: AddToMapSetParams): void {
  const { key, map, value } = params;
  let set = map.get(key);

  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }

  set.add(value);
}

function getBasenameLower(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  const basename = slashIndex === -1 ? path : path.slice(slashIndex + 1);
  return basename.toLowerCase();
}

/*
 * The key a link is indexed by: its link path without the subpath, as Obsidian records it in
 * `metadataCache.unresolvedLinks`, lower-cased and with a trailing `.md` dropped. `[[Foo]]`, `[[foo]]` and
 * `[[Foo.md]]` all name the one note a `Foo.md` created later would be, so they are one question.
 */
function getLinkPathKey(link: string): string {
  const loweredLinkPath = splitSubpath(link).linkPath.toLowerCase();
  return loweredLinkPath.endsWith(MARKDOWN_EXTENSION) ? loweredLinkPath.slice(0, -MARKDOWN_EXTENSION.length) : loweredLinkPath;
}
