import type { CustomArrayDict } from '@obsidian-typings/obsidian-public-latest';
import type {
  MetadataCache,
  Reference,
  TFile
} from 'obsidian';
import type { Mock } from 'vitest';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BacklinkCacheComponent } from '../backlink-cache-component.ts';

import { MetadataCacheGetBacklinksForFilePatchComponent } from './metadata-cache-get-backlinks-for-file-patch-component.ts';

const NATIVE_BACKLINKS = castTo<CustomArrayDict<Reference>>({ source: 'native' });
const CACHED_BACKLINKS = castTo<CustomArrayDict<Reference>>({ source: 'cache' });

describe('MetadataCacheGetBacklinksForFilePatchComponent', () => {
  let component: MetadataCacheGetBacklinksForFilePatchComponent;
  let file: TFile;
  let getBacklinksForFile: Mock<(file: TFile) => CustomArrayDict<Reference>>;
  let metadataCache: MetadataCache;

  beforeEach(() => {
    file = castTo<TFile>({ path: 'Alpha.md' });
    getBacklinksForFile = vi.fn<(file: TFile) => CustomArrayDict<Reference>>().mockReturnValue(NATIVE_BACKLINKS);
    metadataCache = strictProxy<MetadataCache>({ getBacklinksForFile });

    const backlinkCacheComponent = strictProxy<BacklinkCacheComponent>({
      getBacklinksForFile: () => CACHED_BACKLINKS
    });

    component = new MetadataCacheGetBacklinksForFilePatchComponent({ backlinkCacheComponent, metadataCache });
  });

  it('should answer from the cache once installed', async () => {
    await component.loadWithPromises();

    expect(metadataCache.getBacklinksForFile(file)).toBe(CACHED_BACKLINKS);
    expect(getBacklinksForFile).not.toHaveBeenCalled();
  });

  it('should call Obsidian implementation as the original, before and after the patch is installed', async () => {
    expect(component.getBacklinksForFileOriginal(file)).toBe(NATIVE_BACKLINKS);

    await component.loadWithPromises();

    expect(component.getBacklinksForFileOriginal(file)).toBe(NATIVE_BACKLINKS);
    expect(getBacklinksForFile).toHaveBeenCalledTimes(2);
    expect(getBacklinksForFile).toHaveBeenLastCalledWith(file);
  });

  it('should graft nothing onto the patched method', async () => {
    await component.loadWithPromises();

    expect(metadataCache.getBacklinksForFile).not.toHaveProperty('originalFn');
    expect(metadataCache.getBacklinksForFile).not.toHaveProperty('safe');
  });

  it('should restore Obsidian implementation when unloaded', async () => {
    await component.loadWithPromises();
    component.unload();

    expect(metadataCache.getBacklinksForFile).toBe(getBacklinksForFile);
  });
});
