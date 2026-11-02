import type {
  App as AppOriginal,
  CachedMetadata,
  Reference
} from 'obsidian';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  App,
  Events
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import {
  MetadataParsers,
  normalizeMetadataExtension
} from './metadata-parsers.ts';
import { NonMarkdownComponent } from './non-markdown-component.ts';

const ready = vi.hoisted(() =>
  vi.fn(async () => {
    await noopAsync();
  })
);
vi.mock('@mnaoumov/obsidian-lib/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/metadata-cache')>(),
  ensureMetadataCacheReady: ready
}));

interface PendingReader {
  readonly caches: ReadonlyMap<string, CachedMetadata>;
  readonly pending: Promise<void>;
}

interface SettingsStub extends Events {
  readonly settings: PluginSettings;
}

describe('NonMarkdownComponent', () => {
  let app: App;
  let component: NonMarkdownComponent;
  let settings: SettingsStub;
  let parsers: MetadataParsers;
  let native: Map<string, CachedMetadata>;

  beforeEach(() => {
    ready.mockReset().mockResolvedValue();
    app = App.createConfigured__();
    settings = Object.assign(new Events(), { settings: new PluginSettings() });
    settings.settings.markdownFileExtensions = ['.MDX'];
    native = new Map();
    vi.spyOn(app.metadataCache, 'getCache').mockImplementation((path) => path.startsWith('uncached') ? null : native.get(path) ?? {});
    vi.spyOn(app.metadataCache, 'getFileCache').mockImplementation((file) => app.metadataCache.getCache(file.path));
    Object.assign(app.metadataCache, {
      isUserIgnored: (path: string) => path.startsWith('ignored'),
      iterateAllRefs: (callback: (path: string, reference: Reference) => void) => {
        for (const [path, cache] of native) {
          for (const reference of cache.links ?? []) {
            callback(path, reference);
          }
        }
      },
      iterateFileCache: (callback: (path: string, cache: CachedMetadata) => void) => {
        for (const [path, cache] of native) {
          callback(path, cache);
        }
      },
      queueFileForLinkResolution: noop
    });
    parsers = new MetadataParsers();
    component = new NonMarkdownComponent({ app: castTo<AppOriginal>(app), metadataParsers: parsers, pluginSettingsComponent: castTo<PluginSettingsComponent>(settings) });
  });

  afterEach(async () => {
    component.unload();
    await settle();
    vi.restoreAllMocks();
  });

  it('parses only selected files and supplies core enumeration without persisting a hash', async () => {
    const alpha = app.vault.createSync__('alpha.mdx', '# Alpha\n[[bravo]] #tag');
    app.vault.createSync__('ignored.mdx', '[[charlie]]');
    app.vault.createSync__('bravo.txt', '[[delta]]');
    app.vault.createSync__('native.md', '[[echo]]');
    app.vault.createSync__('Plugin data/advanced-metadata-cache/journal.mdx', '[[foxtrot]]');
    const parse = vi.spyOn(app.metadataCache, 'computeMetadataAsync');
    const changed = vi.fn();
    app.metadataCache.on('changed', changed);
    await load();
    expect(parse).toHaveBeenCalledTimes(2);
    expect(app.metadataCache.getCache('alpha.mdx')?.headings?.[0]?.heading).toBe('Alpha');
    expect(changed).toHaveBeenCalledWith(alpha, '# Alpha\n[[bravo]] #tag', app.metadataCache.getCache('alpha.mdx'));
    expect(app.metadataCache.getCache('bravo.txt')).toEqual({});
    const paths: string[] = [];
    castTo<AppOriginal>(app).metadataCache.iterateFileCache((path) => {
      paths.push(path);
    });
    expect(paths).toEqual(['alpha.mdx']);
    const links: string[] = [];
    castTo<AppOriginal>(app).metadataCache.iterateAllRefs((path, reference) => {
      links.push(`${path}:${reference.link}`);
    });
    expect(links).toEqual(['alpha.mdx:bravo', 'ignored.mdx:charlie']);
    expect(app.metadataCache.fileCache['alpha.mdx']?.hash ?? '').toBe('');
  });

  it('preserves another metadata owner and avoids duplicate enumeration', async () => {
    app.vault.createSync__('alpha.mdx', '[[bravo]]');
    native.set('alpha.mdx', { frontmatter: { owner: 'native' } });
    await load();
    expect(app.metadataCache.getCache('alpha.mdx')).toBe(native.get('alpha.mdx'));
    const paths: string[] = [];
    castTo<AppOriginal>(app).metadataCache.iterateFileCache((path) => {
      paths.push(path);
    });
    expect(paths).toEqual(['alpha.mdx']);
    const links: Reference[] = [];
    castTo<AppOriginal>(app).metadataCache.iterateAllRefs((_path, reference) => {
      links.push(reference);
    });
    expect(links).toEqual([]);
  });

  it('follows creation, edits, deletion, rename and relevant settings only', async () => {
    await load();
    const file = app.vault.createSync__('alpha.mdx', '# First');
    app.vault.trigger('create', file);
    await settle();
    expect(app.metadataCache.getFileCache(file)?.headings?.[0]?.heading).toBe('First');
    await app.vault.modify(file, '# Second');
    await settle();
    expect(app.metadataCache.getFileCache(file)?.headings?.[0]?.heading).toBe('Second');
    const parse = vi.spyOn(app.metadataCache, 'computeMetadataAsync');
    settings.trigger('saveSettings');
    await settle();
    expect(parse).not.toHaveBeenCalled();
    await app.vault.rename(file, 'bravo.mdx');
    await settle();
    expect(app.metadataCache.getCache('alpha.mdx')).toEqual({});
    expect(app.metadataCache.getFileCache(file)?.headings?.[0]?.heading).toBe('Second');
    setExtensions([]);
    settings.trigger('saveSettings');
    await settle();
    expect(app.metadataCache.getFileCache(file)).toEqual({});
    const unregister = parsers.register('mdx');
    await settle();
    expect(app.metadataCache.getFileCache(file)?.headings?.[0]?.heading).toBe('Second');
    await app.fileManager.trashFile(file);
    await settle();
    unregister();
    await settle();
    expect(app.metadataCache.getCache(file.path)).toEqual({});
    app.vault.trigger('create', app.vault.getRoot());
    await settle();
  });

  it('uses custom parsers, removes declined or failed metadata and continues parsing', async () => {
    const file = app.vault.createSync__('alpha.story', 'custom');
    const unregister = parsers.register('story', () => ({ frontmatter: { status: 'provided' } }));
    await load();
    expect(app.metadataCache.getFileCache(file)?.frontmatter?.['status']).toBe('provided');
    parsers.register('story', () => null);
    await settle();
    expect(app.metadataCache.getFileCache(file)).toEqual({});
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    parsers.register('story', () => {
      throw new Error('parser failed');
    });
    await settle();
    expect(error).toHaveBeenCalledWith('Non-Markdown metadata parsing failed', file.path, expect.any(Error));
    unregister();
    await settle();
  });

  it.each(['edit', 'rename', 'delete', 'settings', 'unload', 'stat', 'size'])('discards an outstanding result after %s', async (change) => {
    const file = app.vault.createSync__('alpha.mdx', '# Old');
    let staleAnnouncements = 0;
    castTo<AppOriginal>(app).metadataCache.on('changed', (_file, _content, cache) => {
      if (cache.frontmatter?.['stale'] === true) {
        staleAnnouncements++;
      }
    });
    let release: () => void = noop;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    parsers.register('mdx', async () => {
      await gate;
      return { frontmatter: { stale: true } };
    });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    switch (change) {
      case 'delete': {
        await app.fileManager.trashFile(file);
        break;
      }
      case 'edit': {
        await app.vault.modify(file, '# New');
        break;
      }
      case 'rename': {
        await app.vault.rename(file, 'alpha.txt');
        break;
      }
      case 'settings': {
        settings.settings.markdownFileExtensions = [];
        settings.trigger('saveSettings');
        break;
      }
      case 'size': {
        file.stat.size++;
        break;
      }
      case 'stat': {
        file.stat.mtime++;
        break;
      }
      case 'unload': {
        component.unload();
        app.vault.trigger('modify', file);
        break;
      }
      default: {
        throw new Error(`Unknown change: ${change}`);
      }
    }
    if (change === 'settings' || change === 'edit') {
      parsers.register('mdx', () => null);
    }
    release();
    await settle();
    expect(app.metadataCache.getCache(file.path)).toEqual({});
    expect(staleAnnouncements).toBe(0);
    expect(app.metadataCache.getCache('alpha.mdx')).toEqual({});
    expect(castTo<PendingReader>(component).caches.has('alpha.mdx')).toBe(false);
  });

  it('does not start the initial scan after unloading while core is loading', async () => {
    let release: () => void = noop;
    ready.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const file = app.vault.createSync__('alpha.mdx', '# Alpha');
    const parse = vi.spyOn(app.metadataCache, 'computeMetadataAsync');
    const walk = vi.spyOn(app.vault, 'getFiles');
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    app.vault.trigger('modify', file);
    parsers.register('story');
    await setTimeoutAsync(0);
    component.unload();
    release();
    await settle();
    expect(parse).not.toHaveBeenCalled();
    expect(walk).not.toHaveBeenCalled();
  });

  it('announces empty metadata when core has no entry and skips a file already gone at cleanup', async () => {
    const file = app.vault.createSync__('uncached.mdx', '# Alpha');
    await load();
    expect(app.metadataCache.getFileCache(file)?.headings?.[0]?.heading).toBe('Alpha');
    const remove = parsers.register('mdx', () => null);
    await settle();
    expect(app.metadataCache.getFileCache(file)).toBeNull();
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    const removeFailure = parsers.register('mdx', () => {
      throw new Error('failure');
    });
    await settle();
    expect(error).toHaveBeenCalled();
    removeFailure();
    remove();
    await settle();
    vi.spyOn(app.vault, 'getFileByPath').mockReturnValue(null);
    component.unload();
    expect(app.metadataCache.getFileCache(file)).toBeNull();
  });

  it('does not resurrect metadata when a parser rejects after unload', async () => {
    const file = app.vault.createSync__('alpha.mdx', 'text');
    const changed = vi.fn();
    app.metadataCache.on('changed', changed);
    let rejectParse: (error: Error) => void = noop;
    parsers.register('mdx', async () =>
      await new Promise<CachedMetadata>((_resolve, reject) => {
        rejectParse = reject;
      }));
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    component.unload();
    rejectParse(new Error('late failure'));
    await settle();
    expect(app.metadataCache.getFileCache(file)).toEqual({});
    expect(changed).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await settle();
  }

  async function settle(): Promise<void> {
    await setTimeoutAsync(0);
    await castTo<PendingReader>(component).pending;
  }

  function setExtensions(extensions: string[]): void {
    settings.settings.markdownFileExtensions = extensions;
  }
});

describe('MetadataParsers', () => {
  it('normalizes extensions, protects native formats and rejects patterns and paths', () => {
    expect(normalizeMetadataExtension(' .MDX ')).toBe('mdx');
    for (const extension of ['', '.md', 'CANVAS', 'base', '*.txt', 'a/b', '..txt']) {
      expect(normalizeMetadataExtension(extension)).toBeNull();
      expect(() => new MetadataParsers().register(extension)).toThrow('non-native');
    }
  });

  it('restores the previous registration and unregisters only once per caller', () => {
    const parsers = new MetadataParsers();
    const listener = vi.fn();
    const unsubscribe = parsers.onChange(listener);
    const removeFirst = parsers.register('.MDX');
    function parser(): CachedMetadata {
      return { frontmatter: { provider: 'second' } };
    }
    const removeSecond = parsers.register('mdx', parser);
    expect(parsers.getRegistration('MDX')?.parser).toBe(parser);
    removeSecond();
    removeSecond();
    expect(parsers.getRegistration('mdx')?.parser).toBeNull();
    removeFirst();
    expect(parsers.getRegistration('mdx')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    parsers.register('txt');
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
