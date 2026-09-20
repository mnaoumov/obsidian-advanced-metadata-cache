import type {
  App,
  TFile
} from 'obsidian';

import { getFileOrNull } from 'obsidian-dev-utils/obsidian/file-system';

import type { TitleIndex } from './modules/titles/title-index.ts';
import type { AdvancedMetadataCacheApi } from './plugin-api.ts';

interface PluginApiImplConstructorParams {
  readonly app: App;
  readonly titleIndex: TitleIndex;
}

/**
 * The published API, implemented over the indexes the modules own.
 *
 * It is published for the plugin's whole life rather than for a module's, and answers emptily while the
 * module behind it is off. A registry record that came and went with a toggle would make "the plugin is
 * not installed" and "you switched a module off" the same observation for a consumer — the first is
 * something to repair, the second is a setting, and telling them apart is most of what the registry is
 * for.
 */
export class PluginApiImpl implements AdvancedMetadataCacheApi {
  private readonly app: App;
  private readonly titleIndex: TitleIndex;

  public constructor(params: PluginApiImplConstructorParams) {
    this.app = params.app;
    this.titleIndex = params.titleIndex;
  }

  /**
   * The frontmatter properties whose values currently count as a note's title.
   *
   * @returns The configured property names, empty while the `Titles` module is off.
   */
  public getTitlePropertyNames(): string[] {
    return this.titleIndex.getTitlePropertyNames();
  }

  /**
   * Reads one note's titles.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns Its titles, empty for a path no file answers to and while the `Titles` module is off.
   */
  public getTitles(pathOrFile: string | TFile): string[] {
    const file = getFileOrNull({ app: this.app, pathOrFile });

    if (!file) {
      return [];
    }

    return [...this.titleIndex.getTitles(file)];
  }
}
