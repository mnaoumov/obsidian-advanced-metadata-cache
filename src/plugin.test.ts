/* eslint-disable @typescript-eslint/no-extraneous-class -- Test mocks of the plugin's own sibling modules need constructor-only classes. */
import type {
  App as AppOriginal,
  PluginManifest
} from 'obsidian';

import { Component } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ModuleDefinition } from './modules/modules-component.ts';

import { PluginSettings } from './plugin-settings.ts';

// --- Mocks for the plugin's OWN sibling modules (allowed: not obsidian-dev-utils / obsidian-test-mocks) ---

const hoisted = vi.hoisted(() => ({
  backlinksModuleComponentConstructor: vi.fn(),
  modulesComponentConstructor: vi.fn(),
  nameIndexComponentConstructor: vi.fn(),
  pluginSettingsComponentConstructor: vi.fn(),
  pluginSettingsTabConstructor: vi.fn()
}));

// `PluginDataHandler` and `PluginEventSourceImpl` are NOT stubbed: since obsidian-dev-utils 93.2 the base
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
  }
}));

vi.mock('./modules/backlinks/backlinks-module-component.ts', () => ({
  BacklinksModuleComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.backlinksModuleComponentConstructor(params);
    }
  }
}));

vi.mock('./modules/names/name-index-component.ts', () => ({
  NameIndexComponent: class extends Component {
    public constructor(app: unknown) {
      super();
      hoisted.nameIndexComponentConstructor(app);
    }
  }
}));

// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { Plugin } from './plugin.ts';

interface ModuleDefinitionsHolder {
  readonly moduleDefinitions: readonly ModuleDefinition[];
}

interface SettingTabsHolder {
  settingTabs__: unknown[];
}

function createApp(): AppOriginal {
  const appMock = App.createConfigured__();
  appMock.workspace.onLayoutReady = vi.fn((callback: () => void) => {
    callback();
  });
  return appMock.asOriginalType__();
}

async function createLoadedPlugin(app: AppOriginal): Promise<Plugin> {
  const plugin = new Plugin(app, createManifest());
  await plugin.onload();
  return plugin;
}

function createManifest(): PluginManifest {
  return strictProxy<PluginManifest>({
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
    expect(getModuleDefinitions().map((moduleDefinition) => moduleDefinition.moduleId)).toStrictEqual(['backlinks', 'names']);
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
    expect(hoisted.nameIndexComponentConstructor).toHaveBeenCalledWith(app);
  });

  it('should register the open demo vault command via its command handler', async () => {
    const plugin = new Plugin(createApp(), createManifest());
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');
    await plugin.onload();
    expect(addCommandSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'open-demo-vault' }));
  });
});
/* eslint-enable @typescript-eslint/no-extraneous-class -- End of test file. */
