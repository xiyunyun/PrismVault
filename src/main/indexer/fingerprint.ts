import fsSync from 'fs'
import fs from 'fs/promises'
import crypto from 'crypto'

export const FULL_HASH_THRESHOLD_BYTES = 128 * 1024 // 128KB (files <= 128KB are already 100% hashed by computeFingerprint)
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

/**
 * Computes a streaming full-file SHA-256 digest to verify 100% byte-identical
 * duplicates before moving any large files (> 128KB) to the Recycle Bin.
 */
export function computeFullFileSha256(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256')
    const stream = fsSync.createReadStream(filePath, { highWaterMark: 256 * 1024 })
    let settled = false
    const finish = (val: string | null) => {
      if (settled) return
      settled = true
      resolve(val)
    }
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', () => finish(null))
    stream.on('end', () => finish(hash.digest('hex')))
  })
}
