import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BLOB_DIR = './blobs'

export const blob = {
  async put(key: string, content: string): Promise<void> {
    const fullPath = join(BLOB_DIR, key)
    // make sure directory exists
    await mkdir(join(BLOB_DIR, 'pages'), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  },

  async get(key: string): Promise<string> {
    const fullPath = join(BLOB_DIR, key)
    return readFile(fullPath, 'utf-8')
  }
}