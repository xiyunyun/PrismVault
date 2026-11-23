import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { getDb } from '../db'
import {
  getAllSettings,
  getSourceRootById,
  listSourceRoots,
  updateSourceRoot
} from '../db/repositories'
import { classifyExtension, getMimeType, normalizeExt } from '@shared/mediaTypes'
import type { ScanProgress, SourceRoot } from '@shared/types'
import { computeFingerprint } from './fingerprint'
import { extractAssetMetadata } from './metadata'
import { thumbnailQueue } from './thumbnailer'

type ProgressListener = (progress: ScanProgress) => void
type ChangedListener = () => void

class IndexScanner {
  private isRunning = false
  private progressListeners = new Set<ProgressListener>()
  private changedListeners = new Set<ChangedListener>()
  private lastProgress: ScanProgress = {
    running: false,
    scanned: 0,
    added: 0,
    updated: 0,
    relinked: 0,
    missing: 0
  }

  onProgress(cb: ProgressListener): () => void {
    this.progressListeners.add(cb)
    return () => this.progressListeners.delete(cb)
  }

  onAssetsChanged(cb: ChangedListener): () => void {
    this.changedListeners.add(cb)
    return () => this.changedListeners.delete(cb)
  }

  getProgress(): ScanProgress {
    return this.lastProgress
  }

  private emitProgress(progress: ScanProgress): void {
    this.lastProgress = progress
    for (const cb of this.progressListeners) cb(progress)
  }

  private emitChanged(): void {
    for (const cb of this.changedListeners) cb()
  }

  private matchesIgnore(name: string, patterns: string[]): boolean {
    const lower = name.toLowerCase()
    for (const raw of patterns) {
      const p = raw.trim().toLowerCase()
      if (!p) continue
      if (p.startsWith('*.')) {
        if (lower.endsWith(p.slice(1))) return true
      } else if (lower === p) {
        return true
      }
    }
    return false
  }

  async scanSource(rootId?: number): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    const roots: SourceRoot[] = rootId != null
      ? ([getSourceRootById(rootId)].filter(Boolean) as SourceRoot[])
      : listSourceRoots()

    const progress: ScanProgress = {
      running: true,
      scanned: 0,
      added: 0,
      updated: 0,
      relinked: 0,
      missing: 0
    }
    this.emitProgress({ ...progress })

    const settings = getAllSettings()
    let anyChanges = false

    try {
      for (const root of roots) {
        progress.rootId = root.id
        progress.rootName = root.alias
        this.emitProgress({ ...progress })

        const changed = await this.scanSingleRoot(root, settings.includeOtherFiles, progress)
        if (changed) anyChanges = true
      }
    } finally {
      this.isRunning = false
      progress.running = false
      progress.currentFile = undefined
      this.emitProgress({ ...progress })
      if (anyChanges) this.emitChanged()
    }
  }

  private async scanSingleRoot(
    root: SourceRoot,
    includeOtherFiles: boolean,
    progress: ScanProgress
  ): Promise<boolean> {
    const db = getDb()
    let changed = false

    // If drive or root folder is currently offline (e.g. external USB unplugged), mark its active assets missing
    if (!fs.existsSync(root.path)) {
      const res = db
        .prepare(`UPDATE assets SET status = 'missing' WHERE root_id = ? AND status = 'active'`)
        .run(root.id)
      const count = Number(res.changes)
      if (count > 0) {
        progress.missing += count
        changed = true
      }
      return changed
    }

    // Load existing assets in this root for O(1) incremental diff
    const existingRows = db
      .prepare(
        `SELECT id, file_path, file_size, modified_at, fingerprint, status, thumb_path, media_type, ext, duration
         FROM assets WHERE root_id = ?`
      )
      .all(root.id) as Array<{
      id: number
      file_path: string
      file_size: number
      modified_at: number
      fingerprint: string | null
      status: string
      thumb_path: string | null
      media_type: string
      ext: string
      duration: number | null
    }>

    const byPath = new Map(existingRows.map((r) => [r.file_path.toLowerCase(), r]))
    const seenPaths = new Set<string>()
    const newFiles: Array<{
      filePath: string
      fileName: string
      ext: string
      stat: fs.Stats
    }> = []

    // Walk directory tree recursively
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (this.matchesIgnore(entry.name, root.ignorePatterns)) continue
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile()) {
          const ext = normalizeExt(path.extname(entry.name))
          const mediaType = classifyExtension(ext)
          if (mediaType === 'other' && !includeOtherFiles) continue

          let stat: fs.Stats
          try {
            stat = await fsp.stat(fullPath)
          } catch {
            continue
          }

          progress.scanned++
          if (progress.scanned % 25 === 0) {
            progress.currentFile = entry.name
            this.emitProgress({ ...progress })
          }

          const key = fullPath.toLowerCase()
          seenPaths.add(key)

          const existing = byPath.get(key)
          if (existing) {
            const mtimeMs = Math.floor(stat.mtimeMs)
            const size = stat.size
            // Restore if previously missing
            if (existing.status === 'missing') {
              db.prepare(`UPDATE assets SET status = 'active' WHERE id = ?`).run(existing.id)
              changed = true
            }
            // Fast-skip unchanged files
            if (Number(existing.file_size) === size && Math.abs(Number(existing.modified_at) - mtimeMs) <= 1000) {
              if (!existing.thumb_path && (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio')) {
                thumbnailQueue.enqueue({
                  assetId: Number(existing.id),
                  filePath: fullPath,
                  ext,
                  mediaType,
                  duration: existing.duration
                })
              }
              continue
            }

            // File modified in-place -> update metadata & fingerprint
            const fp = await computeFingerprint(fullPath, size)
            const meta = await extractAssetMetadata(fullPath, ext, mediaType)
            db.prepare(
              `UPDATE assets
               SET file_size = ?, created_at = ?, modified_at = ?, fingerprint = ?,
                   width = ?, height = ?, duration = ?, extra_meta = ?, text_snippet = ?,
                   thumb_path = NULL, indexed_at = ?
               WHERE id = ?`
            ).run(
              size,
              Math.floor(stat.birthtimeMs || stat.ctimeMs),
              mtimeMs,
              fp,
              meta.width,
              meta.height,
              meta.duration,
              meta.extraMeta ? JSON.stringify(meta.extraMeta) : null,
              meta.textSnippet,
              Date.now(),
              existing.id
            )
            progress.updated++
            changed = true
            thumbnailQueue.enqueue({
              assetId: Number(existing.id),
              filePath: fullPath,
              ext,
              mediaType,
              duration: meta.duration
            })
          } else {
            newFiles.push({ filePath: fullPath, fileName: entry.name, ext, stat })
          }
        }
      }
    }

    await walk(root.path)

    // Step 1: Identify assets in this root that were not seen on disk
    const disappearedIds: number[] = []
    for (const row of existingRows) {
      if (!includeOtherFiles && row.media_type === 'other') continue
      if (row.status === 'active' && !seenPaths.has(row.file_path.toLowerCase())) {
        disappearedIds.push(Number(row.id))
      }
    }

    if (disappearedIds.length > 0) {
      const markStmt = db.prepare(`UPDATE assets SET status = 'missing' WHERE id = ?`)
      db.exec('BEGIN')
      try {
        for (const id of disappearedIds) markStmt.run(id)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      changed = true
    }

    // Step 2: Build lookup of all currently missing assets across the entire library for fingerprint relink
    const missingCandidates = db
      .prepare(`SELECT id, fingerprint, file_size FROM assets WHERE status = 'missing' AND fingerprint IS NOT NULL`)
      .all() as Array<{ id: number; fingerprint: string; file_size: number }>

    const missingByFp = new Map<string, number[]>()
    for (const m of missingCandidates) {
      const list = missingByFp.get(m.fingerprint) ?? []
      list.push(Number(m.id))
      missingByFp.set(m.fingerprint, list)
    }

    // Step 3: Process new files with bounded concurrency (4x) + batched SQLite transactions
    const SCAN_BATCH_SIZE = 40
    const SCAN_CONCURRENCY = 4
    const now = Date.now()
    let lastEmitAt = 0

    const relinkStmt = db.prepare(
      `UPDATE assets
       SET root_id = ?, file_path = ?, file_name = ?, ext = ?, media_type = ?, mime_type = ?,
           file_size = ?, created_at = ?, modified_at = ?, status = 'active', indexed_at = ?
       WHERE id = ?`
    )
    const insertStmt = db.prepare(
      `INSERT INTO assets (
        root_id, file_path, file_name, ext, media_type, mime_type,
        file_size, created_at, modified_at, fingerprint,
        width, height, duration, extra_meta, note, thumb_path, text_snippet, status, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, 'active', ?)`
    )

    for (let batchStart = 0; batchStart < newFiles.length; batchStart += SCAN_BATCH_SIZE) {
      const slice = newFiles.slice(batchStart, batchStart + SCAN_BATCH_SIZE)

      type PreparedNewFile = {
        item: (typeof newFiles)[number]
        mediaType: ReturnType<typeof classifyExtension>
        mimeType: string
        fp: string | null
        relinkId?: number
        meta: Awaited<ReturnType<typeof extractAssetMetadata>> | null
      }

      const prepared: PreparedNewFile[] = new Array(slice.length)
      let cursor = 0

      // Pre-compute fingerprints concurrently (relink candidates skip full metadata re-extraction!)
      const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, slice.length) }, async () => {
        while (true) {
          const idx = cursor++
          if (idx >= slice.length) break
          const item = slice[idx]
          const size = item.stat.size
          const mediaType = classifyExtension(item.ext)
          const mimeType = getMimeType(item.ext)
          const fp = await computeFingerprint(item.filePath, size)

          // Reserve relink match synchronously on single-threaded JS event loop
          const candidateList = fp ? missingByFp.get(fp) : undefined
          const relinkId = candidateList && candidateList.length > 0 ? candidateList.shift() : undefined

          const meta =
            relinkId == null ? await extractAssetMetadata(item.filePath, item.ext, mediaType) : null

          prepared[idx] = { item, mediaType, mimeType, fp, relinkId, meta }
        }
      })
      await Promise.all(workers)

      const pendingThumbJobs: Array<{
        assetId: number
        filePath: string
        ext: string
        mediaType: ReturnType<typeof classifyExtension>
        duration: number | null
      }> = []

      // Commit the whole batch inside ONE SQLite transaction (10-50x faster than per-row autocommit)
      db.exec('BEGIN')
      try {
        for (const p of prepared) {
          if (!p) continue
          const { item, mediaType, mimeType, fp, relinkId, meta } = p
          const size = item.stat.size
          const mtimeMs = Math.floor(item.stat.mtimeMs)
          const ctimeMs = Math.floor(item.stat.birthtimeMs || item.stat.ctimeMs)

          if (relinkId != null) {
            relinkStmt.run(
              root.id,
              item.filePath,
              item.fileName,
              item.ext,
              mediaType,
              mimeType,
              size,
              ctimeMs,
              mtimeMs,
              now,
              relinkId
            )
            progress.relinked++
            changed = true
            continue
          }

          try {
            const res = insertStmt.run(
              root.id,
              item.filePath,
              item.fileName,
              item.ext,
              mediaType,
              mimeType,
              size,
              ctimeMs,
              mtimeMs,
              fp,
              meta?.width ?? null,
              meta?.height ?? null,
              meta?.duration ?? null,
              meta?.extraMeta ? JSON.stringify(meta.extraMeta) : null,
              meta?.textSnippet ?? null,
              now
            )
            const newId = Number(res.lastInsertRowid)
            progress.added++
            changed = true
            pendingThumbJobs.push({
              assetId: newId,
              filePath: item.filePath,
              ext: item.ext,
              mediaType,
              duration: meta?.duration ?? null
            })
          } catch {
            // Ignore unique path race condition
          }
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }

      for (const job of pendingThumbJobs) {
        thumbnailQueue.enqueue(job)
      }

      const tNow = Date.now()
      if (tNow - lastEmitAt >= 80 || batchStart + SCAN_BATCH_SIZE >= newFiles.length) {
        lastEmitAt = tNow
        const lastItem = slice[slice.length - 1]
        if (lastItem) progress.currentFile = lastItem.fileName
        this.emitProgress({ ...progress })
      }
    }

    // Count remaining newly missing
    const stillMissing = disappearedIds.length - progress.relinked
    if (stillMissing > 0) {
      progress.missing += stillMissing
    }

    updateSourceRoot(root.id, { lastScannedAt: Date.now() })
    return changed
  }

  /**
   * Single-file upsert triggered by real-time file watcher.
   */
  async indexSingleFile(rootId: number, filePath: string): Promise<void> {
    const root = getSourceRootById(rootId)
    if (!root) return
    const fileName = path.basename(filePath)
    if (this.matchesIgnore(fileName, root.ignorePatterns)) return

    const ext = normalizeExt(path.extname(fileName))
    const mediaType = classifyExtension(ext)
    const settings = getAllSettings()
    if (mediaType === 'other' && !settings.includeOtherFiles) return

    let stat: fs.Stats
    try {
      stat = await fsp.stat(filePath)
      if (!stat.isFile()) return
    } catch {
      return
    }

    const db = getDb()
    const existing = db.prepare('SELECT id, file_size, modified_at FROM assets WHERE file_path = ?').get(filePath) as
      | { id: number; file_size: number; modified_at: number }
      | undefined

    const size = stat.size
    const mtimeMs = Math.floor(stat.mtimeMs)
    const ctimeMs = Math.floor(stat.birthtimeMs || stat.ctimeMs)
    const fp = await computeFingerprint(filePath, size)
    const meta = await extractAssetMetadata(filePath, ext, mediaType)
    const mimeType = getMimeType(ext)
    const now = Date.now()

    if (existing) {
      db.prepare(
        `UPDATE assets
         SET file_size = ?, modified_at = ?, fingerprint = ?, width = ?, height = ?, duration = ?,
             extra_meta = ?, text_snippet = ?, thumb_path = NULL, status = 'active', indexed_at = ?
         WHERE id = ?`
      ).run(
        size,
        mtimeMs,
        fp,
        meta.width,
        meta.height,
        meta.duration,
        meta.extraMeta ? JSON.stringify(meta.extraMeta) : null,
        meta.textSnippet,
        now,
        existing.id
      )
      thumbnailQueue.enqueue({ assetId: Number(existing.id), filePath, ext, mediaType, duration: meta.duration })
      this.emitChanged()
      return
    }

    // Check if matches a missing asset (rename/move inside watched dir)
    if (fp) {
      const missingRow = db
        .prepare(`SELECT id FROM assets WHERE status = 'missing' AND fingerprint = ? LIMIT 1`)
        .get(fp) as { id: number } | undefined
      if (missingRow) {
        db.prepare(
          `UPDATE assets
           SET root_id = ?, file_path = ?, file_name = ?, ext = ?, media_type = ?, mime_type = ?,
               file_size = ?, created_at = ?, modified_at = ?, status = 'active', indexed_at = ?
           WHERE id = ?`
        ).run(rootId, filePath, fileName, ext, mediaType, mimeType, size, ctimeMs, mtimeMs, now, missingRow.id)
        this.emitChanged()
        return
      }
    }

    try {
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
          filePath,
          fileName,
          ext,
          mediaType,
          mimeType,
          size,
          ctimeMs,
          mtimeMs,
          fp,
          meta.width,
          meta.height,
          meta.duration,
          meta.extraMeta ? JSON.stringify(meta.extraMeta) : null,
          meta.textSnippet,
          now
        )
      thumbnailQueue.enqueue({
        assetId: Number(res.lastInsertRowid),
        filePath,
        ext,
        mediaType,
        duration: meta.duration
      })
      this.emitChanged()
    } catch {
      // ignore race
    }
  }

  markFileMissing(filePath: string): void {
    const db = getDb()
    const res = db
      .prepare(`UPDATE assets SET status = 'missing' WHERE file_path = ? AND status = 'active'`)
      .run(filePath)
    if (Number(res.changes) > 0) {
      this.emitChanged()
    }
  }
}

export const indexScanner = new IndexScanner()
