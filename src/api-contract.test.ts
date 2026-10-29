import type {
  ApiMethodCases,
  PayloadCases
} from '@mnaoumov/typescript-lib/api-contract-verifier';
import type { TFile } from 'obsidian';

import {
  validateSync,
  verifyApiContract
} from '@mnaoumov/typescript-lib/api-contract-verifier';
import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { AdvancedMetadataCacheApi } from '../api.d.ts';

import { ADVANCED_METADATA_CACHE_API_CONTRACT } from '../api-contract.ts';

const BACKLINKS_DICT = {
  data: new Map(),
  get: (): null => null,
  keys: (): string[] => []
};

const CODE_BLOCK_LINK = {
  link: 'Alpha',
  original: '[[Alpha]]',
  position: {
    end: { col: 9, line: 1, offset: 20 },
    start: { col: 0, line: 1, offset: 11 }
  }
};

const HEADING_TIMES = {
  created: null,
  heading: 'One',
  level: 1,
  line: 0,
  modified: 1,
  seen: null
};

describe('ADVANCED_METADATA_CACHE_API_CONTRACT', () => {
  let file: TFile;

  beforeEach(() => {
    const app = App.createConfigured__();
    file = castTo<TFile>(app.vault.createSync__('Alpha.md', ''));
  });

  function getCases(): Record<keyof AdvancedMetadataCacheApi, ApiMethodCases> {
    const pathOrFile: PayloadCases = { invalid: [[], [1], [{ path: 'Alpha.md' }], ['Alpha.md', 'extra'], 'Alpha.md'], valid: [['Alpha.md'], [file]] };
    const noArguments: PayloadCases = { invalid: [['extra'], null], valid: [[]] };
    const name: PayloadCases = { invalid: [[], [null]], valid: [['Some Alias']] };
    const nullableBacklinks: PayloadCases = { invalid: [{}, { ...BACKLINKS_DICT, data: {} }, { ...BACKLINKS_DICT, keys: 1 }, undefined], valid: [null, BACKLINKS_DICT] };
    const nullableSuggestions: PayloadCases = {
      invalid: [undefined, [null], [{ file: null }], [{ file: {}, path: 'a' }], [{ alias: 1, file: null, path: 'a' }]],
      // An `alias` of `undefined` and a key the suggestion does not name both pass, as before the guards moved to `@mnaoumov/typescript-lib`.
      valid: [null, [], [{ file: null, path: 'a' }, { alias: 'b', file, path: 'Alpha.md' }], [{ alias: undefined, file: null, path: 'a', unknownKey: true }]]
    };
    const propertyValue: PayloadCases = { invalid: [[], ['keys'], ['keys', 1], [1, 'a'], ['keys', 'a', 'extra']], valid: [['keys', 'a']] };
    const nullableStrings: PayloadCases = { invalid: [undefined, [1]], valid: [null, ['a']] };
    const strings: PayloadCases = { invalid: [null, ['a', 1]], valid: [[], ['a']] };
    const datedValuesQuery: PayloadCases = {
      invalid: [[], [null], [{ from: 1 }], [{ isRecurring: 'yes' }], [{ propertyNames: [1] }], [{ to: null }], [{ timeBasis: 'local' }], [{ missingTimeZone: 'guess' }], [{ missingTimeZone: { zone: 1 } }], [{}, 'extra']],
      valid: [[{}], [{ from: '2026', isRecurring: false, propertyNames: ['birthday'], to: '2026-10-31' }], [{ missingTimeZone: { zone: 'Europe/Kyiv' }, timeBasis: 'utc' }], ...['default', 'utc', 'skip', 'fail'].map((missingTimeZone) => [{ missingTimeZone, timeBasis: 'utc' }])]
    };
    const nullableDatedValues: PayloadCases = {
      invalid: [undefined, [null], [{ path: 'Alpha.md', propertyName: 'birthday' }], [{ path: 'Alpha.md', propertyName: 'birthday', value: 1 }]],
      valid: [null, [], [{ path: 'Alpha.md', propertyName: 'birthday', value: '2026-10-26' }]]
    };
    const nullableLinkTexts: PayloadCases = {
      invalid: [undefined, [null], [{ count: 1, text: 'alpha' }], [{ count: '1', sourcePaths: [], text: 'alpha' }], [{ count: 1, sourcePaths: [1], text: 'alpha' }]],
      valid: [null, [], [{ count: 2, sourcePaths: ['Charlie.md'], text: 'alpha' }]]
    };

    const nullableCodeBlockReferences: PayloadCases = {
      invalid: [undefined, [null], [{ isEmbed: false, language: 'ad-note' }], [{ isEmbed: 'no', language: 'ad-note', reference: CODE_BLOCK_LINK }], [{ isEmbed: false, language: 1, reference: CODE_BLOCK_LINK }], [{ isEmbed: false, language: 'ad-note', reference: { link: 'Alpha' } }]],
      valid: [null, [], [{ isEmbed: false, language: 'ad-note', reference: CODE_BLOCK_LINK }]]
    };

    return {
      getBacklinksForFile: { input: pathOrFile, output: nullableBacklinks },
      getBacklinksForFileOriginal: {
        input: { invalid: [['Alpha.md'], []], valid: [[file]] },
        output: { invalid: [null], valid: [BACKLINKS_DICT] }
      },
      getBacklinksForFileSafe: { input: pathOrFile, output: nullableBacklinks },
      getCodeBlockReferences: { input: pathOrFile, output: nullableCodeBlockReferences },
      getCodeBlockReferencesSafe: { input: pathOrFile, output: nullableCodeBlockReferences },
      getDatedValues: { input: datedValuesQuery, output: nullableDatedValues },
      getDatedValuesSafe: { input: datedValuesQuery, output: nullableDatedValues },
      getHeadingTimes: {
        input: pathOrFile,
        output: {
          invalid: [null, [null], [{ ...HEADING_TIMES, created: '1' }], [{ ...HEADING_TIMES, heading: 1 }], [{ ...HEADING_TIMES, level: '1' }], [{ ...HEADING_TIMES, line: null }], [{ ...HEADING_TIMES, modified: undefined }], [{ ...HEADING_TIMES, seen: '1' }]],
          valid: [[], [HEADING_TIMES]]
        }
      },
      getLinkSuggestions: { input: noArguments, output: nullableSuggestions },
      getLinkSuggestionsOriginal: { input: noArguments, output: { invalid: [null], valid: [[{ file: null, path: 'a' }]] } },
      getLinkSuggestionsSafe: { input: noArguments, output: nullableSuggestions },
      getLinkTexts: { input: pathOrFile, output: nullableLinkTexts },
      getLinkTextsSafe: { input: pathOrFile, output: nullableLinkTexts },
      getNonDateValues: { input: noArguments, output: nullableDatedValues },
      getNonDateValuesSafe: { input: noArguments, output: nullableDatedValues },
      getPathsByName: { input: name, output: nullableStrings },
      getPathsByNameSafe: { input: name, output: nullableStrings },
      getPathsByPropertyValue: { input: propertyValue, output: nullableStrings },
      getPathsByPropertyValueSafe: { input: propertyValue, output: nullableStrings },
      getPathsWithProperty: { input: name, output: nullableStrings },
      getPathsWithPropertySafe: { input: name, output: nullableStrings },
      getTitlePropertyNames: { input: noArguments, output: strings },
      getTitles: { input: pathOrFile, output: strings },
      getUnlinkedMentions: {
        input: pathOrFile,
        output: {
          invalid: [undefined, [null], [{ path: 'Alpha.md' }], [{ path: 1, ranges: [] }], [{ path: 'Alpha.md', ranges: [{ start: 0 }] }], [{ path: 'Alpha.md', ranges: [{ end: '3', start: 0 }] }]],
          valid: [null, [], [{ path: 'Alpha.md', ranges: [] }, { path: 'Beta.md', ranges: [{ end: 5, start: 0 }] }]]
        }
      },
      migrateSettings: {
        input: {
          invalid: [[], [null], [{ proposedSettings: {} }], [{ proposedSettings: null, sourcePluginId: 'x' }], [{
            proposedSettings: { titlePropertyNames: [1] },
            sourcePluginId: 'x'
          }]],
          // An optional key of `undefined` and a key the params do not name both pass, as before the guards moved to `@mnaoumov/typescript-lib`.
          valid: [[{ proposedSettings: {}, sourcePluginId: 'x' }], [{ proposedSettings: { titlePropertyNames: ['subtitle'] }, sourcePluginId: 'x' }], [{
            proposedSettings: { titlePropertyNames: undefined, unknownKey: true },
            sourcePluginId: 'x',
            unknownKey: true
          }]]
        },
        output: { invalid: [null, {}, { isApplied: 'yes' }], valid: [{ isApplied: true }, { isApplied: false, unknownKey: true }] }
      },
      onLinkTextsChanged: {
        input: { invalid: [[], [null], ['callback'], [noop, 'extra']], valid: [[noop]] },
        output: { invalid: [undefined, null, {}], valid: [noop] }
      },
      registerCodeBlockLanguage: {
        input: { invalid: [[], [null], [1], ['ad-note', 'extra']], valid: [['ad-note'], ['ad-*']] },
        output: { invalid: [undefined, null, {}], valid: [noop] }
      },
      registerPropertyName: { input: name, output: { invalid: [null, false, 'a'], valid: [undefined] } }
    };
  }

  it('should pass the contract verification', async () => {
    expect(await verifyApiContract(ADVANCED_METADATA_CACHE_API_CONTRACT, { cases: getCases(), vendor: 'advanced-metadata-cache' })).toEqual([]);
  });

  it('should name the failing argument and what it expected', () => {
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, [1])).toEqual({
      issues: [{ message: 'Expected a path or a file.', path: [0] }]
    });
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, 'Alpha.md')).toEqual({
      issues: [{ message: 'Expected an argument list.' }]
    });
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, ['a', 'b'])).toEqual({
      issues: [{ message: 'Expected at most 1 argument(s), got 2.' }]
    });
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.output, null)).toEqual({
      issues: [{ message: 'Expected an array of titles.' }]
    });
  });
});
