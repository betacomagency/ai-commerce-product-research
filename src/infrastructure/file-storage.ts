import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

export interface StoredImage {
  path: string
  originalName: string
  mimeType: string
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
}

export class LocalFileStorage {
  constructor(private readonly root: string) {}

  async saveProductImage(jobId: string, originalName: string, mimeType: string, buffer: Buffer): Promise<StoredImage> {
    if (!mimeType.startsWith('image/')) throw new Error('File upload phải là ảnh.')
    const directory = join(this.root, 'jobs', jobId, 'input')
    await mkdir(directory, { recursive: true })
    const safeOriginal = basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'product-image'
    const extension = MIME_EXTENSIONS[mimeType] ?? (extname(safeOriginal).toLowerCase() || '.img')
    const path = join(directory, `product${extension}`)
    await writeFile(path, buffer, { flag: 'wx' })
    return { path, originalName: safeOriginal, mimeType }
  }

  async readBase64(path: string): Promise<string> {
    return (await readFile(path)).toString('base64')
  }

  async read(path: string): Promise<Buffer> {
    return readFile(path)
  }

  async saveGeneratedImage(jobId: string, fileName: string, buffer: Buffer): Promise<string> {
    const directory = join(this.root, 'jobs', jobId, 'generated')
    await mkdir(directory, { recursive: true })
    const safeName = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'generated.png'
    const path = join(directory, safeName.endsWith('.png') ? safeName : `${safeName}.png`)
    await writeFile(path, buffer)
    return path
  }
}
