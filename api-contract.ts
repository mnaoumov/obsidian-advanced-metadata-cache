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
import type {
  Loc,
  Pos,
  Reference,
  ReferenceCache
} from 'obsidian';

import {
  isFile,
  isPathOrFile
} from '@mnaoumov/obsidian-lib/file-system';
import {
  createApiContractSchemaBuilders,
  createExpectedTypeGuard,
  defineApiContract,
  nullableGuard,
  optionalGuard
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
  CodeBlockReference,
  CustomArrayDict,
  DatedValue,
  DatedValuesQuery,
  ExternalHostUsage,
  ExternalLink,
  ExternalUrlUsage,
  HeadingTimes,
  HostQueryOptions,
  LinkSuggestion,
  LinkText,
  LinkTextsChangedCallback,
  MetadataParser,
  MigrateSettingsParams,
  MigrateSettingsResult,
  SimilarHost,
  SpecificTimeZone,
  TagQueryOptions,
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

/**
 * The members of a {@link CodeBlockReference} a caller relies on: not the whole position.
 */
interface CodeBlockReferenceShape {
  readonly isEmbed: boolean;
  readonly language: string;
  readonly reference: Pick<ReferenceCache, 'link' | 'original'>;
}

const isCodeBlockReferenceShape = objectTypeGuard<CodeBlockReferenceShape>({
  isEmbed: isBoolean,
  language: isString,
  reference: objectTypeGuard<Pick<ReferenceCache, 'link' | 'original'>>({
    link: isString,
    original: isString
  })
});

const isDatedValue = objectTypeGuard<DatedValue>({
  path: isString,
  propertyName: isString,
  value: isString
});

const isDatedValuesQuery = objectTypeGuard<DatedValuesQuery>({
  from: optionalTypeGuard(isString),
  isRecurring: optionalTypeGuard(isBoolean),
  missingTimeZone: optionalTypeGuard((value): value is NonNullable<DatedValuesQuery['missingTimeZone']> =>
    value === 'default' || value === 'utc' || value === 'skip' || value === 'fail'
    || objectTypeGuard<SpecificTimeZone>({ zone: isString })(value)
  ),
  propertyNames: optionalTypeGuard(isStringArray),
  timeBasis: optionalTypeGuard((value): value is NonNullable<DatedValuesQuery['timeBasis']> => value === 'utc' || value === 'wallClock'),
  to: optionalTypeGuard(isString)
});

const isExternalHostUsage = objectTypeGuard<ExternalHostUsage>({
  host: isString,
  noteCount: isNumber
});

const isLoc = objectTypeGuard<Loc>({
  col: isNumber,
  line: isNumber,
  offset: isNumber
});

const isExternalLink = objectTypeGuard<ExternalLink>({
  host: isString,
  isInFrontmatter: isBoolean,
  normalizedUrl: isString,
  position: objectTypeGuard<Pos>({
    end: isLoc,
    start: isLoc
  }),
  url: isString
});

const isExternalUrlUsage = objectTypeGuard<ExternalUrlUsage>({
  host: isString,
  normalizedUrl: isString,
  noteCount: isNumber,
  url: isString
});

const isHeadingTimes = objectTypeGuard<HeadingTimes>({
  created: nullableTypeGuard(isNumber),
  heading: isString,
  level: isNumber,
  line: isNumber,
  modified: nullableTypeGuard(isNumber),
  seen: nullableTypeGuard(isNumber)
});

const isHostQueryOptions = objectTypeGuard<HostQueryOptions>({
  shouldIncludeSubdomains: optionalTypeGuard(isBoolean)
});

const isLinkSuggestion = objectTypeGuard<LinkSuggestion>({
  alias: optionalTypeGuard(isString),
  file: nullableTypeGuard(isFile),
  path: isString
});

const isLinkText = objectTypeGuard<LinkText>({
  count: isNumber,
  sourcePaths: isStringArray,
  text: isString
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

const isSimilarHost = objectTypeGuard<SimilarHost>({
  distance: isNumber,
  host: isString,
  noteCount: isNumber
});

const isTagQueryOptions = objectTypeGuard<TagQueryOptions>({
  shouldIncludeNestedTags: optionalTypeGuard(isBoolean),
  source: optionalTypeGuard((value): value is NonNullable<TagQueryOptions['source']> => value === 'body' || value === 'frontmatter')
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
const CODE_BLOCK_REFERENCE_ARRAY_GUARD = createExpectedTypeGuard('an array of code block references', arrayTypeGuard(isCodeBlockReference));
const DATED_VALUE_ARRAY_GUARD = createExpectedTypeGuard('an array of dated values', arrayTypeGuard(isDatedValue));
const DATED_VALUES_QUERY_GUARD = createExpectedTypeGuard('a dated values query', isDatedValuesQuery);
const EXTERNAL_HOST_USAGE_ARRAY_GUARD = createExpectedTypeGuard('an array of external host usages', arrayTypeGuard(isExternalHostUsage));
const EXTERNAL_LINK_ARRAY_GUARD = createExpectedTypeGuard('an array of external links', arrayTypeGuard(isExternalLink));
const EXTERNAL_URL_USAGE_ARRAY_GUARD = createExpectedTypeGuard('an array of external URL usages', arrayTypeGuard(isExternalUrlUsage));
const HOST_GUARD = createExpectedTypeGuard('a host', isString);
const HOST_QUERY_OPTIONS_GUARD = optionalGuard(createExpectedTypeGuard('host query options', isHostQueryOptions));
const MAX_DISTANCE_GUARD = optionalGuard(createExpectedTypeGuard('a maximum distance', isNumber));
const METADATA_PARSER_GUARD = optionalGuard(createExpectedTypeGuard('a metadata parser', functionTypeGuard<MetadataParser>()));
const OPTIONAL_HOST_GUARD = optionalGuard(HOST_GUARD);
const LINK_SUGGESTION_ARRAY_GUARD = createExpectedTypeGuard('an array of link suggestions', arrayTypeGuard(isLinkSuggestion));
const LINK_PATH_GUARD = createExpectedTypeGuard('a link path', isString);
const LINK_TEXT_ARRAY_GUARD = createExpectedTypeGuard('an array of link texts', arrayTypeGuard(isLinkText));
const NAME_GUARD = createExpectedTypeGuard('a name', isString);
const PATH_OR_FILE_GUARD = createExpectedTypeGuard('a path or a file', isPathOrFile);
const PATHS_GUARD = createExpectedTypeGuard('an array of paths', isStringArray);
const SIMILAR_HOST_ARRAY_GUARD = createExpectedTypeGuard('an array of similar hosts', arrayTypeGuard(isSimilarHost));
const PROPERTY_NAME_GUARD = createExpectedTypeGuard('a property name', isString);
const PROPERTY_VALUE_GUARD = createExpectedTypeGuard('a property value', isString);
const URL_GUARD = createExpectedTypeGuard('a URL', isString);
const TAG_GUARD = createExpectedTypeGuard('a tag', isString);
const TAG_QUERY_OPTIONS_GUARD = optionalGuard(createExpectedTypeGuard('tag query options', isTagQueryOptions));
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
  getCodeBlockReferences: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(CODE_BLOCK_REFERENCE_ARRAY_GUARD))
  },
  getCodeBlockReferencesSafe: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(CODE_BLOCK_REFERENCE_ARRAY_GUARD))
  },
  getDatedValues: {
    input: createArgumentsSchema([DATED_VALUES_QUERY_GUARD]),
    output: createTypeGuardSchema(nullableGuard(DATED_VALUE_ARRAY_GUARD))
  },
  getDatedValuesSafe: {
    input: createArgumentsSchema([DATED_VALUES_QUERY_GUARD]),
    output: createTypeGuardSchema(nullableGuard(DATED_VALUE_ARRAY_GUARD))
  },
  getExternalLinkHosts: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(EXTERNAL_HOST_USAGE_ARRAY_GUARD))
  },
  getExternalLinkHostsSafe: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(EXTERNAL_HOST_USAGE_ARRAY_GUARD))
  },
  getExternalLinks: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(EXTERNAL_LINK_ARRAY_GUARD))
  },
  getExternalLinksSafe: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(EXTERNAL_LINK_ARRAY_GUARD))
  },
  getExternalLinkUrls: {
    input: createArgumentsSchema([OPTIONAL_HOST_GUARD]),
    output: createTypeGuardSchema(nullableGuard(EXTERNAL_URL_USAGE_ARRAY_GUARD))
  },
  getExternalLinkUrlsSafe: {
    input: createArgumentsSchema([OPTIONAL_HOST_GUARD]),
    output: createTypeGuardSchema(nullableGuard(EXTERNAL_URL_USAGE_ARRAY_GUARD))
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
  getLinkTexts: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(LINK_TEXT_ARRAY_GUARD))
  },
  getLinkTextsSafe: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(LINK_TEXT_ARRAY_GUARD))
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
  getPathsLinkingToHost: {
    input: createArgumentsSchema([HOST_GUARD, HOST_QUERY_OPTIONS_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsLinkingToHostSafe: {
    input: createArgumentsSchema([HOST_GUARD, HOST_QUERY_OPTIONS_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsLinkingToUrl: {
    input: createArgumentsSchema([URL_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsLinkingToUrlSafe: {
    input: createArgumentsSchema([URL_GUARD]),
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
  getPathsWithTag: {
    input: createArgumentsSchema([TAG_GUARD, TAG_QUERY_OPTIONS_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getPathsWithTagSafe: {
    input: createArgumentsSchema([TAG_GUARD, TAG_QUERY_OPTIONS_GUARD]),
    output: createTypeGuardSchema(nullableGuard(PATHS_GUARD))
  },
  getSimilarHosts: {
    input: createArgumentsSchema([HOST_GUARD, MAX_DISTANCE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(SIMILAR_HOST_ARRAY_GUARD))
  },
  getSimilarHostsSafe: {
    input: createArgumentsSchema([HOST_GUARD, MAX_DISTANCE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(SIMILAR_HOST_ARRAY_GUARD))
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
  getUnresolvedBacklinks: {
    input: createArgumentsSchema([LINK_PATH_GUARD]),
    output: createTypeGuardSchema(nullableGuard(BACKLINKS_DICT_GUARD))
  },
  getUnresolvedBacklinksSafe: {
    input: createArgumentsSchema([LINK_PATH_GUARD]),
    output: createTypeGuardSchema(nullableGuard(BACKLINKS_DICT_GUARD))
  },
  migrateSettings: {
    input: createArgumentsSchema([createExpectedTypeGuard('migrate settings params', isMigrateSettingsParams)]),
    output: createTypeGuardSchema(createExpectedTypeGuard('a migrate settings result', isMigrateSettingsResult))
  },
  onLinkTextsChanged: {
    input: createArgumentsSchema([createExpectedTypeGuard('a callback', functionTypeGuard<LinkTextsChangedCallback>())]),
    output: createTypeGuardSchema(createExpectedTypeGuard('an unsubscribe function', functionTypeGuard<() => void>()))
  },
  registerCodeBlockLanguage: {
    input: createArgumentsSchema([createExpectedTypeGuard('a code block language', isString)]),
    output: createTypeGuardSchema(createExpectedTypeGuard('an unregister function', functionTypeGuard<() => void>()))
  },
  registerMetadataParser: {
    input: createArgumentsSchema([
      createExpectedTypeGuard('a file extension', isString),
      METADATA_PARSER_GUARD
    ]),
    output: createTypeGuardSchema(createExpectedTypeGuard('an unregister function', functionTypeGuard<() => void>()))
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

/**
 * A guard over the members a caller relies on cannot narrow to the whole {@link ReferenceCache}, so this one line
 * restates the narrowing.
 *
 * @param value - The value to check.
 * @returns Whether the value is a code block reference.
 */
function isCodeBlockReference(value: unknown): value is CodeBlockReference {
  return isCodeBlockReferenceShape(value);
}
