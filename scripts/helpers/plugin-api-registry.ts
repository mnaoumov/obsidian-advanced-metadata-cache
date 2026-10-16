/**
 * @file
 *
 * The published plugin API registry, as a suite reads it from inside an `evalInObsidian` closure.
 *
 * A closure cannot import a value, but it is type-checked in its own module's scope, so these TYPES are
 * free to be shared; each closure still reads the registry itself, in the few lines
 * `window.__obsidianDevUtils?.pluginApiRegistry?.value?.records` takes. That is the documented route for
 * a consumer that does not use `obsidian-dev-utils`, so it is the one a suite takes too.
 */

import type { AdvancedMetadataCacheApi } from '../../api.d.ts';

/**
 * The global the registry hangs off.
 */
export interface PluginApiRegistryHolder {
  readonly __obsidianDevUtils?: ObsidianDevUtilsStateBag;
}

interface ObsidianDevUtilsStateBag {
  readonly pluginApiRegistry?: PluginApiRegistryWrapper;
}

/**
 * One published API record, as the wire protocol carries it.
 */
interface PluginApiRecord {
  readonly api: AdvancedMetadataCacheApi;
  readonly apiVersion: string;
  readonly isRevoked: boolean;
}

interface PluginApiRegistry {
  readonly records?: Record<string, PluginApiRecord[] | undefined>;
}

interface PluginApiRegistryWrapper {
  readonly value?: PluginApiRegistry;
}
