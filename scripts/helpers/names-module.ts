import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type { Plugin } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';

const PLUGIN_ID = 'advanced-metadata-cache';

/**
 * What {@link setNamesModuleEnabled} answers: the failure, or `null`.
 */
export interface ModuleSwitchResult {
  readonly error: null | string;
}

/**
 * The shape `app.metadataCache.getLinkSuggestions` takes while the `names` module is on — the same
 * shape `types.d.ts` ships for consumers, with every grafted member optional so a suite can ask
 * whether the patch is there yet.
 *
 * Declared here rather than in each suite because an `evalInObsidian` closure cannot import a value
 * but is type-checked in its own module's scope, so TYPES are free to be shared.
 */
export interface PatchedGetLinkSuggestions {
  (): LinkSuggestion[];
  getPathsByName?(name: string): string[];
  getPathsByNameSafe?(name: string): Promise<string[]>;
  // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is this plugin's documented public API - the README tells users to call it.
  originalFn?(): LinkSuggestion[];
  safe?(): Promise<LinkSuggestion[]>;
}

/**
 * The settings component, seen through the one method a suite needs.
 */
export interface PluginSettingsEditor {
  editAndSave(editor: (settings: SwitchablePluginSettings) => void): Promise<void>;
}

/**
 * {@link PatchedGetLinkSuggestions} once the patch is known to be installed — every grafted member
 * present.
 *
 * A separate interface rather than `Required<PatchedGetLinkSuggestions>`, because that mapped type
 * drops the call signature and leaves the result with nothing to call.
 */
export interface ReadyGetLinkSuggestions {
  (): LinkSuggestion[];
  getPathsByName(name: string): string[];
  getPathsByNameSafe(name: string): Promise<string[]>;
  // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is this plugin's documented public API - the README tells users to call it.
  originalFn(): LinkSuggestion[];
  safe(): Promise<LinkSuggestion[]>;
}

/**
 * The plugin, seen through the one member a suite needs in order to switch a module on: its
 * settings component.
 */
export interface SettingsEditorPlugin extends Plugin {
  pluginSettingsComponent: PluginSettingsEditor;
}

/**
 * The settings a suite switches.
 */
export interface SwitchablePluginSettings {
  isNamesModuleEnabled: boolean;
}

/**
 * Switches the `names` module on or off through the plugin's own settings, the way a user would.
 *
 * The module is off by default and the vault is shared by every suite in a project, so a suite that
 * switches it on switches it back off again.
 *
 * @param isEnabled - Whether the module should be running.
 * @returns What went wrong, or `null`.
 */
export async function setNamesModuleEnabled(isEnabled: boolean): Promise<ModuleSwitchResult> {
  return evalInObsidian({
    async callback({
      app,
      IS_ENABLED: isEnabledNow,
      PLUGIN_ID: pluginId
    }) {
      const plugin = app.plugins.getPlugin(pluginId) as null | SettingsEditorPlugin;

      if (!plugin) {
        return { error: 'Plugin not loaded' };
      }

      await plugin.pluginSettingsComponent.editAndSave((settings) => {
        settings.isNamesModuleEnabled = isEnabledNow;
      });

      return { error: null };
    },
    input: {
      IS_ENABLED: isEnabled,
      PLUGIN_ID
    },
    vaultPath: getTemporaryVault().path
  });
}
