/**
 * Whether a note is part of this plugin's own transport rather than user content.
 */
export function isPluginDataPath(path: string): boolean {
  return path.startsWith('Plugin data/advanced-metadata-cache/');
}
