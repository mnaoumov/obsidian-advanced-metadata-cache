import type { DataAdapter } from 'obsidian';

import type { IndexStorage } from './index-storage.ts';

interface FileIndexStorageConstructorParams {
  readonly adapter: DataAdapter;
  readonly getPath: () => string;
}

/**

 * File-backed interchange storage, also used to read the legacy migration source.

 */
export class FileIndexStorage implements IndexStorage {
  private readonly params: FileIndexStorageConstructorParams;

  public constructor(params: FileIndexStorageConstructorParams) {
    this.params = params;
  }

  public async read(): Promise<null | string> {
    const path = this.params.getPath();
    return await this.params.adapter.exists(path) ? await this.params.adapter.read(path) : null;
  }

  public async write(json: string): Promise<void> {
    await this.params.adapter.write(this.params.getPath(), json);
  }
}
