import type {
  FileSuggestModalSuggestion,
  QuickSwitcherModal
} from '@obsidian-typings/obsidian-public-latest';
import type { App as AppOriginal } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
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
import { QuickSwitcherGetSuggestionsPatchComponent } from './quick-switcher-get-suggestions-patch-component.ts';
import { TitleIndex } from './title-index.ts';

interface EmbedRegistryHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The test assigns the mock member.
  embedRegistry: unknown;
}

interface InternalPluginsHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The test assigns the mock member.
  internalPlugins: unknown;
}

interface IsUserIgnoredHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The test assigns the mock member.
  isUserIgnored: unknown;
}

interface Summary {
  readonly alias?: string;
  readonly downranked?: boolean;
  readonly path: string | undefined;
  readonly type: string;
}

interface ViewRegistryHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The test assigns the mock member.
  viewRegistry: unknown;
}

/**
 * A stand-in for Obsidian's `QuickSwitcherModal`: its own `getSuggestions` answers what the test hands it, which is
 * what Obsidian's would have found by path and alias.
 */
class FakeQuickSwitcherModal {
  public context: 'embed' | 'view' = 'view';
  public coreSuggestions: FileSuggestModalSuggestion[] = [];
  public shouldShowAlias = true;
  public shouldShowAllTypes = false;
  public shouldShowImages = true;
  public shouldShowMarkdown = true;
  public shouldShowNonAttachments = true;
  public shouldShowNonImageAttachments = true;

  public getSuggestions(_query: string): FileSuggestModalSuggestion[] {
    return [...this.coreSuggestions];
  }
}

describe('QuickSwitcherGetSuggestionsPatchComponent', () => {
  let app: App;
  let component: QuickSwitcherGetSuggestionsPatchComponent;
  let ignoredPaths: Set<string>;
  let modal: FakeQuickSwitcherModal;
  let registeredExtensions: Set<string>;
  let settings: PluginSettings;
  let titleIndex: TitleIndex;

  beforeEach(() => {
    app = App.createConfigured__();
    ignoredPaths = new Set();
    registeredExtensions = new Set();
    castTo<InternalPluginsHolder>(app).internalPlugins = {
      getPluginById: (id: string): unknown => id === 'switcher' ? { instance: { QuickSwitcherModal: FakeQuickSwitcherModal } } : null
    };
    castTo<ViewRegistryHolder>(app).viewRegistry = {
      isExtensionRegistered: (extension: string): boolean => registeredExtensions.has(extension)
    };
    castTo<IsUserIgnoredHolder>(app.metadataCache).isUserIgnored = (path: string): boolean => ignoredPaths.has(path);

    settings = new PluginSettings();
    settings.isTitlesModuleEnabled = true;
    settings.titlePropertyNames = ['title'];

    titleIndex = new TitleIndex({
      app: castTo<AppOriginal>(app),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });

    component = new QuickSwitcherGetSuggestionsPatchComponent({ app: castTo<AppOriginal>(app), titleIndex });
    modal = new FakeQuickSwitcherModal();
  });

  afterEach(() => {
    // The patch sits on the shared prototype, so a test that leaves it in would answer for the next one.
    component.unload();
  });

  it('should offer a note by a title that is not an alias, as an alias suggestion', () => {
    app.vault.createSync__('alpha.md', '---\ntitle: Zulu Distinct Title\n---\n');
    component.load();

    expect(summarize('Zulu Distinct')).toEqual([{ alias: 'Zulu Distinct Title', downranked: false, path: 'alpha.md', type: 'alias' }]);
  });

  it('should leave the empty query to Obsidian, which lists the recent files', () => {
    app.vault.createSync__('alpha.md', '---\ntitle: Zulu\n---\n');
    component.load();

    expect(summarize(' '.repeat(3))).toEqual([]);
  });

  it('should offer no title the query does not match', () => {
    app.vault.createSync__('alpha.md', '---\ntitle: Zulu\n---\n');
    component.load();

    expect(summarize('Yankee')).toEqual([]);
  });

  it('should offer nothing while the modal does not match aliases', () => {
    app.vault.createSync__('alpha.md', '---\ntitle: Zulu\n---\n');
    component.load();
    modal.shouldShowAlias = false;

    expect(summarize('Zulu')).toEqual([]);
  });

  it('should not repeat a title that is already the basename or an alias', () => {
    app.vault.createSync__('Zulu.md', '---\ntitle: zulu\n---\n');
    app.vault.createSync__('beta.md', '---\ntitle: Zulu Beta\naliases: [zulu beta]\n---\n');
    component.load();

    expect(summarize('Zulu')).toEqual([]);
  });

  it('should downrank a title of an excluded file, as Obsidian downranks its alias', () => {
    app.vault.createSync__('alpha.md', '---\ntitle: Zulu\n---\n');
    ignoredPaths.add('alpha.md');
    component.load();

    const [suggestion] = modal.getSuggestions('Zulu');
    expect(suggestion).toMatchObject({ downranked: true, type: 'alias' });
    expect(suggestion?.match?.score).toBeLessThan(-9);
  });

  it('should sort the titles into what Obsidian found, by score', () => {
    const alpha = app.vault.createSync__('alpha.md', '---\ntitle: Zulu\n---\n');
    component.load();
    modal.coreSuggestions = [{
      file: castTo(alpha),
      match: { matches: [], score: -100 },
      type: 'file'
    }];

    expect(summarize('Zulu').map((suggestion) => suggestion.type)).toEqual(['alias', 'file']);
  });

  it('should follow the modal\'s file-type filters', () => {
    app.vault.createSync__('note.md', '---\ntitle: Zulu Note\n---\n');
    app.vault.createSync__('board.canvas', '{}');
    app.vault.createSync__('photo.png', '');
    app.vault.createSync__('doc.pdf', '');
    component.load();
    modal.shouldShowMarkdown = false;

    expect(summarize('Zulu')).toEqual([]);
  });

  it('should take the titles away when the component unloads', () => {
    app.vault.createSync__('alpha.md', '---\ntitle: Zulu\n---\n');
    component.load();
    component.unload();

    expect(summarize('Zulu')).toEqual([]);
  });

  it('should install nothing when the core Quick switcher is missing', () => {
    castTo<InternalPluginsHolder>(app).internalPlugins = { getPluginById: (): null => null };
    app.vault.createSync__('alpha.md', '---\ntitle: Zulu\n---\n');
    component.load();

    expect(summarize('Zulu')).toEqual([]);
  });

  it('should offer a file of each type exactly when the modal offers that type', () => {
    for (const path of ['note.md', 'board.canvas', 'table.base', 'photo.png', 'doc.pdf', 'data.xyz']) {
      app.vault.createSync__(path, '');
    }
    vi.spyOn(titleIndex, 'getTitles').mockImplementation((file) => [`Zulu ${file.extension}`]);
    registeredExtensions.add('pdf');
    component.load();

    expect(offeredPaths()).toEqual(['board.canvas', 'doc.pdf', 'note.md', 'photo.png', 'table.base']);

    modal.shouldShowNonAttachments = false;
    modal.shouldShowImages = false;
    expect(offeredPaths()).toEqual(['doc.pdf', 'note.md']);

    modal.shouldShowNonImageAttachments = false;
    expect(offeredPaths()).toEqual(['note.md']);

    modal.shouldShowAllTypes = true;
    expect(offeredPaths()).toEqual(['data.xyz', 'doc.pdf', 'note.md']);

    modal.shouldShowAllTypes = false;
    modal.shouldShowNonImageAttachments = true;
    modal.context = 'embed';
    castTo<EmbedRegistryHolder>(app).embedRegistry = { isExtensionRegistered: (): boolean => false };
    expect(offeredPaths()).toEqual(['note.md']);
  });

  function offeredPaths(): (string | undefined)[] {
    return summarize('Zulu').map((suggestion) => suggestion.path).sort();
  }

  function summarize(query: string): Summary[] {
    return castTo<QuickSwitcherModal>(modal).getSuggestions(query).map((suggestion) => ({
      ...(suggestion.type === 'alias' && { alias: suggestion.alias, downranked: suggestion.downranked }),
      path: suggestion.type === 'file' || suggestion.type === 'alias' ? suggestion.file.path : undefined,
      type: suggestion.type
    }));
  }
});
