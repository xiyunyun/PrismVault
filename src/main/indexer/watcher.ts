import fs from 'fs'
import path from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { listSourceRoots } from '../db/repositories'
import type { SourceRoot } from '@shared/types'
import { indexScanner } from './scanner'

class SourceWatcherManager {
  private watchers = new Map<number, FSWatcher>()

  initAll(): void {
    const roots = listSourceRoots()
    for (const root of roots) {
      if (root.watchEnabled) {
        this.startWatcher(root)
      }
    }
  }

  syncSource(root: SourceRoot): void {
    this.stopWatcher(root.id)
    if (root.watchEnabled) {
      this.startWatcher(root)
    }
  }

  startWatcher(root: SourceRoot): void {
    if (this.watchers.has(root.id)) return
    if (!fs.existsSync(root.path)) return

    const resolvedRoot = path.resolve(root.path)
    const exactIgnoreNames = new Set<string>()
    const suffixIgnorePatterns: string[] = []
    for (const raw of root.ignorePatterns) {
      const p = raw.trim().toLowerCase()
      if (!p) continue
      if (p.startsWith('*.')) suffixIgnorePatterns.push(p.slice(1))
      else exactIgnoreNames.add(p)
    }

    const watcher = chokidar.watch(root.path, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 800,
        pollInterval: 200
      },
      ignored: (targetPath: string) => {
        const rel = path.relative(resolvedRoot, path.resolve(targetPath))
        if (!rel || rel === '.' || rel.startsWith('..')) return false
        const segments = rel.toLowerCase().split(/[\\/]+/).filter(Boolean)
        if (segments.length === 0) return false
        for (const seg of segments) {
          if (exactIgnoreNames.has(seg)) return true
        }
        const leaf = segments[segments.length - 1]
        for (const suf of suffixIgnorePatterns) {
          if (leaf.endsWith(suf)) return true
        }
        return false
      }
    })

    watcher
      .on('add', (filePath) => {
        indexScanner.indexSingleFile(root.id, filePath).catch(() => undefined)
      })
      .on('change', (filePath) => {
        indexScanner.indexSingleFile(root.id, filePath).catch(() => undefined)
      })
      .on('unlink', (filePath) => {
        indexScanner.markFileMissing(filePath)
      })
      .on('error', () => {
        // Prevent unhandled error crash if external drive disconnects
      })

    this.watchers.set(root.id, watcher)
  }

  stopWatcher(rootId: number): void {
    const w = this.watchers.get(rootId)
    if (w) {
      w.close().catch(() => undefined)
      this.watchers.delete(rootId)
    }
  }

  stopAll(): void {
    for (const [id] of this.watchers) {
      this.stopWatcher(id)
    }
  }
}

export const watcherManager = new SourceWatcherManager()
