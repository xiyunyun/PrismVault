import fs from 'fs/promises'
import sharp from 'sharp'
import { parseFile as parseAudioFile } from 'music-metadata'
import { isCadExt, isPsdExt, isReadableTextExt, type MediaType } from '@shared/mediaTypes'
import type { AssetExtraMeta } from '@shared/types'
import { probeVideo } from './ffmpeg'
import { extractPsdMetadata } from './psd'
import { extractCadHeaderVersion } from './cad'

export interface ExtractedMetadata {
  width: number | null
  height: number | null
  duration: number | null
  extraMeta: AssetExtraMeta | null
  textSnippet: string | null
}

const MAX_SNIPPET_BYTES = 4096

export async function extractAssetMetadata(
  filePath: string,
  ext: string,
  mediaType: MediaType
): Promise<ExtractedMetadata> {
  if (mediaType === 'image') {
    if (isPsdExt(ext)) {
      const psd = await extractPsdMetadata(filePath)
      return {
        width: psd.width,
        height: psd.height,
        duration: null,
        extraMeta: {
          format: ext.replace('.', '').toUpperCase(),
          layerCount: psd.layerCount,
          layerNames: psd.layerNames.length > 0 ? psd.layerNames : undefined,
          colorMode: psd.colorMode,
          bitsPerChannel: psd.bitsPerChannel
        },
        textSnippet: null
      }
    }
    try {
      const meta = await sharp(filePath, { failOn: 'none' }).metadata()
      let width = meta.width ?? null
      let height = meta.height ?? null
      // Respect EXIF orientation 5..8 where width & height are swapped
      if (meta.orientation && meta.orientation >= 5 && meta.orientation <= 8 && width && height) {
        ;[width, height] = [height, width]
      }
      return {
        width,
        height,
        duration: null,
        extraMeta: meta.format ? { format: meta.format } : null,
        textSnippet: null
      }
    } catch {
      return { width: null, height: null, duration: null, extraMeta: null, textSnippet: null }
    }
  }

  if (mediaType === 'video') {
    const info = await probeVideo(filePath)
    if (!info) {
      return { width: null, height: null, duration: null, extraMeta: null, textSnippet: null }
    }
    return {
      width: info.width,
      height: info.height,
      duration: info.duration,
      extraMeta: {
        fps: info.fps,
        videoCodec: info.videoCodec,
        audioCodec: info.audioCodec,
        bitrate: info.bitrate
      },
      textSnippet: null
    }
  }

  if (mediaType === 'audio') {
    try {
      const meta = await parseAudioFile(filePath, { duration: true, skipCovers: true })
      const duration = meta.format.duration ?? null
      return {
        width: null,
        height: null,
        duration: duration != null && Number.isFinite(duration) ? duration : null,
        extraMeta: {
          bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate) : undefined,
          sampleRate: meta.format.sampleRate,
          channels: meta.format.numberOfChannels,
          audioCodec: meta.format.codec,
          artist: meta.common.artist,
          album: meta.common.album,
          title: meta.common.title
        },
        textSnippet: null
      }
    } catch {
      return { width: null, height: null, duration: null, extraMeta: null, textSnippet: null }
    }
  }

  if (mediaType === 'text' && isReadableTextExt(ext)) {
    let handle: fs.FileHandle | null = null
    try {
      handle = await fs.open(filePath, 'r')
      const buf = Buffer.alloc(MAX_SNIPPET_BYTES)
      const { bytesRead } = await handle.read(buf, 0, MAX_SNIPPET_BYTES, 0)
      const raw = buf.subarray(0, bytesRead).toString('utf8').replace(/\0/g, '')
      const lines = raw.split(/\r?\n/)
      const snippet = lines.slice(0, 12).join('\n').slice(0, 600)
      return {
        width: null,
        height: null,
        duration: null,
        extraMeta: {
          lineCount: lines.length,
          charCount: raw.length
        },
        textSnippet: snippet
      }
    } catch {
      return { width: null, height: null, duration: null, extraMeta: null, textSnippet: null }
    } finally {
      if (handle) await handle.close().catch(() => undefined)
    }
  }

  if (mediaType === 'model') {
    const fmt = ext.replace('.', '').toUpperCase()
    if (isCadExt(ext)) {
      const cadVersion = await extractCadHeaderVersion(filePath)
      return {
        width: null,
        height: null,
        duration: null,
        extraMeta: {
          format: fmt,
          cadVersion
        },
        textSnippet: null
      }
    }
    return {
      width: null,
      height: null,
      duration: null,
      extraMeta: {
        format: fmt
      },
      textSnippet: null
    }
  }

  return { width: null, height: null, duration: null, extraMeta: null, textSnippet: null }
}
