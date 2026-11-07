/**
 * @file
 *
 * Where this plugin's synchronized state lives, and how every index recognizes it.
 */

import { getFileNameValidationMessage } from '@mnaoumov/obsidian-lib/validation';

/**
 * The plugin id, which names this plugin's subfolder under a plugin data folder.
 */
export const PLUGIN_ID = 'advanced-metadata-cache';

/**
 * The folder a fresh install offers. Shared with the other plugins of this author, which keep their own subfolders.
 */
export const DEFAULT_PLUGIN_DATA_FOLDER = '@Plugin sync data (DO NOT REMOVE)';

/**
 * The folder versions 2.4.0 and 2.5.0 wrote to. A vault that already holds this plugin's history there keeps it as its
 * discovery anchor for good.
 */
export const LEGACY_PLUGIN_DATA_FOLDER = 'Plugin data';

type PluginDataPathMatcher = (path: string) => boolean;

interface PluginDataPathMatcherHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Replaced when the plugin loads and unloads.
  matcher: PluginDataPathMatcher;
}

function isInKnownFolder(path: string): boolean {
  return [DEFAULT_PLUGIN_DATA_FOLDER, LEGACY_PLUGIN_DATA_FOLDER].some((folder) => path.startsWith(`${folder}/${PLUGIN_ID}/`));
}

const pluginDataPathMatcherHolder: PluginDataPathMatcherHolder = { matcher: isInKnownFolder };

/**
 * Whether a note is part of this plugin's own transport rather than user content.
 *
 * Read by every index, a dozen call sites, so the loaded plugin installs the answer here
 * ({@link setPluginDataPathMatcher}) rather than threading its storage owner through every component. Until it does,
 * and after it unloads, the two known folders answer.
 *
 * @param path - Vault-relative path.
 * @returns Whether the path lies inside this plugin's synchronized state.
 */
export function isPluginDataPath(path: string): boolean {
  return pluginDataPathMatcherHolder.matcher(path);
}

/**
 * Installs the matcher {@link isPluginDataPath} answers from.
 *
 * @param matcher - The matcher, or `null` to restore the default.
 */
export function setPluginDataPathMatcher(matcher: null | PluginDataPathMatcher): void {
  pluginDataPathMatcherHolder.matcher = matcher ?? isInKnownFolder;
}

/**
 * Validates a plugin data folder before it reaches the adapter.
 *
 * Hidden segments are refused: Obsidian Sync and most other sync tools skip dot folders, so history written there
 * would silently never reach another device.
 *
 * @param folder - Vault-relative folder.
 * @returns A validation error, or `null` for a usable folder.
 */
export function validatePluginDataFolder(folder: string): null | string {
  const segments = folder.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.trim() !== segment || getFileNameValidationMessage(segment, true) !== '')) {
    return 'The plugin data folder must be a vault-relative folder path, with no empty, `.` or `..` segment, no leading or trailing space, and only characters a file name may hold.';
  }
  return segments.some((segment) => segment.startsWith('.'))
    ? 'The plugin data folder must not be hidden: sync tools skip a folder whose name starts with a dot, so its history would never reach another device.'
    : null;
}
