/**
 * @file
 *
 * Which frontmatter properties hold dates: the ones whose ASSIGNED type is `date` or `datetime`, and the
 * ones whose name matches the `datePropertyNames` setting. Both the module's component, which registers
 * them, and the index, which lists their values that are not dates, ask the same question here.
 */

import type { ReadonlyPluginSettings } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import type { App } from 'obsidian';

import type { PluginSettings } from '../../plugin-settings.ts';

import { isMatchingNamePatterns } from '../../name-patterns.ts';

/**
 * The property types whose properties are registered without anybody asking, so every dated value in the
 * vault is in the ordered index.
 */
const DATE_PROPERTY_TYPES: ReadonlySet<string> = new Set(['date', 'datetime']);

/**
 * Whether a property holds dates, by its assigned type or by its name.
 *
 * @param app - The Obsidian app.
 * @param settings - The current effective settings.
 * @param propertyName - The property name, as a note spells it.
 * @returns Whether its values belong in the ordered index.
 */
export function isDatePropertyName(app: App, settings: ReadonlyPluginSettings<PluginSettings>, propertyName: string): boolean {
  const type = app.metadataTypeManager.getAssignedWidget(propertyName);
  return (type !== null && DATE_PROPERTY_TYPES.has(type)) || isMatchingDatePropertyNames(settings.datePropertyNames, propertyName);
}

/**
 * Whether a property name matches one of the configured entries: an exact name, or a pattern in which each
 * `*` stands for any run of characters, the empty one included. Matched over the whole name and
 * case-sensitively, so `*Date` matches `birthDate` and `Date` but not `update`.
 *
 * @param datePropertyNames - The configured entries; blank ones match nothing.
 * @param propertyName - The property name.
 * @returns Whether any entry matches it.
 */
export function isMatchingDatePropertyNames(datePropertyNames: readonly string[], propertyName: string): boolean {
  return isMatchingNamePatterns(datePropertyNames, propertyName);
}
