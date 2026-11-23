import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { parseFile as parseAudioFile } from 'music-metadata'
import { getCadThumbCacheDir, getThumbCacheDir } from '../db'
import { mergeAssetExtraMeta, updateAssetThumbAndDims } from '../db/repositories'
import { extractVideoFrame } from './ffmpeg'
import { renderPsdToWebp } from './psd'
import { renderCadToWebp } from './cad'
import { isCadExt, isPsdExt, type MediaType } from '@shared/mediaTypes'

export interface ThumbJob {
  assetId: number
  filePath: string
  ext: string
  mediaType: MediaType
  duration?: number | null
}

type ThumbReadyListener = (payload: {
  assetId: number
  thumbPath: string
  width?: number | null
  height?: number | null
}) => void

const MAX_CONCURRENCY = 4

class ThumbnailQueue {
  private queue: ThumbJob[] = []
  private queuedIds = new Set<number>()
  private activeCount = 0
  private listeners = new Set<ThumbReadyListener>()

  onReady(listener: ThumbReadyListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(job: ThumbJob): void {
    if (this.queuedIds.has(job.assetId)) return
    const isSupportedCad = job.mediaType === 'model' && isCadExt(job.ext)
    if (job.mediaType !== 'image' && job.mediaType !== 'video' && job.mediaType !== 'audio' && !isSupportedCad) return
    this.queuedIds.add(job.assetId)
    this.queue.push(job)
    this.pump()
  }

  clear(): void {
    this.queue = []
    this.queuedIds.clear()
  }

  private pump(): void {
    while (this.activeCount < MAX_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.activeCount++
      this.processJob(job)
        .catch(() => undefined)
        .finally(() => {
          this.activeCount--
          this.queuedIds.delete(job.assetId)
          this.pump()
        })
    }
  }

  private async processJob(job: ThumbJob): Promise<void> {
    if (!fs.existsSync(job.filePath)) return
    const isCad = job.mediaType === 'model' && isCadExt(job.ext)
    const outFile = isCad
      ? path.join(getCadThumbCacheDir(), `${job.assetId}.webp`)
      : path.join(getThumbCacheDir(), `${job.assetId}.webp`)
    const thumbRelName = isCad ? `cad/${job.assetId}.webp` : `${job.assetId}.webp`

    let generated = false
    let width: number | null | undefined
    let height: number | null | undefined

    if (isCad) {
      const res = await renderCadToWebp(job.filePath, outFile)
      generated = res.ok && fs.existsSync(outFile)
      width = res.width
      height = res.height
      if (res.meta) {
        mergeAssetExtraMeta(job.assetId, res.meta)
      }
    } else if (job.mediaType === 'image') {
      if (isPsdExt(job.ext)) {
        const res = await renderPsdToWebp(job.filePath, outFile, 480, 720, 82)
        generated = res.ok && fs.existsSync(outFile)
        width = res.width
        height = res.height
      } else {
        try {
          const img = sharp(job.filePath, { failOn: 'none', pages: 1 })
          const meta = await img.metadata()
          width = meta.width ?? null
          height = meta.height ?? null
          if (meta.orientation && meta.orientation >= 5 && meta.orientation <= 8 && width && height) {
            ;[width, height] = [height, width]
          }
          await img
            .rotate()
            .resize({ width: 480, height: 720, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(outFile)
          generated = fs.existsSync(outFile)
        } catch {
          generated = false
        }
      }
    } else if (job.mediaType === 'video') {
      generated = await extractVideoFrame(job.filePath, outFile, job.duration)
    } else if (job.mediaType === 'audio') {
      try {
        const meta = await parseAudioFile(job.filePath, { duration: false, skipCovers: false })
        const pic = meta.common.picture?.[0]
        if (pic && pic.data && pic.data.length > 0) {
          await sharp(Buffer.from(pic.data))
            .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(outFile)
          generated = fs.existsSync(outFile)
        }
      } catch {
        generated = false
      }
    }

    if (generated) {
      updateAssetThumbAndDims(job.assetId, thumbRelName, width, height)
      for (const listener of this.listeners) {
        listener({ assetId: job.assetId, thumbPath: thumbRelName, width, height })
      }
    }
  }
}

export const thumbnailQueue = new ThumbnailQueue()
