import fs from 'fs/promises'
import crypto from 'crypto'

const CHUNK_SIZE = 64 * 1024 // 64KB

/**
 * Fast content fingerprint: SHA-1 of (fileSize + first 64KB + last 64KB).
 * Executes in <1ms even on multi-GB video files, allowing reliable relinking
 * if the user moves or renames files on disk.
 */
export async function computeFingerprint(filePath: string, fileSize: number): Promise<string | null> {
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const hash = crypto.createHash('sha1')
    hash.update(String(fileSize))
    hash.update(':')

    if (fileSize === 0) {
      return hash.digest('hex')
    }

    if (fileSize <= CHUNK_SIZE * 2) {
      const buf = Buffer.alloc(fileSize)
      const { bytesRead } = await handle.read(buf, 0, fileSize, 0)
      hash.update(buf.subarray(0, bytesRead))
    } else {
      const head = Buffer.alloc(CHUNK_SIZE)
      const tail = Buffer.alloc(CHUNK_SIZE)
      const headRes = await handle.read(head, 0, CHUNK_SIZE, 0)
      const tailRes = await handle.read(tail, 0, CHUNK_SIZE, Math.max(0, fileSize - CHUNK_SIZE))
      hash.update(head.subarray(0, headRes.bytesRead))
      hash.update(tail.subarray(0, tailRes.bytesRead))
    }

    return hash.digest('hex')
  } catch {
    return null
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined)
    }
  }
}
