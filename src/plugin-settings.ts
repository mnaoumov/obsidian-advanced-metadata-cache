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
