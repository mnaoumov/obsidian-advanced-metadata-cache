import type { MetadataParser } from '../../plugin-api.ts';

interface Registration {
  readonly extension: string;
  readonly parser: MetadataParser | null;
}

/**
Runtime registrations survive module toggles, but belong to the registering plugin's lifetime.
*/
export class MetadataParsers {
  private readonly listeners = new Set<() => void>();
  private readonly registrations: Registration[] = [];

  public getRegistration(extension: string): null | Registration {
    for (const registration of [...this.registrations].reverse()) {
      if (registration.extension === extension.toLowerCase()) {
        return registration;
      }
    }
    return null;
  }

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public register(extension: string, parser?: MetadataParser): () => void {
    const normalized = normalizeMetadataExtension(extension);
    if (!normalized) {
      throw new Error('Expected a non-native file extension without wildcards or path separators.');
    }
    const registration = { extension: normalized, parser: parser ?? null };
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

/**
Normalizes a single extension; native formats retain their own metadata owners.
*/
export function normalizeMetadataExtension(extension: string): null | string {
  const normalized = extension.trim().replace(/^\./, '').toLowerCase();
  return /^[a-z0-9_-]+$/.test(normalized) && !['base', 'canvas', 'md'].includes(normalized) ? normalized : null;
}
