/**
 * @file
 *
 * The runtime half of this plugin's published API: its CONTRACT, one entry per method of
 * {@link AdvancedMetadataCacheApi}, each with a schema over the argument list and a schema over the
 * value the method returns (awaited, for the `Safe` methods).
 *
 * This plugin publishes exactly this constant with its API, and a consumer copies it beside `api.d.ts`
 * and passes it as the `contract` when it looks the API up, so both ends validate against ONE
 * definition. The plugin registry checks the payloads against it only while the
 * `obsidian-lib:validate-plugin-api-payloads` debug switch is on.
 *
 * Copying it takes two dependencies beside `api.d.ts` and `obsidian`. `@mnaoumov/typescript-lib` carries
 * the contract types, the {@link https://standardschema.dev | Standard Schema} builders and the guard
 * builders, in its `api-contract` and `type-guards` entry points. `@mnaoumov/obsidian-lib` carries the file
 * guards, in its `file-system` entry point. What is left here is the constant and the guards for this API's
 * own shapes. `defineApiContract` checks every entry against its method's signature.
 */

import type { TypedApiContract } from '@mnaoumov/typescript-lib/api-contract';
import type { Reference } from 'obsidian';

import {
  isFile,
  isPathOrFile
} from '@mnaoumov/obsidian-lib/file-system';
import {
  createApiContractSchemaBuilders,
  createExpectedTypeGuard,
  defineApiContract,
  nullableGuard
} from '@mnaoumov/typescript-lib/api-contract';
import {
  arrayTypeGuard,
  functionTypeGuard,
  instanceOfTypeGuard,
  isBoolean,
  isNumber,
  isString,
  isStringArray,
  isUndefined,
  nullableTypeGuard,
  objectTypeGuard,
  optionalTypeGuard
} from '@mnaoumov/typescript-lib/type-guards';

import type {
  AdvancedMetadataCacheApi,
  AdvancedMetadataCacheMigratableSettings,
  CustomArrayDict,
  DatedValue,
  DatedValuesQuery,
  HeadingTimes,
  LinkSuggestion,
  MigrateSettingsParams,
  MigrateSettingsResult,
  UnlinkedMention,
  UnlinkedMentionRange
} from './api.d.ts';

/**
 * The type of {@link ADVANCED_METADATA_CACHE_API_CONTRACT}: one entry per method of
 * {@link AdvancedMetadataCacheApi}, each typed against that method's parameters and awaited return value.
 */
export type AdvancedMetadataCacheApiContract = TypedApiContract<AdvancedMetadataCacheApi>;

const { createArgumentsSchema, createTypeGuardSchema } = createApiContractSchemaBuilders('advanced-metadata-cache');

type BacklinksDict = CustomArrayDict<Reference>;

/**
 * Only the three members a caller relies on are checked, not every method of {@link CustomArrayDict}.
 */
const isBacklinksDictShape = objectTypeGuard<Pick<BacklinksDict, 'data' | 'get' | 'keys'>>({
  data: instanceOfTypeGuard<BacklinksDict['data']>(Map),
  get: functionTypeGuard<BacklinksDict['get']>(),
  keys: functionTypeGuard<BacklinksDict['keys']>()
});

const isDatedValue = objectTypeGuard<DatedValue>({
  path: isString,
  propertyName: isString,
  value: isString
});

const isDatedValuesQuery = objectTypeGuard<DatedValuesQuery>({
  from: optionalTypeGuard(isString),
  isRecurring: optionalTypeGuard(isBoolean),
  propertyNames: optionalTypeGuard(isStringArray),
  to: optionalTypeGuard(isString)
});

const isHeadingTimes = objectTypeGuard<HeadingTimes>({
  created: nullableTypeGuard(isNumber),
  heading: isString,
  level: isNumber,
  line: isNumber,
  modified: nullableTypeGuard(isNumber),
  seen: nullableTypeGuard(isNumber)
});

const isLinkSuggestion = objectTypeGuard<LinkSuggestion>({
  alias: optionalTypeGuard(isString),
  file: nullableTypeGuard(isFile),
  path: isString
});

const isMigratableSettings = objectTypeGuard<AdvancedMetadataCacheMigratableSettings>({
  titlePropertyNames: optionalTypeGuard(isStringArray)
});

const isMigrateSettingsParams = objectTypeGuard<MigrateSettingsParams>({
  proposedSettings: isMigratableSettings,
  sourcePluginId: isString
});

const isMigrateSettingsResult = objectTypeGuard<MigrateSettingsResult>({
  isApplied: isBoolean
});

const isUnlinkedMentionRange = objectTypeGuard<UnlinkedMentionRange>({
  end: isNumber,
  start: isNumber
});

const isUnlinkedMention = objectTypeGuard<UnlinkedMention>({
  path: isString,
  ranges: arrayTypeGuard(isUnlinkedMentionRange)
});

const BACKLINKS_DICT_GUARD = createExpectedTypeGuard('a backlinks dictionary', isBacklinksDict);
const DATED_VALUE_ARRAY_GUARD = createExpectedTypeGuard('an array of dated values', arrayTypeGuard(isDatedValue));
const DATED_VALUES_QUERY_GUARD = createExpectedTypeGuard('a dated values query', isDatedValuesQuery);
const LINK_SUGGESTION_ARRAY_GUARD = createExpectedTypeGuard('an array of link suggestions', arrayTypeGuard(isLinkSuggestion));
const NAME_GUARD = createExpectedTypeGuard('a name', isString);
const PATH_OR_FILE_GUARD = createExpectedTypeGuard('a path or a file', isPathOrFile);
const PATHS_GUARD = createExpectedTypeGuard('an array of paths', isStringArray);
const PROPERTY_NAME_GUARD = createExpectedTypeGuard('a property name', isString);
const PROPERTY_VALUE_GUARD = createExpectedTypeGuard('a property value', isString);
const UNLINKED_MENTION_ARRAY_GUARD = createExpectedTypeGuard('an array of unlinked mentions', arrayTypeGuard(isUnlinkedMention));

/**
 * The contract this plugin publishes with {@link AdvancedMetadataCacheApi}, for a consumer to pass as the
 * `contract` when it looks the API up.
 */
export const ADVANCED_METADATA_CACHE_API_CONTRACT: AdvancedMetadataCacheApiContract = defineApiContract<AdvancedMetadataCacheApi>({
  getBacklinksForFile: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(BACKLINKS_DICT_GUARD))
  },
  getBacklinksForFileOriginal: {
    input: createArgumentsSchema([createExpectedTypeGuard('a file', isFile)]),
    output: createTypeGuardSchema(BACKLINKS_DICT_GUARD)
  },
  getBacklinksForFileSafe: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(BACKLINKS_DICT_GUARD))
  },
  getDatedValues: {
    input: createArgumentsSchema([DATED_VALUES_QUERY_GUARD]),
    output: createTypeGuardSchema(nullableGuard(DATED_VALUE_ARRAY_GUARD))
  },
  getDatedValuesSafe: {
    input: createArgumentsSchema([DATED_VALUES_QUERY_GUARD]),
    output: createTypeGuardSchema(nullableGuard(DATED_VALUE_ARRAY_GUARD))
  },
  getHeadingTimes: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(createExpectedTypeGuard('an array of heading times', arrayTypeGuard(isHeadingTimes)))
  },
  getLinkSuggestions: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(LINK_SUGGESTION_ARRAY_GUARD))
  },
  getLinkSuggestionsOriginal: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(LINK_SUGGESTION_ARRAY_GUARD)
  },
  getLinkSuggestionsSafe: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(LINK_SUGGESTION_ARRAY_GUARD))
  },
  getNonDateValues: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(DATED_VALUE_ARRAY_GUARD))
  },
  getNonDateValuesSafe: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(DATED_VALUE_ARRAY_GUARD))
  },
  getPathsByName: {
    input: createArgumentsSchema([NAME_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsByNameSafe: {
    input: createArgumentsSchema([NAME_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsByPropertyValue: {
    input: createArgumentsSchema([PROPERTY_NAME_GUARD, PROPERTY_VALUE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsByPropertyValueSafe: {
    input: createArgumentsSchema([PROPERTY_NAME_GUARD, PROPERTY_VALUE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsWithProperty: {
    input: createArgumentsSchema([PROPERTY_NAME_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsWithPropertySafe: {
    input: createArgumentsSchema([PROPERTY_NAME_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getTitlePropertyNames: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(createExpectedTypeGuard('an array of property names', isStringArray))
  },
  getTitles: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(createExpectedTypeGuard('an array of titles', isStringArray))
  },
  getUnlinkedMentions: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(UNLINKED_MENTION_ARRAY_GUARD))
  },
  migrateSettings: {
    input: createArgumentsSchema([createExpectedTypeGuard('migrate settings params', isMigrateSettingsParams)]),
    output: createTypeGuardSchema(createExpectedTypeGuard('a migrate settings result', isMigrateSettingsResult))
  },
  registerPropertyName: {
    input: createArgumentsSchema([PROPERTY_NAME_GUARD]),
    output: createTypeGuardSchema(createExpectedTypeGuard('nothing', isUndefined))
  }
});

/**
 * A guard over the members a caller relies on cannot narrow to the whole {@link CustomArrayDict}, so this one
 * line restates the narrowing.
 *
 * @param value - The value to check.
 * @returns Whether the value is a backlinks dictionary.
 */
function isBacklinksDict(value: unknown): value is BacklinksDict {
  return isBacklinksDictShape(value);
}
