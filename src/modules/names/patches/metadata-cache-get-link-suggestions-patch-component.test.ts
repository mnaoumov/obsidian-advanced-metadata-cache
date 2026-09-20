import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type { MetadataCache } from 'obsidian';
import type { Mock } from 'vitest';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { NameIndexComponent } from '../name-index-component.ts';
import type { NameIndex } from '../name-index.ts';
import type { GetLinkSuggestionsWrapper } from './metadata-cache-get-link-suggestions-patch-component.ts';

import { MetadataCacheGetLinkSuggestionsPatchComponent } from './metadata-cache-get-link-suggestions-patch-component.ts';

type PatchedGetLinkSuggestions = GetLinkSuggestionsWrapper & MetadataCache['getLinkSuggestions'];

const NATIVE_SUGGESTIONS: LinkSuggestion[] = [{ file: null, path: 'native' }];
const INDEXED_SUGGESTIONS: LinkSuggestion[] = [{ file: null, path: 'indexed' }];
const SAFE_SUGGESTIONS: LinkSuggestion[] = [{ file: null, path: 'safe' }];

describe('MetadataCacheGetLinkSuggestionsPatchComponent', () => {
  let component: MetadataCacheGetLinkSuggestionsPatchComponent;
  let getLinkSuggestions: Mock<() => LinkSuggestion[]>;
  let getPathsByName: Mock<(name: string) => string[]>;
  let getPathsByNameSafe: Mock<(name: string) => Promise<string[]>>;
  let getSuggestions: Mock<() => LinkSuggestion[]>;
  let getSuggestionsSafe: Mock<() => Promise<LinkSuggestion[]>>;
  let isBuilt: boolean;
  let metadataCache: MetadataCache;

  beforeEach(() => {
    vi.clearAllMocks();
    isBuilt = false;
    getLinkSuggestions = vi.fn<() => LinkSuggestion[]>().mockReturnValue(NATIVE_SUGGESTIONS);
    getPathsByName = vi.fn<(name: string) => string[]>().mockReturnValue(['Indexed.md']);
    getPathsByNameSafe = vi.fn<(name: string) => Promise<string[]>>().mockResolvedValue(['Safe.md']);
    getSuggestions = vi.fn<() => LinkSuggestion[]>().mockReturnValue(INDEXED_SUGGESTIONS);
    getSuggestionsSafe = vi.fn<() => Promise<LinkSuggestion[]>>().mockResolvedValue(SAFE_SUGGESTIONS);

    metadataCache = strictProxy<MetadataCache>({ getLinkSuggestions });

    const nameIndexComponent = strictProxy<NameIndexComponent>({
      getPathsByNameSafe,
      getSuggestionsSafe,
      get isBuilt(): boolean {
        return isBuilt;
      },
      nameIndex: strictProxy<NameIndex>({ getPathsByName, getSuggestions })
    });

    component = new MetadataCacheGetLinkSuggestionsPatchComponent({ metadataCache, nameIndexComponent });
  });

  it('should defer to Obsidian until the index is built', async () => {
    await component.loadWithPromises();

    expect(metadataCache.getLinkSuggestions()).toBe(NATIVE_SUGGESTIONS);
    expect(getLinkSuggestions).toHaveBeenCalledOnce();
    expect(getSuggestions).not.toHaveBeenCalled();
  });

  it('should answer from the index once it is built', async () => {
    await component.loadWithPromises();
    isBuilt = true;

    expect(metadataCache.getLinkSuggestions()).toBe(INDEXED_SUGGESTIONS);
    expect(getLinkSuggestions).not.toHaveBeenCalled();
  });

  it('should keep Obsidian implementation reachable as `originalFn`', async () => {
    await component.loadWithPromises();
    isBuilt = true;

    expect(asPatched().originalFn()).toBe(NATIVE_SUGGESTIONS);
    expect(getLinkSuggestions).toHaveBeenCalledOnce();
  });

  it('should expose the waiting variants as `safe` and `getPathsByNameSafe`', async () => {
    await component.loadWithPromises();

    await expect(asPatched().safe()).resolves.toBe(SAFE_SUGGESTIONS);
    await expect(asPatched().getPathsByNameSafe('alpha')).resolves.toEqual(['Safe.md']);
    expect(getSuggestionsSafe).toHaveBeenCalledOnce();
    expect(getPathsByNameSafe).toHaveBeenCalledWith('alpha');
  });

  it('should expose the reverse lookup as `getPathsByName`', async () => {
    await component.loadWithPromises();

    expect(asPatched().getPathsByName('alpha')).toEqual(['Indexed.md']);
    expect(getPathsByName).toHaveBeenCalledWith('alpha');
  });

  it('should restore Obsidian implementation when unloaded', async () => {
    await component.loadWithPromises();
    component.unload();

    expect(metadataCache.getLinkSuggestions).toBe(getLinkSuggestions);
  });

  function asPatched(): PatchedGetLinkSuggestions {
    return metadataCache.getLinkSuggestions as PatchedGetLinkSuggestions;
  }
});
