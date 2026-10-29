export class PluginSettings {
  /**
   * The code block languages whose content is markdown, so the links and embeds written inside count like any
   * other: exact names, or patterns in which `*` stands for any run of characters (`ad-*`), matched
   * case-sensitively over the whole language. Other plugins add theirs through the API.
   *
   * Empty by default, so nothing changes until the user or a plugin names a language. Read by the
   * `Code block links` module only.
   */
  public codeBlockLinkLanguages: string[] = [];

  /**
   * The frontmatter properties whose values are dates whatever type `types.json` assigns them: exact names,
   * or patterns in which `*` stands for any run of characters, matched case-sensitively over the whole name.
   *
   * The default is the camelCase convention (`date`, `birthDate`, `startDate`). A property whose assigned
   * type is `date` or `datetime` is a date property without being listed here. Read by the `Properties`
   * module only.
   */
  public datePropertyNames: string[] = ['date', '*Date'];

  /**
  The IANA zone used by UTC queries for zoneless values; empty follows the device zone.
  */
  public defaultTimeZone = '';

  public isBacklinksModuleEnabled = true;

  /**
   * ON by default, unlike most modules added after the one this plugin was created for, because it does nothing
   * until a language is listed in {@link PluginSettings.codeBlockLinkLanguages} or registered by another plugin:
   * off, every such plugin would first have to ask its user to come here and switch it on.
   */
  public isCodeBlockLinksModuleEnabled = true;

  /**
   * Off by default, like every module added after the one this plugin was created for.
   */
  public isHeadingsModuleEnabled = false;

  /**
   * ON by default, unlike most modules added after the one this plugin was created for, because it is a label
   * source other plugins read: off, every such plugin would first have to ask its user to come here and switch it
   * on. It costs one read of the metadata cache Obsidian already holds per note at startup, and reads no note.
   */
  public isLinkTextsModuleEnabled = true;

  /**
   * Off by default, like every module added after the one this plugin was created for.
   */
  public isNamesModuleEnabled = false;

  /**
   * ON by default, unlike every other module added after the one this plugin was created for, because it
   * costs nothing until another plugin registers a property for it to index — and off, every such plugin
   * would first have to ask its user to come here and switch it on.
   */
  public isPropertiesModuleEnabled = true;

  /**
   * Off by default, like every module added after the one this plugin was created for.
   */
  public isTitlesModuleEnabled = false;

  /**
   * Off by default, like every module added after the one this plugin was created for. It reads every note once when
   * it starts, which a user who never opens the `Unlinked mentions` section should not pay for.
   */
  public isUnlinkedMentionsModuleEnabled = false;

  public shouldAutomaticallyRefreshBacklinkPanels = false;

  /**
   * Whether a note's titles are offered by the `[[` autocomplete, alongside its own name and its
   * `aliases`.
   *
   * **Off by default, and that default is the contract.** `getLinkSuggestions()` is published as a
   * REPLACEMENT for Obsidian's own — the README says so, the demo vault says so, and
   * `plugin-api-calls.cross-platform.integration.test.ts` asserts the two arrays are the same length.
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
   * The name patterns whose built names name a note, alongside its title properties: each a list of
   * properties (`['lastName', 'firstName']`) whose values are joined with spaces, once per language their
   * values list.
   *
   * Empty by default, because a pattern names the user's own properties and no default would be anybody's.
   * It is read only while {@link PluginSettings.isTitlesModuleEnabled} is on.
   */
  public titleNamePatterns: string[][] = [];

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
