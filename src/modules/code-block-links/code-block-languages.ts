import { isMatchingNamePatterns } from '../../name-patterns.ts';

/**
 * One call of {@link CodeBlockLanguages.register}, kept as its own object so its unregister removes exactly it.
 */
interface Registration {
  readonly language: string;
}

/**
 * The code block languages whose content counts as markdown: the ones the user lists in the setting, and the
 * ones other plugins register through the API.
 *
 * Owned by the plugin rather than by the module, like `LinkTextIndex`, because a registration must outlive the
 * module being switched off and on. Registrations are kept in memory only: a plugin registers its languages on
 * each load and unregisters them on unload, which is what makes uninstalling it take its languages away.
 */
export class CodeBlockLanguages {
  private readonly listeners = new Set<() => void>();
  private readonly registrations: Registration[] = [];

  /**
   * The registered languages, each once however many plugins registered it.
   *
   * @returns The languages or patterns.
   */
  public getRegisteredLanguages(): string[] {
    return [...new Set(this.registrations.map((registration) => registration.language))];
  }

  /**
   * Whether a block of a language counts, by the setting or by a registration.
   *
   * @param settingPatterns - The setting's entries.
   * @param language - The block's language.
   * @returns Whether it counts.
   */
  public isIncluded(settingPatterns: readonly string[], language: string): boolean {
    return isMatchingNamePatterns(settingPatterns, language) || isMatchingNamePatterns(this.getRegisteredLanguages(), language);
  }

  /**
   * Subscribes to the registrations changing. A listener is told each time a language is registered or unregistered, a
   * repeated one included; it compares {@link CodeBlockLanguages.getRegisteredLanguages} itself.
   *
   * @param listener - Called after each change.
   * @returns A function that ends the subscription.
   */
  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Registers a language or a `*` pattern. Two plugins may register the same one; it stays until both have
   * unregistered it.
   *
   * @param language - The language or pattern.
   * @returns A function that unregisters it; calling it again does nothing.
   */
  public register(language: string): () => void {
    const registration: Registration = { language };
    this.registrations.push(registration);
    this.notify();

    return (): void => {
      const index = this.registrations.indexOf(registration);
      if (index === -1) {
        return;
      }
      this.registrations.splice(index, 1);
      this.notify();
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
