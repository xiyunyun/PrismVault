import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { clipboard } from 'electron'
import sharp from 'sharp'
import { parseFile as parseAudioFile } from 'music-metadata'
import {
  getClipboardDir,
  getDb,
  getDefaultClipboardDir,
  getThumbCacheDir,
  setClipboardDir
} from '../db'
import {
  assignAssetsToGroups,
  createSourceRoot,
  getAssetById,
  updateSettings
} from '../db/repositories'
import {
  classifyExtension,
  getMimeType,
  isPsdExt,
  isReadableTextExt,
  normalizeExt
} from '@shared/mediaTypes'
import type {
  Asset,
  ClipboardImportResult,
  ClipboardInspectResult,
  ClipboardStats,
  ConflictResolution,
  ImportConflictItem,
  MoveThumbCacheResult
} from '@shared/types'
import { computeFingerprint } from './fingerprint'
import { extractAssetMetadata } from './metadata'
import { renderPsdToWebp } from './psd'
import { thumbnailQueue } from './thumbnailer'

const execFileAsync = promisify(execFile)
const CLIPBOARD_ROOT_ALIAS = '剪贴板导入'
const MAX_EXPANDED_FILES = 2000

const PS_GET_DROP_LIST_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$list = [System.Windows.Forms.Clipboard]::GetFileDropList()',
  'if ($list -and $list.Count -gt 0) {',
  '  foreach ($item in $list) { Write-Output $item }',
  '}'
].join('; ')

const PS_GET_DROP_LIST_B64 = Buffer.from(PS_GET_DROP_LIST_SCRIPT, 'utf16le').toString('base64')

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

function readSingleWindowsFileNameW(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const raw = clipboard.readBuffer('FileNameW')
    if (!raw || raw.length < 4) return null
    const str = raw.toString('ucs2').replace(/\0+$/, '').trim()
    if (str && fs.existsSync(str)) {
      return str
    }
  } catch {
    // ignore
  }
  return null
}

function readUriListPaths(): string[] {
  try {
    const raw = clipboard.readBuffer('text/uri-list')
    if (!raw || raw.length === 0) return []
    const text = raw.toString('utf8')
    const paths: string[] = []
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('file://')) continue
      try {
        const u = new URL(trimmed)
        let p = decodeURIComponent(u.pathname)
        if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) {
          p = p.slice(1)
        }
        p = path.resolve(p)
        if (fs.existsSync(p)) paths.push(p)
      } catch {
        // ignore invalid URI
      }
    }
    return paths
  } catch {
    return []
  }
}

async function readAllCopiedPaths(): Promise<string[]> {
  if (process.platform === 'win32') {
    const formats = clipboard.availableFormats()
    const singleFileHint = readSingleWindowsFileNameW()
    const mightHaveFiles =
      Boolean(singleFileHint) ||
      formats.some((f) => /filename|uri-list|hdrop|shell/i.test(f))

    if (mightHaveFiles) {
      try {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', PS_GET_DROP_LIST_B64],
          { timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
        )
        const lines = stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && fs.existsSync(s))
        if (lines.length > 0) {
          return Array.from(new Set(lines.map((p) => path.resolve(p))))
        }
      } catch {
        // Fallback below
      }
    }

    const uriPaths = readUriListPaths()
    if (uriPaths.length > 0) return uriPaths
    if (singleFileHint) return [path.resolve(singleFileHint)]
    return []
  }

  return readUriListPaths()
}

async function expandToRegularFiles(
  inputPaths: string[]
): Promise<Array<{ filePath: string; size: number; modifiedAt: number }>> {
  const results: Array<{ filePath: string; size: number; modifiedAt: number }> = []
  const seen = new Set<string>()

  const walk = async (target: string): Promise<void> => {
    if (results.length >= MAX_EXPANDED_FILES) return
    let stat: fs.Stats
    try {
      stat = await fsp.stat(target)
    } catch {
      return
    }
    if (stat.isFile()) {
      const resolved = path.resolve(target)
      const key = resolved.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ filePath: resolved, size: stat.size, modifiedAt: Math.floor(stat.mtimeMs) })
      }
    } else if (stat.isDirectory()) {
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(target, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (results.length >= MAX_EXPANDED_FILES) break
        await walk(path.join(target, e.name))
      }
    }
  }

  for (const p of inputPaths) {
    if (results.length >= MAX_EXPANDED_FILES) break
    await walk(p)
  }

  return results
}

function findConflictingAsset(fileName: string, clipDir: string): Asset | null {
  const db = getDb()
  // Prefer an exact match inside the import storage folder first
  const exactInClip = path.join(clipDir, fileName)
  const inClipRow = db
    .prepare(`SELECT id FROM assets WHERE status = 'active' AND lower(file_path) = lower(?) LIMIT 1`)
    .get(exactInClip) as { id: number } | undefined
  if (inClipRow) {
    return getAssetById(Number(inClipRow.id))
  }

  // Otherwise match any active asset in the library with the exact same filename (case-insensitive)
  const sameNameRow = db
    .prepare(`SELECT id FROM assets WHERE status = 'active' AND lower(file_name) = lower(?) ORDER BY modified_at DESC LIMIT 1`)
    .get(fileName) as { id: number } | undefined
  if (sameNameRow) {
    return getAssetById(Number(sameNameRow.id))
  }
  return null
}

async function generateQuickPreviewForIncoming(
  filePath: string,
  ext: string
): Promise<{ thumbDataUrl: string | null; width: number | null; height: number | null; textSnippet: string | null }> {
  const mediaType = classifyExtension(ext)

  if (mediaType === 'image') {
    if (isPsdExt(ext)) {
      const tmpOut = path.join(os.tmpdir(), `pv_conflict_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`)
      try {
        const res = await renderPsdToWebp(filePath, tmpOut, 260, 260, 78)
        if (res.ok && fs.existsSync(tmpOut)) {
          const buf = await fsp.readFile(tmpOut)
          return {
            thumbDataUrl: `data:image/webp;base64,${buf.toString('base64')}`,
            width: res.width,
            height: res.height,
            textSnippet: null
          }
        }
      } catch {
        // ignore
      } finally {
        await fsp.unlink(tmpOut).catch(() => undefined)
      }
      return { thumbDataUrl: null, width: null, height: null, textSnippet: null }
    }

    try {
      const img = sharp(filePath, { failOn: 'none', pages: 1 })
      const meta = await img.metadata()
      let width = meta.width ?? null
      let height = meta.height ?? null
      if (meta.orientation && meta.orientation >= 5 && meta.orientation <= 8 && width && height) {
        ;[width, height] = [height, width]
      }
      const webpBuf = await img
        .rotate()
        .resize({ width: 260, height: 260, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer()
      return {
        thumbDataUrl: `data:image/webp;base64,${webpBuf.toString('base64')}`,
        width,
        height,
        textSnippet: null
      }
    } catch {
      return { thumbDataUrl: null, width: null, height: null, textSnippet: null }
    }
  }

  if (mediaType === 'audio') {
    try {
      const meta = await parseAudioFile(filePath, { duration: false, skipCovers: false })
      const pic = meta.common.picture?.[0]
      if (pic?.data?.length) {
        const webpBuf = await sharp(Buffer.from(pic.data))
          .resize({ width: 220, height: 220, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer()
        return {
          thumbDataUrl: `data:image/webp;base64,${webpBuf.toString('base64')}`,
          width: null,
          height: null,
          textSnippet: null
        }
      }
    } catch {
      // ignore
    }
  }

  if (mediaType === 'text' && isReadableTextExt(ext)) {
    let handle: fsp.FileHandle | null = null
    try {
      handle = await fsp.open(filePath, 'r')
      const buf = Buffer.alloc(1024)
      const { bytesRead } = await handle.read(buf, 0, 1024, 0)
      const snippet = buf.subarray(0, bytesRead).toString('utf8').replace(/\0/g, '').slice(0, 320)
      return { thumbDataUrl: null, width: null, height: null, textSnippet: snippet }
    } catch {
      // ignore
    } finally {
      if (handle) await handle.close().catch(() => undefined)
    }
  }

  return { thumbDataUrl: null, width: null, height: null, textSnippet: null }
}

function ensureClipboardSourceRoot(): number {
  const dir = path.resolve(getClipboardDir())
  fs.mkdirSync(dir, { recursive: true })
  const root = createSourceRoot(dir, CLIPBOARD_ROOT_ALIAS)
  return root.id
}

async function indexImportedFile(
  rootId: number,
  destPath: string,
  targetGroupId?: number | null
): Promise<Asset | null> {
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

  return getAssetById(newId)
}

async function replaceExistingAssetFile(
  existing: Asset,
  srcPath: string,
  targetGroupId?: number | null
): Promise<Asset | null> {
  const sameDiskFile = path.resolve(srcPath).toLowerCase() === path.resolve(existing.filePath).toLowerCase()

  if (!sameDiskFile) {
    fs.mkdirSync(path.dirname(existing.filePath), { recursive: true })
    await fsp.copyFile(srcPath, existing.filePath)
    const srcStat = await fsp.stat(srcPath)
    await fsp.utimes(existing.filePath, srcStat.atime, srcStat.mtime).catch(() => undefined)
  }

  // Delete stale cached thumb so a fresh one is generated immediately
  if (existing.thumbPath) {
    const oldThumb = path.join(getThumbCacheDir(), existing.thumbPath)
    await fsp.unlink(oldThumb).catch(() => undefined)
  }

  const stat = await fsp.stat(existing.filePath)
  const ext = normalizeExt(path.extname(existing.filePath))
  const mediaType = classifyExtension(ext)
  const mimeType = getMimeType(ext)
  const fp = await computeFingerprint(existing.filePath, stat.size)
  const meta = await extractAssetMetadata(existing.filePath, ext, mediaType)

  const db = getDb()
  db.prepare(
    `UPDATE assets
     SET file_size = ?, modified_at = ?, fingerprint = ?, media_type = ?, mime_type = ?,
         width = ?, height = ?, duration = ?, extra_meta = ?, text_snippet = ?,
         thumb_path = NULL, status = 'active', indexed_at = ?
     WHERE id = ?`
  ).run(
    stat.size,
    Math.floor(stat.mtimeMs),
    fp,
    mediaType,
    mimeType,
    meta.width,
    meta.height,
    meta.duration,
    meta.extraMeta ? JSON.stringify(meta.extraMeta) : null,
    meta.textSnippet,
    Date.now(),
    existing.id
  )

  if (targetGroupId != null) {
    assignAssetsToGroups([existing.id], [targetGroupId])
  }

  thumbnailQueue.enqueue({
    assetId: existing.id,
    filePath: existing.filePath,
    ext,
    mediaType,
    duration: meta.duration
  })

  return getAssetById(existing.id)
}

/**
 * Inspects an arbitrary list of local file/folder paths (used by both Drag-and-Drop and Clipboard files).
 * Detects filename conflicts against existing assets and builds quick preview thumbnails for side-by-side comparison.
 */
export async function inspectImportPaths(inputPaths: string[]): Promise<ClipboardInspectResult> {
  if (!inputPaths || inputPaths.length === 0) {
    return {
      hasContent: false,
      kind: 'empty',
      fileCount: 0,
      totalBytes: 0,
      conflicts: [],
      reason: '没有可导入的有效文件'
    }
  }

  const files = await expandToRegularFiles(inputPaths)
  if (files.length === 0) {
    return {
      hasContent: false,
      kind: 'empty',
      fileCount: 0,
      totalBytes: 0,
      conflicts: [],
      reason: '所选内容中没有可导入的文件'
    }
  }

  const clipDir = path.resolve(getClipboardDir())
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const conflicts: ImportConflictItem[] = []

  for (const f of files) {
    const fileName = path.basename(f.filePath)
    const existing = findConflictingAsset(fileName, clipDir)
    if (existing) {
      const ext = normalizeExt(path.extname(fileName))
      const quick = await generateQuickPreviewForIncoming(f.filePath, ext)
      conflicts.push({
        incomingPath: f.filePath,
        fileName,
        incomingSize: f.size,
        incomingModifiedAt: f.modifiedAt,
        incomingWidth: quick.width,
        incomingHeight: quick.height,
        incomingMediaType: classifyExtension(ext),
        incomingExt: ext,
        incomingThumbDataUrl: quick.thumbDataUrl,
        incomingTextSnippet: quick.textSnippet,
        existingAsset: existing
      })
    }
  }

  return {
    hasContent: true,
    kind: 'files',
    fileCount: files.length,
    totalBytes,
    filePaths: files.map((f) => f.filePath),
    conflicts
  }
}

/**
 * Inspects the OS clipboard without writing any files yet.
 */
export async function inspectClipboard(): Promise<ClipboardInspectResult> {
  const rawPaths = await readAllCopiedPaths()
  if (rawPaths.length > 0) {
    return inspectImportPaths(rawPaths)
  }

  const nativeImg = clipboard.readImage()
  if (nativeImg && !nativeImg.isEmpty()) {
    const pngBuf = nativeImg.toPNG()
    if (pngBuf && pngBuf.length > 0) {
      return {
        hasContent: true,
        kind: 'image',
        fileCount: 1,
        totalBytes: pngBuf.length,
        conflicts: []
      }
    }
  }

  return {
    hasContent: false,
    kind: 'empty',
    fileCount: 0,
    totalBytes: 0,
    conflicts: [],
    reason: '剪贴板中没有可导入的图片或文件'
  }
}

/**
 * Commits file or bitmap import with per-file conflict resolution ('replace' | 'skip' | 'keep_both').
 */
export async function commitClipboardImport(opts: {
  targetGroupId?: number | null
  filePaths?: string[]
  resolutions?: Record<string, ConflictResolution>
}): Promise<ClipboardImportResult> {
  const clipDir = path.resolve(getClipboardDir())
  fs.mkdirSync(clipDir, { recursive: true })
  const rootId = ensureClipboardSourceRoot()

  const resultAssets: Asset[] = []
  let importedCount = 0
  let replacedCount = 0
  let skippedCount = 0

  if (Array.isArray(opts.filePaths) && opts.filePaths.length > 0) {
    for (const srcPath of opts.filePaths) {
      try {
        if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
          skippedCount++
          continue
        }

        const fileName = path.basename(srcPath)
        const existing = findConflictingAsset(fileName, clipDir)
        const resolution = opts.resolutions?.[path.resolve(srcPath).toLowerCase()] ?? opts.resolutions?.[srcPath.toLowerCase()]

        if (existing && resolution === 'skip') {
          skippedCount++
          continue
        }

        if (existing && resolution === 'replace') {
          const updated = await replaceExistingAssetFile(existing, srcPath, opts.targetGroupId)
          if (updated) {
            resultAssets.push(updated)
            replacedCount++
          }
          continue
        }

        // Default or 'keep_both': copy to unique non-colliding path in import folder
        const destPath = makeUniquePath(clipDir, fileName)
        await fsp.copyFile(srcPath, destPath)
        const srcStat = await fsp.stat(srcPath)
        await fsp.utimes(destPath, srcStat.atime, srcStat.mtime).catch(() => undefined)
        const asset = await indexImportedFile(rootId, destPath, opts.targetGroupId)
        if (asset) {
          resultAssets.push(asset)
          importedCount++
        }
      } catch {
        skippedCount++
      }
    }

    if (resultAssets.length === 0 && skippedCount === 0) {
      return {
        ok: false,
        assets: [],
        importedCount: 0,
        replacedCount: 0,
        skippedCount,
        reason: '没有成功导入任何文件'
      }
    }

    return {
      ok: true,
      assets: resultAssets,
      importedCount,
      replacedCount,
      skippedCount
    }
  }

  // Direct bitmap image import
  const nativeImg = clipboard.readImage()
  if (!nativeImg || nativeImg.isEmpty()) {
    return {
      ok: false,
      assets: [],
      importedCount: 0,
      replacedCount: 0,
      skippedCount: 0,
      reason: '剪贴板中没有可导入的图片'
    }
  }

  const pngBuf = nativeImg.toPNG()
  if (!pngBuf || pngBuf.length === 0) {
    return {
      ok: false,
      assets: [],
      importedCount: 0,
      replacedCount: 0,
      skippedCount: 0,
      reason: '无法解码剪贴板图片数据'
    }
  }

  const destPath = makeUniquePath(clipDir, formatTimestampName())
  await fsp.writeFile(destPath, pngBuf)
  const asset = await indexImportedFile(rootId, destPath, opts.targetGroupId)
  if (asset) {
    resultAssets.push(asset)
    importedCount = 1
  }

  return {
    ok: resultAssets.length > 0,
    assets: resultAssets,
    importedCount,
    replacedCount: 0,
    skippedCount: 0
  }
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
