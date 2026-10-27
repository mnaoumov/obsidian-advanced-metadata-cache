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
 * The settings component, seen through the one method a suite needs.
 */
export interface PluginSettingsEditor {
  editAndSave: (editor: (settings: SwitchablePluginSettings) => void) => Promise<void>;
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
  defaultTimeZone: string;
  isHeadingsModuleEnabled: boolean;
  isNamesModuleEnabled: boolean;
  isPropertiesModuleEnabled: boolean;
  isTitlesModuleEnabled: boolean;
  isUnlinkedMentionsModuleEnabled: boolean;
  shouldOfferTitlesInLinkSuggestions: boolean;
  titlePropertyNames: string[];
}

/**
 * Applies a settings patch through the plugin's own settings component, the way a user would.
 *
 * Every module below the first is off by default and the vault is shared by every suite in a
 * project, so a suite that switches one on switches it back off again.
 *
 * @param patch - The settings to change; anything left out is untouched.
 * @returns What went wrong, or `null`.
 */
export async function applyPluginSettings(patch: Partial<SwitchablePluginSettings>): Promise<ModuleSwitchResult> {
  return evalInObsidian({
    async callback({
      app,
      PATCH: settingsPatch,
      PLUGIN_ID: pluginId
    }) {
      const plugin = app.plugins.getPlugin(pluginId) as null | SettingsEditorPlugin;

      if (!plugin) {
        return { error: 'Plugin not loaded' };
      }

      await plugin.pluginSettingsComponent.editAndSave((settings) => {
        Object.assign(settings, settingsPatch);
      });

      return { error: null };
    },
    input: {
      PATCH: patch,
      PLUGIN_ID
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Switches the `names` module on or off.
 *
 * @param isEnabled - Whether the module should be running.
 * @returns What went wrong, or `null`.
 */
export async function setNamesModuleEnabled(isEnabled: boolean): Promise<ModuleSwitchResult> {
  return applyPluginSettings({ isNamesModuleEnabled: isEnabled });
}
