export class PluginSettings {
  public isBacklinksModuleEnabled = true;

  /**
   * Off by default, like every module added after the one this plugin was created for.
   */
  public isNamesModuleEnabled = false;
  public shouldAutomaticallyRefreshBacklinkPanels = false;
  public shouldShowProgressBarOnLoad = true;
}
