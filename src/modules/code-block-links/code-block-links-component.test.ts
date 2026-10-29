import type {
  App as AppOriginal,
  CachedMetadata
} from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import {
  App,
  Events
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import { CodeBlockLanguages } from './code-block-languages.ts';

const hoisted = vi.hoisted(() => ({
  ensureMetadataCacheReady: vi.fn<() => Promise<void>>(async () => {
    // Ready at once unless a test says otherwise.
  })
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/metadata-cache')>(),
  ensureMetadataCacheReady: hoisted.ensureMetadataCacheReady
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import { CodeBlockLinksComponent } from './code-block-links-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

/**
 * The mock's private resolver, which stands in for Obsidian's link resolution queue.
 */
interface LinkUpdatingMetadataCache {
  readonly updateLinks: (sourcePath: string, cache: CachedMetadata | null) => void;
}

/**
 * The handles of {@link gateParses}.
 */
interface ParseGate {
  readonly release: () => void;
  readonly releaseAfter: (beforeRelease: () => Promise<void>) => Promise<void>;
}

/**
 * The part of the settings component the module reads: its settings, and the event a settings change fires.
 */
interface SettingsComponentStub extends Events {
  readonly settings: PluginSettings;
}

const NOTE = '# Note\n\n```ad-note\nSee [[Alpha]] and ![[Image.png]].\n```\n\n[[Bravo]]\n';

describe('CodeBlockLinksComponent', () => {
  let app: App;
  let changedPaths: string[];
  let codeBlockLanguages: CodeBlockLanguages;
  let component: CodeBlockLinksComponent;
  let originalComputeMetadataAsync: (arrayBuffer: ArrayBuffer) => Promise<CachedMetadata>;
  let pluginSettingsComponent: SettingsComponentStub;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    // Captured before any test wraps it, so a second gate never wraps the first.
    originalComputeMetadataAsync = app.metadataCache.computeMetadataAsync.bind(app.metadataCache);
    // The mocks have neither; these are what Obsidian's own do, as far as the module reads them.
    Object.assign(app.metadataCache, {
      getFileInfo: (path: string) => app.metadataCache.fileCache[path],
      queueFileForLinkResolution: (file: TFile) => {
        castTo<LinkUpdatingMetadataCache>(app.metadataCache).updateLinks(file.path, app.metadataCache.getFileCache(file));
      }
    });
    // Obsidian moves a renamed file's entry to the new path, keeping the same object; the mock does not.
    castTo<AppOriginal>(app).vault.on('rename', (renamedFile, oldPath) => {
      const cache = app.metadataCache.cache__.get(oldPath);
      if (!cache) {
        return;
      }

      app.metadataCache.cache__.set(renamedFile.path, cache);
      app.metadataCache.cache__.delete(oldPath);
    });
    changedPaths = [];
    castTo<AppOriginal>(app).metadataCache.on('changed', (file) => {
      changedPaths.push(file.path);
    });
    codeBlockLanguages = new CodeBlockLanguages();
    pluginSettingsComponent = Object.assign(new Events(), { settings: new PluginSettings() });
    component = new CodeBlockLinksComponent({
      app: castTo<AppOriginal>(app),
      codeBlockLanguages,
      pluginSettingsComponent: castTo<PluginSettingsComponent>(pluginSettingsComponent)
    });
    createNote('Alpha.md', '');
    createNote('Bravo.md', '');
    createNote('Image.png', '');
  });

  it('should add the links of a listed block to the cache entry, at their place, and resolve them', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-*'];
    const file = createNote('Note.md', NOTE);

    await load();
    await component.waitForBuild();

    expect(getLinks(file)).toEqual([['Alpha', NOTE.indexOf('[[Alpha]]')], ['Bravo', NOTE.indexOf('[[Bravo]]')]]);
    expect(getCache(file).embeds?.map((embed) => embed.link)).toEqual(['Image.png']);
    expect(app.metadataCache.resolvedLinks['Note.md']).toEqual({ 'Alpha.md': 1, 'Bravo.md': 1, 'Image.png': 1 });
    expect(component.getCodeBlockReferences('Note.md').map(({ isEmbed, language, reference }) => [reference.link, isEmbed, language])).toEqual([
      ['Alpha', false, 'ad-note'],
      ['Image.png', true, 'ad-note']
    ]);
    expect(component.isBuilt).toBe(true);
    // Announced again with the same entry, for the indexes that read the cache on `changed`.
    expect(changedPaths.filter((path) => path === 'Note.md').length).toBeGreaterThanOrEqual(2);
  });

  it('should answer nothing for a missing path, a file with no entry and a note with nothing added', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    createNote('Plain.md', '[[Alpha]]');
    await load();

    expect(component.getCodeBlockReferences('Missing.md')).toEqual([]);
    expect(component.getCodeBlockReferences('Image.png')).toEqual([]);
    expect(component.getCodeBlockReferences('Plain.md')).toEqual([]);
  });

  it('should leave a note alone, and read nothing, while no language is listed', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = [' '];
    const file = createNote('Note.md', NOTE);
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');
    await load();

    await app.vault.modify(file, `${NOTE}\n`);
    await settle();

    expect(getLinks(file)).toEqual([['Bravo', NOTE.indexOf('[[Bravo]]')]]);
    expect(cachedRead).not.toHaveBeenCalled();
    expect(component.isBuilt).toBe(true);
  });

  it('should ignore a block of a language not listed, the plugin\'s own data, and a block with nothing in it', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['tabs', 'ad-note'];
    const other = createNote('Other.md', '```js\n[[Alpha]]\n```');
    const data = createNote('Plugin data/advanced-metadata-cache/journal.md', '```ad-note\n[[Alpha]]\n```');
    const empty = createNote('Empty.md', '```tabs\nno links\n```');
    await load();

    expect(getLinks(other)).toEqual([]);
    expect(getLinks(data)).toEqual([]);
    expect(getLinks(empty)).toEqual([]);

    // An entry already handled with nothing to add is announced again by somebody else: still nothing.
    app.metadataCache.trigger('changed', empty, '```tabs\nno links\n```', getCache(empty));
    await settle();
    expect(component.getCodeBlockReferences('Empty.md')).toEqual([]);
  });

  it('should follow a note as it changes', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const file = createNote('Note.md', NOTE);
    await load();

    const changed = '```ad-note\n[[Bravo]]\n```\n';
    await app.vault.modify(file, changed);
    await settle();

    expect(getLinks(file)).toEqual([['Bravo', changed.indexOf('[[Bravo]]')]]);
    expect(app.metadataCache.resolvedLinks['Note.md']).toEqual({ 'Bravo.md': 1 });
  });

  it('should put the arrays back as they were on unload, and when the list changes', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const file = createNote('Note.md', NOTE);
    // An embed outside and only an embed inside, and a link inside with nothing outside.
    const embedsOnly = createNote('EmbedsOnly.md', '![[Image.png]]\n\n```ad-note\n![[Image.png]]\n```');
    const linkOnly = createNote('LinkOnly.md', '```ad-note\n[[Alpha]]\n```');
    await load();

    expect(getCache(embedsOnly).embeds).toHaveLength(2);
    expect(getLinks(linkOnly).map(([link]) => link)).toEqual(['Alpha']);

    saveLanguages(['ad-note']);
    expect(getLinks(file).map(([link]) => link)).toEqual(['Alpha', 'Bravo']);

    saveLanguages([]);
    await settle();

    expect(getLinks(file)).toEqual([['Bravo', NOTE.indexOf('[[Bravo]]')]]);
    expect(getCache(file).embeds).toBeUndefined();
    expect(getCache(embedsOnly).embeds).toHaveLength(1);
    expect(getCache(embedsOnly).links).toBeUndefined();
    expect(getCache(linkOnly).links).toBeUndefined();
    expect(app.metadataCache.resolvedLinks['Note.md']).toEqual({ 'Bravo.md': 1 });

    saveLanguages(['ad-note']);
    await settle();
    expect(getLinks(file).map(([link]) => link)).toEqual(['Alpha', 'Bravo']);

    component.unload();
    await settle();
    expect(getLinks(file).map(([link]) => link)).toEqual(['Bravo']);
    expect(app.metadataCache.resolvedLinks['Note.md']).toEqual({ 'Bravo.md': 1 });
  });

  it('should follow the languages other plugins register and unregister', async () => {
    const file = createNote('Note.md', NOTE);
    await load();

    const unregister = codeBlockLanguages.register('ad-note');
    await settle();
    expect(getLinks(file).map(([link]) => link)).toEqual(['Alpha', 'Bravo']);

    unregister();
    await settle();
    expect(getLinks(file).map(([link]) => link)).toEqual(['Bravo']);
  });

  it('should keep its answer for a renamed note, and forget a deleted one', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const file = createNote('Note.md', NOTE);
    const plain = createNote('Plain.md', '');
    await load();

    await app.vault.rename(file, 'Renamed.md');
    await app.vault.rename(plain, 'Plain2.md');
    await settle();
    expect(component.getCodeBlockReferences('Renamed.md').map(({ reference }) => reference.link)).toEqual(['Alpha', 'Image.png']);

    await app.fileManager.trashFile(file);
    component.unload();
    await settle();
    expect(changedPaths).not.toContain('Renamed.md');
  });

  it('should fill an entry two notes share once, and list it under both', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const gate = gateParses();
    await load();

    const file = createNote('Note.md', NOTE);
    const twin = createNote('Twin.md', NOTE);
    await setTimeoutAsync(0);
    // Obsidian keys an entry by content hash, so notes with the same text share one object.
    app.metadataCache.setCache__('Twin.md', getCache(file));
    await setTimeoutAsync(0);
    gate.release();
    await settle();

    expect(getCache(twin)).toBe(getCache(file));
    expect(getLinks(twin).map(([link]) => link)).toEqual(['Alpha', 'Bravo']);
    expect(component.getCodeBlockReferences('Twin.md')).toHaveLength(2);
  });

  it('should drop a parse that lands after the note changed again, after the list changed, or after unload', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const file = createNote('Note.md', NOTE);
    await load();

    let gate = gateParses();
    await app.vault.modify(file, `${NOTE}x`);
    await setTimeoutAsync(0);
    const staleCache = getCache(file);
    await gate.releaseAfter(async () => {
      await app.vault.modify(file, `${NOTE}y`);
    });
    await settle();
    expect(getCache(file)).not.toBe(staleCache);
    expect(getLinks(file).map(([link]) => link)).toEqual(['Alpha', 'Bravo']);

    gate = gateParses();
    await app.vault.modify(file, `${NOTE}z`);
    await setTimeoutAsync(0);
    saveLanguages(['tabs']);
    gate.release();
    await settle();
    expect(getLinks(file).map(([link]) => link)).toEqual(['Bravo']);

    saveLanguages(['ad-note']);
    gate = gateParses();
    await setTimeoutAsync(0);
    component.unload();
    gate.release();
    await settle();
    expect(getLinks(file).map(([link]) => link)).toEqual(['Bravo']);
  });

  it('should skip at startup a note whose entry is behind its file, or changes while it is read', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const behind = createNote('Behind.md', NOTE);
    const changing = createNote('Changing.md', NOTE);
    app.metadataCache.fileCache['Behind.md'] = { hash: '', mtime: 0, size: 0 };
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    vi.spyOn(app.vault, 'cachedRead').mockImplementationOnce(async (file) => {
      // A new entry for the note, as a parse finishing meanwhile would leave.
      app.metadataCache.cache__.set(changing.path, { ...getCache(changing) });
      return cachedRead(file);
    });

    await load();

    expect(getLinks(behind).map(([link]) => link)).toEqual(['Bravo']);
    expect(getLinks(changing).map(([link]) => link)).toEqual(['Bravo']);
  });

  it('should stop the startup pass when unloaded or when the list changes', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const first = createNote('A.md', NOTE);
    const second = createNote('B.md', NOTE);
    const gate = gateParses();
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    component.unload();
    gate.release();
    await settle();

    expect(getLinks(first).map(([link]) => link)).toEqual(['Bravo']);
    expect(getLinks(second).map(([link]) => link)).toEqual(['Bravo']);
    expect(component.isBuilt).toBe(false);
  });

  it('should restart the startup pass when the list changes during it', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['tabs'];
    const first = createNote('A.md', NOTE);
    createNote('B.md', NOTE);
    const gate = gateParses();
    createNote('C.md', '```tabs\n[[Alpha]]\n```');
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    saveLanguages(['ad-note']);
    gate.release();
    await settle();

    expect(getLinks(first).map(([link]) => link)).toEqual(['Alpha', 'Bravo']);
  });

  it('should not be built when unloaded before the metadata cache is ready', async () => {
    let resolveReady: () => void = noop;
    hoisted.ensureMetadataCacheReady.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    component.unload();
    resolveReady();
    await settle();

    expect(component.isBuilt).toBe(false);
    await component.waitForBuild();
  });

  it('should treat a block the parser fails on as holding nothing', async () => {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = ['ad-note'];
    const file = createNote('Note.md', NOTE);
    vi.spyOn(app.metadataCache, 'computeMetadataAsync').mockResolvedValueOnce(castTo<CachedMetadata>(undefined));

    await load();

    expect(getLinks(file).map(([link]) => link)).toEqual(['Bravo']);
  });

  /**
   * Holds every worker parse until released, so a test can change things while one is in flight.
   *
   * @returns The release handles.
   */
  function gateParses(): ParseGate {
    let resolveGate: () => void = noop;
    const gatePromise = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    vi.spyOn(app.metadataCache, 'computeMetadataAsync').mockImplementation(async (arrayBuffer) => {
      await gatePromise;
      return originalComputeMetadataAsync(arrayBuffer);
    });
    return {
      release(): void {
        resolveGate();
      },
      async releaseAfter(beforeRelease): Promise<void> {
        await beforeRelease();
        resolveGate();
      }
    };
  }

  function createNote(path: string, content: string): TFile {
    return app.vault.createSync__(path, content);
  }

  function getCache(file: TFile): CachedMetadata {
    const cache = app.metadataCache.getFileCache(file);
    expect(cache).not.toBeNull();
    return castTo<CachedMetadata>(cache);
  }

  function getLinks(file: TFile): [string, number][] {
    return (getCache(file).links ?? []).map((link) => [link.link, link.position.start.offset]);
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await settle();
  }

  function saveLanguages(languages: string[]): void {
    pluginSettingsComponent.settings.codeBlockLinkLanguages = languages;
    pluginSettingsComponent.trigger('saveSettings');
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
      await setTimeoutAsync(0);
      await waitForAllAsyncOperations();
    }
  }
});

describe('CodeBlockLanguages', () => {
  it('should keep a language two plugins registered until both unregister it, and tell the listeners each time', () => {
    const codeBlockLanguages = new CodeBlockLanguages();
    const listener = vi.fn();
    const unsubscribe = codeBlockLanguages.onChange(listener);

    const unregisterFirst = codeBlockLanguages.register('tabs');
    const unregisterSecond = codeBlockLanguages.register('tabs');
    expect(codeBlockLanguages.getRegisteredLanguages()).toEqual(['tabs']);
    unregisterFirst();
    unregisterFirst();

    expect(codeBlockLanguages.isIncluded([], 'tabs')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);

    unregisterSecond();
    expect(codeBlockLanguages.isIncluded([], 'tabs')).toBe(false);
    expect(codeBlockLanguages.isIncluded(['tab*'], 'tabs')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    codeBlockLanguages.register('tabs');
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
