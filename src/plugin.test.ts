/* eslint-disable @typescript-eslint/no-extraneous-class -- Test mocks of the plugin's own sibling modules need constructor-only classes. */
import type { PluginApiDeclaration } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import type {
  App as AppOriginal,
  PluginManifest
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { Component } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { HeadingTimesIndex } from './modules/headings/heading-times-index.ts';
import type { ModuleDefinition } from './modules/modules-component.ts';
import type { TitleIndex } from './modules/titles/title-index.ts';

import { PLUGIN_API_VERSION } from './plugin-api-version.ts';
import { PLUGIN_API_CONTRACT } from './plugin-api.ts';
import { PluginSettings } from './plugin-settings.ts';

// --- Mocks for the plugin's OWN sibling modules (allowed: not @mnaoumov/obsidian-lib / obsidian-test-mocks) ---

const hoisted = vi.hoisted(() => ({
  backlinkCacheComponent: { isBacklinkCacheComponent: true },
  backlinksModuleComponentConstructor: vi.fn(),
  headingTimesComponentConstructor: vi.fn(),
  loadedModules: new Map<string>(),
  modulesComponentConstructor: vi.fn(),
  nameIndexComponentConstructor: vi.fn(),
  pluginSettingsComponentConstructor: vi.fn(),
  pluginSettingsTabConstructor: vi.fn(),
  titleIndexComponentConstructor: vi.fn()
}));

// `PluginDataHandler` and `PluginEventSourceImpl` are NOT stubbed: the base
// builds its own settings component out of them during `onload`, and that component really calls
// `pluginEventSource.on`, so a bare `vi.fn()` double makes the base throw before `onloadImpl` runs.
vi.mock('./plugin-settings-component.ts', () => ({
  // Extends the real obsidian-test-mocks Component so the real addChild lifecycle can load it.
  PluginSettingsComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.pluginSettingsComponentConstructor(params);
    }
  }
}));

vi.mock('./plugin-settings-tab.ts', () => ({
  PluginSettingsTab: class {
    public constructor(params: unknown) {
      hoisted.pluginSettingsTabConstructor(params);
    }
  }
}));

// The real component reads the settings component's own event surface, which the stub above does not
// carry; what this file is about is which modules the plugin declares, not how they are switched.
vi.mock('./modules/modules-component.ts', () => ({
  ModulesComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.modulesComponentConstructor(params);
    }

    public getModuleComponent(moduleId: string): unknown {
      return hoisted.loadedModules.get(moduleId) ?? null;
    }
  }
}));

vi.mock('./modules/backlinks/backlinks-module-component.ts', () => ({
  BacklinksModuleComponent: class extends Component {
    public readonly backlinkCacheComponent = hoisted.backlinkCacheComponent;

    public constructor(params: unknown) {
      super();
      hoisted.backlinksModuleComponentConstructor(params);
    }
  }
}));

vi.mock('./modules/names/name-index-component.ts', () => ({
  NameIndexComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.nameIndexComponentConstructor(params);
    }
  }
}));

vi.mock('./modules/titles/title-index-component.ts', () => ({
  TitleIndexComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.titleIndexComponentConstructor(params);
    }
  }
}));

vi.mock('./modules/headings/heading-times-component.ts', () => ({
  HeadingTimesComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.headingTimesComponentConstructor(params);
    }
  }
}));

// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { Plugin } from './plugin.ts';

interface ApiModuleGetters {
  readonly getBacklinkCacheComponent: () => unknown;
  readonly getCodeBlockLinksComponent: () => unknown;
  readonly getLinkTextIndexComponent: () => unknown;
  readonly getNameIndexComponent: () => unknown;
  readonly getPropertyValueIndexComponent: () => unknown;
  readonly getUnlinkedMentionsComponent: () => unknown;
}

interface HeadingTimesIndexHolder {
  readonly headingTimesIndex: HeadingTimesIndex;
}

interface HeadingTimesIndexPathReader {
  readonly getDataFilePath: () => string;
  readonly storage: LegacyPathStorage;
}
interface LegacyPathParams {
  readonly getLegacyPath: () => string;
}

interface LegacyPathStorage {
  readonly params: LegacyPathParams;
}

interface ModuleDefinitionsHolder {
  readonly moduleDefinitions: readonly ModuleDefinition[];
}

interface PluginApisReader {
  readonly getPluginApis: () => PluginApiDeclaration[];
}

interface PropertyValueIndexHolder {
  readonly propertyValueIndex: HeadingTimesIndexPathReader;
}

interface SettingTabsHolder {
  readonly settingTabs__: unknown[];
}

interface TitleIndexHolder {
  readonly titleIndex: TitleIndex;
}

function createApp(): AppOriginal {
  const appMock = App.createConfigured__();
  appMock.workspace.onLayoutReady = vi.fn((callback: () => void) => {
    callback();
  });
  return appMock.asOriginalType__();
}

async function createLoadedPlugin(app: AppOriginal, manifest = createManifest()): Promise<Plugin> {
  const plugin = new Plugin(app, manifest);
  await plugin.onload();
  return plugin;
}

function createManifest(extra: Partial<PluginManifest> = {}): PluginManifest {
  return strictProxy<PluginManifest>({
    ...extra,
    id: 'advanced-metadata-cache',
    name: 'Advanced Metadata Cache',
    version: '1.0.0'
  });
}

function getModuleDefinitions(): readonly ModuleDefinition[] {
  return castTo<ModuleDefinitionsHolder>(hoisted.modulesComponentConstructor.mock.calls[0]?.[0]).moduleDefinitions;
}

afterEach(() => {
  vi.clearAllMocks();
  hoisted.loadedModules.clear();
});

describe('Plugin', () => {
  it('should create a plugin instance', async () => {
    const plugin = await createLoadedPlugin(createApp());
    expect(plugin).toBeInstanceOf(Plugin);
  });

  it('should wire up all components in onloadImpl', async () => {
    await createLoadedPlugin(createApp());
    expect(hoisted.pluginSettingsComponentConstructor).toHaveBeenCalledOnce();
    expect(hoisted.pluginSettingsTabConstructor).toHaveBeenCalledOnce();
    expect(hoisted.modulesComponentConstructor).toHaveBeenCalledOnce();
  });

  it('should add the plugin settings tab via its child component', async () => {
    const plugin = await createLoadedPlugin(createApp());
    expect(castTo<SettingTabsHolder>(plugin).settingTabs__).toHaveLength(1);
  });

  it('should declare every module', async () => {
    await createLoadedPlugin(createApp());
    expect(getModuleDefinitions().map((moduleDefinition) => moduleDefinition.moduleId)).toStrictEqual(['backlinks', 'names', 'titles', 'headings', 'properties', 'unlinked-mentions', 'link-texts', 'code-block-links']);
  });

  it('should gate the backlinks module on its own setting', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[0];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
    settings.isBacklinksModuleEnabled = false;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
  });

  it('should build the backlinks module on demand', async () => {
    await createLoadedPlugin(createApp());
    getModuleDefinitions()[0]?.createComponent();
    expect(hoisted.backlinksModuleComponentConstructor).toHaveBeenCalledOnce();
  });

  it('should gate the names module on its own setting, and leave it off by default', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[1];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
    settings.isNamesModuleEnabled = true;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
  });

  it('should build the names module on demand, handing it the app', async () => {
    const app = createApp();
    await createLoadedPlugin(app);
    getModuleDefinitions()[1]?.createComponent();
    expect(hoisted.nameIndexComponentConstructor).toHaveBeenCalledWith(expect.objectContaining({ app }));
  });

  it('should gate the titles module on its own setting, and leave it off by default', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[2];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
    settings.isTitlesModuleEnabled = true;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
  });

  it('should build the titles module on demand, handing it the app', async () => {
    const app = createApp();
    await createLoadedPlugin(app);
    getModuleDefinitions()[2]?.createComponent();
    expect(hoisted.titleIndexComponentConstructor).toHaveBeenCalledWith(expect.objectContaining({ app }));
  });

  it('should hand the names and titles modules the SAME title index, which is why either may be off', async () => {
    const app = createApp();
    await createLoadedPlugin(app);
    getModuleDefinitions()[1]?.createComponent();
    getModuleDefinitions()[2]?.createComponent();

    const namesParams = castTo<TitleIndexHolder>(hoisted.nameIndexComponentConstructor.mock.calls[0]?.[0]);
    const titlesParams = castTo<TitleIndexHolder>(hoisted.titleIndexComponentConstructor.mock.calls[0]?.[0]);

    expect(namesParams.titleIndex).toBe(titlesParams.titleIndex);
  });

  it('should gate the headings module on its own setting, and leave it off by default', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[3];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
    settings.isHeadingsModuleEnabled = true;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
  });

  it('should build the headings module on demand, keeping its index in the plugin folder', async () => {
    const app = createApp();
    await createLoadedPlugin(
      app,
      createManifest({
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own `PluginManifest` member.
        dir: 'plugins-root/custom-folder'
      })
    );
    getModuleDefinitions()[3]?.createComponent();

    const params = castTo<HeadingTimesIndexHolder>(hoisted.headingTimesComponentConstructor.mock.calls[0]?.[0]);
    expect(castTo<HeadingTimesIndexPathReader>(params.headingTimesIndex).getDataFilePath()).toBe('plugins-root/custom-folder/heading-times.json');
    expect(castTo<HeadingTimesIndexPathReader>(params.headingTimesIndex).storage.params.getLegacyPath()).toBe('plugins-root/custom-folder/heading-times.json');
  });

  it('should fall back to the folder named by the plugin id when the manifest names none', async () => {
    const app = createApp();
    await createLoadedPlugin(
      app,
      createManifest(castTo<Partial<PluginManifest>>({
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own `PluginManifest` member.
        dir: undefined
      }))
    );
    getModuleDefinitions()[3]?.createComponent();

    const params = castTo<HeadingTimesIndexHolder>(hoisted.headingTimesComponentConstructor.mock.calls[0]?.[0]);
    expect(castTo<HeadingTimesIndexPathReader>(params.headingTimesIndex).getDataFilePath()).toBe(`${app.vault.configDir}/plugins/advanced-metadata-cache/heading-times.json`);
  });

  it('should gate the properties module on its own setting, and leave it on by default', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[4];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
    settings.isPropertiesModuleEnabled = false;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
  });

  it('should gate the unlinked mentions module on its own setting, and leave it off by default', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[5];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
    settings.isUnlinkedMentionsModuleEnabled = true;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
  });

  it('should gate the link texts module on its own setting, and leave it on by default', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[6];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
    settings.isLinkTextsModuleEnabled = false;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
  });

  it('should gate the code block links module on its own setting, and leave it on by default', async () => {
    await createLoadedPlugin(createApp());
    const settings = new PluginSettings();
    const moduleDefinition = getModuleDefinitions()[7];

    expect(moduleDefinition?.getIsEnabled(settings)).toBe(true);
    settings.isCodeBlockLinksModuleEnabled = false;
    expect(moduleDefinition?.getIsEnabled(settings)).toBe(false);
  });

  it('should build the properties module on demand, keeping its index in the plugin folder', async () => {
    await createLoadedPlugin(
      createApp(),
      createManifest({
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own `PluginManifest` member.
        dir: 'plugins-root/custom-folder'
      })
    );
    const component = getModuleDefinitions()[4]?.createComponent();

    expect(castTo<PropertyValueIndexHolder>(component).propertyValueIndex.storage.params.getLegacyPath()).toBe('plugins-root/custom-folder/property-values.json');
    expect(castTo<PropertyValueIndexHolder>(component).propertyValueIndex.getDataFilePath()).toBe(
      'plugins-root/custom-folder/property-values.json'
    );
  });

  it('should build the unlinked mentions module on demand, keeping its index in the plugin folder', async () => {
    await createLoadedPlugin(
      createApp(),
      createManifest({
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own `PluginManifest` member.
        dir: 'plugins-root/custom-folder'
      })
    );
    const component = getModuleDefinitions()[5]?.createComponent();

    expect(castTo<HeadingTimesIndexPathReader>(component).getDataFilePath()).toBe('plugins-root/custom-folder/unlinked-mentions.json');
    expect(castTo<HeadingTimesIndexPathReader>(component).storage.params.getLegacyPath()).toBe('plugins-root/custom-folder/unlinked-mentions.json');
  });

  it('should publish its API under the contract it declares, and only once loaded', async () => {
    const plugin = new Plugin(createApp(), createManifest());

    expect(castTo<PluginApisReader>(plugin).getPluginApis()).toEqual([]);

    await plugin.onload();
    const pluginApis = castTo<PluginApisReader>(plugin).getPluginApis();

    expect(pluginApis).toHaveLength(1);
    expect(pluginApis[0]?.apiVersion).toBe(PLUGIN_API_VERSION);
    expect(pluginApis[0]?.contract).toBe(PLUGIN_API_CONTRACT);

    for (const methodName of Object.keys(PLUGIN_API_CONTRACT)) {
      expect(pluginApis[0]?.api).toHaveProperty(methodName, expect.any(Function));
    }
  });

  it('should hand the API the components of the modules running now, and null while they are off', async () => {
    const plugin = await createLoadedPlugin(createApp());
    const moduleGetters = castTo<ApiModuleGetters>(castTo<PluginApisReader>(plugin).getPluginApis()[0]?.api);

    expect(moduleGetters.getBacklinkCacheComponent()).toBeNull();
    expect(moduleGetters.getCodeBlockLinksComponent()).toBeNull();
    expect(moduleGetters.getLinkTextIndexComponent()).toBeNull();
    expect(moduleGetters.getNameIndexComponent()).toBeNull();
    expect(moduleGetters.getPropertyValueIndexComponent()).toBeNull();
    expect(moduleGetters.getUnlinkedMentionsComponent()).toBeNull();

    hoisted.loadedModules.set('backlinks', getModuleDefinitions()[0]?.createComponent());
    const nameIndexComponent = getModuleDefinitions()[1]?.createComponent();
    hoisted.loadedModules.set('names', nameIndexComponent);
    const propertyValueIndexComponent = getModuleDefinitions()[4]?.createComponent();
    hoisted.loadedModules.set('properties', propertyValueIndexComponent);
    const unlinkedMentionsComponent = getModuleDefinitions()[5]?.createComponent();
    hoisted.loadedModules.set('unlinked-mentions', unlinkedMentionsComponent);
    const linkTextIndexComponent = getModuleDefinitions()[6]?.createComponent();
    hoisted.loadedModules.set('link-texts', linkTextIndexComponent);
    const codeBlockLinksComponent = getModuleDefinitions()[7]?.createComponent();
    hoisted.loadedModules.set('code-block-links', codeBlockLinksComponent);

    expect(moduleGetters.getBacklinkCacheComponent()).toBe(hoisted.backlinkCacheComponent);
    expect(moduleGetters.getNameIndexComponent()).toBe(nameIndexComponent);
    expect(moduleGetters.getPropertyValueIndexComponent()).toBe(propertyValueIndexComponent);
    expect(moduleGetters.getUnlinkedMentionsComponent()).toBe(unlinkedMentionsComponent);
    expect(moduleGetters.getLinkTextIndexComponent()).toBe(linkTextIndexComponent);
    expect(moduleGetters.getCodeBlockLinksComponent()).toBe(codeBlockLinksComponent);
  });

  it('should register the open demo vault command via its command handler', async () => {
    const plugin = new Plugin(createApp(), createManifest());
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');
    await plugin.onload();
    expect(addCommandSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'open-demo-vault' }));
  });
});
/* eslint-enable @typescript-eslint/no-extraneous-class -- End of test file. */
