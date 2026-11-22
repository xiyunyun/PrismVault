import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { clipboard } from 'electron'
import {
  getClipboardDir,
  getDb,
  getDefaultClipboardDir,
  setClipboardDir
} from '../db'
import {
  assignAssetsToGroups,
  createSourceRoot,
  getAssetById,
  updateSettings
} from '../db/repositories'
import { classifyExtension, getMimeType, normalizeExt } from '@shared/mediaTypes'
import type { Asset, ClipboardStats, MoveThumbCacheResult } from '@shared/types'
import { computeFingerprint } from './fingerprint'
import { extractAssetMetadata } from './metadata'
import { thumbnailQueue } from './thumbnailer'

const CLIPBOARD_ROOT_ALIAS = '剪贴板导入'

function formatTimestampName(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `Clipboard_${y}-${m}-${d}_${hh}-${mm}-${ss}_${ms}.png`
}

function makeUniquePath(dir: string, desiredName: string): string {
  const parsed = path.parse(desiredName)
  let candidate = path.join(dir, desiredName)
  let counter = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name} (${counter})${parsed.ext}`)
    counter++
  }
  return candidate
}

function readWindowsCopiedFilePath(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const raw = clipboard.readBuffer('FileNameW')
    if (!raw || raw.length < 4) return null
    const str = raw.toString('ucs2').replace(/\0+$/, '').trim()
    if (str && fs.existsSync(str) && fs.statSync(str).isFile()) {
      return str
    }
  } catch {
    // ignore
  }
  return null
}

function ensureClipboardSourceRoot(): number {
  const dir = path.resolve(getClipboardDir())
  fs.mkdirSync(dir, { recursive: true })
  const root = createSourceRoot(dir, CLIPBOARD_ROOT_ALIAS)
  return root.id
}

export async function pasteImageFromClipboard(
  targetGroupId?: number | null
): Promise<{ ok: boolean; asset?: Asset; reason?: string }> {
  const clipDir = path.resolve(getClipboardDir())
  fs.mkdirSync(clipDir, { recursive: true })

  let destPath: string | null = null

  // 1. Try reading bitmap image directly from clipboard (screenshots, copy image from browser/Photoshop)
  const nativeImg = clipboard.readImage()
  if (nativeImg && !nativeImg.isEmpty()) {
    const pngBuf = nativeImg.toPNG()
    if (pngBuf && pngBuf.length > 0) {
      destPath = makeUniquePath(clipDir, formatTimestampName())
      await fsp.writeFile(destPath, pngBuf)
    }
  }

  // 2. Fallback: check if user Ctrl+C'd an image file in Windows Explorer
  if (!destPath) {
    const copiedFile = readWindowsCopiedFilePath()
    if (copiedFile) {
      const ext = normalizeExt(path.extname(copiedFile))
      if (classifyExtension(ext) === 'image') {
        destPath = makeUniquePath(clipDir, path.basename(copiedFile))
        await fsp.copyFile(copiedFile, destPath)
      }
    }
  }

  if (!destPath) {
    return { ok: false, reason: '剪贴板中没有可导入的图片' }
  }

  const rootId = ensureClipboardSourceRoot()
  const stat = await fsp.stat(destPath)
  const fileName = path.basename(destPath)
  const ext = normalizeExt(path.extname(fileName))
  const mediaType = classifyExtension(ext)
  const mimeType = getMimeType(ext)
  const fp = await computeFingerprint(destPath, stat.size)
  const meta = await extractAssetMetadata(destPath, ext, mediaType)
  const now = Date.now()

  const db = getDb()
  const res = db
    .prepare(
      `INSERT INTO assets (
        root_id, file_path, file_name, ext, media_type, mime_type,
        file_size, created_at, modified_at, fingerprint,
        width, height, duration, extra_meta, note, thumb_path, text_snippet, status, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, 'active', ?)`
    )
    .run(
      rootId,
      destPath,
      fileName,
      ext,
      mediaType,
      mimeType,
      stat.size,
      Math.floor(stat.birthtimeMs || stat.ctimeMs),
      Math.floor(stat.mtimeMs),
      fp,
      meta.width,
      meta.height,
      meta.duration,
      meta.extraMeta ? JSON.stringify(meta.extraMeta) : null,
      meta.textSnippet,
      now
    )

  const newId = Number(res.lastInsertRowid)
  if (targetGroupId != null) {
    assignAssetsToGroups([newId], [targetGroupId])
  }

  thumbnailQueue.enqueue({
    assetId: newId,
    filePath: destPath,
    ext,
    mediaType,
    duration: meta.duration
  })

  const asset = getAssetById(newId)
  return { ok: true, asset: asset ?? undefined }
}

export async function getClipboardStats(): Promise<ClipboardStats> {
  const dir = path.resolve(getClipboardDir())
  const defaultDir = path.resolve(getDefaultClipboardDir())
  let fileCount = 0
  let totalBytes = 0

  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      try {
        const st = await fsp.stat(path.join(dir, e.name))
        fileCount++
        totalBytes += st.size
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return {
    dir,
    isCustom: dir.toLowerCase() !== defaultDir.toLowerCase(),
    fileCount,
    totalBytes
  }
}

export async function migrateClipboardDir(targetDir: string, isResetToDefault = false): Promise<MoveThumbCacheResult> {
  const oldDir = path.resolve(getClipboardDir())
  const newDir = path.resolve(isResetToDefault ? getDefaultClipboardDir() : targetDir)
  fs.mkdirSync(newDir, { recursive: true })

  let movedCount = 0
  let failedCount = 0
  const movedMap = new Map<string, string>()

  if (oldDir.toLowerCase() !== newDir.toLowerCase() && fs.existsSync(oldDir)) {
    const entries = await fsp.readdir(oldDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const src = path.join(oldDir, entry.name)
      const dst = makeUniquePath(newDir, entry.name)
      try {
        await fsp.copyFile(src, dst)
        const srcStat = await fsp.stat(src)
        const dstStat = await fsp.stat(dst)
        if (dstStat.size === srcStat.size) {
          await fsp.utimes(dst, srcStat.atime, srcStat.mtime).catch(() => undefined)
          await fsp.unlink(src).catch(() => undefined)
          movedMap.set(src.toLowerCase(), dst)
          movedCount++
        } else {
          failedCount++
        }
      } catch {
        failedCount++
      }
    }
  }

  // Update DB source_root path & asset file_paths atomically so notes/groups remain 100% intact
  const db = getDb()
  const existingOldRoot = db.prepare('SELECT id FROM source_roots WHERE lower(path) = lower(?)').get(oldDir) as
    | { id: number }
    | undefined
  const existingNewRoot = db.prepare('SELECT id FROM source_roots WHERE lower(path) = lower(?)').get(newDir) as
    | { id: number }
    | undefined

  db.exec('BEGIN')
  try {
    let targetRootId: number | null = existingNewRoot ? Number(existingNewRoot.id) : null
    if (existingOldRoot) {
      if (targetRootId && targetRootId !== Number(existingOldRoot.id)) {
        // Merge old clipboard assets into existing target root, then remove old root row
        db.prepare('UPDATE assets SET root_id = ? WHERE root_id = ?').run(targetRootId, existingOldRoot.id)
        db.prepare('DELETE FROM source_roots WHERE id = ?').run(existingOldRoot.id)
      } else {
        db.prepare('UPDATE source_roots SET path = ? WHERE id = ?').run(newDir, existingOldRoot.id)
        targetRootId = Number(existingOldRoot.id)
      }
    }

    if (movedMap.size > 0) {
      const updateAssetPath = db.prepare('UPDATE assets SET file_path = ?, file_name = ? WHERE lower(file_path) = ?')
      for (const [oldLower, newAbs] of movedMap.entries()) {
        updateAssetPath.run(newAbs, path.basename(newAbs), oldLower)
      }
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  setClipboardDir(isResetToDefault ? '' : newDir)
  updateSettings({ clipboardDir: isResetToDefault ? '' : newDir })

  return { oldDir, newDir, movedCount, failedCount }
}
