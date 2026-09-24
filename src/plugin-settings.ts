export class PluginSettings {
  public isBacklinksModuleEnabled = true;

  /**
   * Off by default, like every module added after the one this plugin was created for.
   */
  public isNamesModuleEnabled = false;

  /**
   * Off by default, like every module added after the one this plugin was created for.
   */
  public isTitlesModuleEnabled = false;
  public shouldAutomaticallyRefreshBacklinkPanels = false;

  /**
   * Whether a note's titles are offered by the `[[` autocomplete, alongside its own name and its
   * `aliases`.
   *
   * **Off by default, and that default is the contract.** `getLinkSuggestions()` is published as a
   * REPLACEMENT for Obsidian's own — the README says so, the demo vault says so, and
   * `readme-name-calls.cross-platform.integration.test.ts` asserts the two arrays are the same length.
   * Offering titles makes it answer a DIFFERENT question, which is a user-visible feature rather than a
   * faster answer to the same one, so it is something a user asks for rather than something they get.
   *
   * It is read only while BOTH {@link PluginSettings.isNamesModuleEnabled} and
   * {@link PluginSettings.isTitlesModuleEnabled} are on: the first owns the array, and the second is
   * what makes a title a name at all.
   */
  public shouldOfferTitlesInLinkSuggestions = false;
  public shouldShowProgressBarOnLoad = true;

  /**
   * The frontmatter properties whose values name a note, alongside its own name and its `aliases`.
   *
   * Plural, and defaulting to `title` rather than to nothing: a plugin that turned `title` on for
   * everyone would silently widen what counts as a name, but a module whose whole subject IS titles has
   * no such problem. It is read only while {@link PluginSettings.isTitlesModuleEnabled} is on, so the
   * default costs a vault nothing until the module is switched on.
   */
  public titlePropertyNames: string[] = ['title'];
}
