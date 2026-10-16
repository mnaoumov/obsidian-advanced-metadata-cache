import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type { MetadataCache } from 'obsidian';
import type { Mock } from 'vitest';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { NameIndexComponent } from '../name-index-component.ts';
import type { NameIndex } from '../name-index.ts';

import { MetadataCacheGetLinkSuggestionsPatchComponent } from './metadata-cache-get-link-suggestions-patch-component.ts';

const NATIVE_SUGGESTIONS: LinkSuggestion[] = [{ file: null, path: 'native' }];
const INDEXED_SUGGESTIONS: LinkSuggestion[] = [{ file: null, path: 'indexed' }];

describe('MetadataCacheGetLinkSuggestionsPatchComponent', () => {
  let component: MetadataCacheGetLinkSuggestionsPatchComponent;
  let getLinkSuggestions: Mock<() => LinkSuggestion[]>;
  let getSuggestions: Mock<() => LinkSuggestion[]>;
  let isBuilt: boolean;
  let metadataCache: MetadataCache;

  beforeEach(() => {
    vi.clearAllMocks();
    isBuilt = false;
    getLinkSuggestions = vi.fn<() => LinkSuggestion[]>().mockReturnValue(NATIVE_SUGGESTIONS);
    getSuggestions = vi.fn<() => LinkSuggestion[]>().mockReturnValue(INDEXED_SUGGESTIONS);

    metadataCache = strictProxy<MetadataCache>({ getLinkSuggestions });

    const nameIndexComponent = strictProxy<NameIndexComponent>({
      get isBuilt(): boolean {
        return isBuilt;
      },
      nameIndex: strictProxy<NameIndex>({ getSuggestions })
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

  it('should call Obsidian implementation as the original, before and after the patch is installed', async () => {
    expect(component.getLinkSuggestionsOriginal()).toBe(NATIVE_SUGGESTIONS);

    await component.loadWithPromises();
    isBuilt = true;

    expect(component.getLinkSuggestionsOriginal()).toBe(NATIVE_SUGGESTIONS);
    expect(getLinkSuggestions).toHaveBeenCalledTimes(2);
    expect(getSuggestions).not.toHaveBeenCalled();
  });

  it('should graft nothing onto the patched method', async () => {
    await component.loadWithPromises();

    const patched = metadataCache.getLinkSuggestions;

    for (const member of ['getPathsByName', 'getPathsByNameSafe', 'originalFn', 'safe']) {
      expect(patched).not.toHaveProperty(member);
    }
  });

  it('should restore Obsidian implementation when unloaded', async () => {
    await component.loadWithPromises();
    component.unload();

    expect(metadataCache.getLinkSuggestions).toBe(getLinkSuggestions);
  });
});
