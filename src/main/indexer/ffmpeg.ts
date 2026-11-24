import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import { getAllSettings } from '../db/repositories'
import type { FfmpegStatus } from '@shared/types'

const execFileAsync = promisify(execFile)

let cachedStatus: FfmpegStatus | null = null
let cachedCustomPath = ''

async function findExecutableInPath(binName: string): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(cmd, [binName], { timeout: 3000 })
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0 && fs.existsSync(s))
    return first ?? null
  } catch {
    return null
  }
}

export async function resolveFfmpeg(forceRefresh = false): Promise<FfmpegStatus> {
  const settings = getAllSettings()
  const custom = (settings.ffmpegPath || '').trim()

  if (!forceRefresh && cachedStatus && cachedCustomPath === custom) {
    return cachedStatus
  }
  cachedCustomPath = custom

  let ffmpegPath: string | null = null
  let ffprobePath: string | null = null

  if (custom) {
    if (fs.existsSync(custom) && fs.statSync(custom).isFile()) {
      ffmpegPath = custom
      const sibling = path.join(path.dirname(custom), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
      if (fs.existsSync(sibling)) ffprobePath = sibling
    } else if (fs.existsSync(custom) && fs.statSync(custom).isDirectory()) {
      const candidate = path.join(custom, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
      if (fs.existsSync(candidate)) ffmpegPath = candidate
      const probeCandidate = path.join(custom, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
      if (fs.existsSync(probeCandidate)) ffprobePath = probeCandidate
    }
  }

  if (!ffmpegPath) {
    ffmpegPath = await findExecutableInPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  }
  if (!ffprobePath && ffmpegPath) {
    const sibling = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    if (fs.existsSync(sibling)) {
      ffprobePath = sibling
    } else {
      ffprobePath = await findExecutableInPath(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    }
  }

  cachedStatus = {
    available: Boolean(ffmpegPath),
    ffmpegPath,
    ffprobePath
  }
  return cachedStatus
}

export interface VideoProbeInfo {
  width: number | null
  height: number | null
  duration: number | null
  fps?: number
  videoCodec?: string
  audioCodec?: string
  bitrate?: number
}

export async function probeVideo(filePath: string): Promise<VideoProbeInfo | null> {
  const status = await resolveFfmpeg()
  if (!status.ffprobePath) return null

  try {
    const { stdout } = await execFileAsync(
      status.ffprobePath,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 12000, maxBuffer: 2 * 1024 * 1024 }
    )
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string
        codec_name?: string
        width?: number
        height?: number
        r_frame_rate?: string
        avg_frame_rate?: string
        duration?: string
        tags?: { rotate?: string | number }
        side_data_list?: Array<{ rotation?: string | number }>
      }>
      format?: {
        duration?: string
        bit_rate?: string
      }
    }

    const vStream = parsed.streams?.find((s) => s.codec_type === 'video')
    const aStream = parsed.streams?.find((s) => s.codec_type === 'audio')

    let fps: number | undefined
    const rateStr = vStream?.avg_frame_rate || vStream?.r_frame_rate
    if (rateStr && rateStr.includes('/')) {
      const [num, den] = rateStr.split('/').map(Number)
      if (num > 0 && den > 0) {
        fps = Math.round((num / den) * 100) / 100
      }
    }

    const rawDuration = parsed.format?.duration ?? vStream?.duration
    const duration = rawDuration ? Number(rawDuration) : null
    const bitrate = parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : undefined

    let width = vStream?.width ?? null
    let height = vStream?.height ?? null
    let rotDeg = 0
    if (vStream?.tags?.rotate != null) {
      rotDeg = Number(vStream.tags.rotate) || 0
    } else if (Array.isArray(vStream?.side_data_list)) {
      const rotEntry = vStream.side_data_list.find((d) => d && d.rotation != null)
      if (rotEntry) rotDeg = Number(rotEntry.rotation) || 0
    }
    if (width && height && Math.abs(Math.round(rotDeg)) % 180 === 90) {
      ;[width, height] = [height, width]
    }

    return {
      width,
      height,
      duration: duration != null && Number.isFinite(duration) ? duration : null,
      fps,
      videoCodec: vStream?.codec_name,
      audioCodec: aStream?.codec_name,
      bitrate: bitrate != null && Number.isFinite(bitrate) ? bitrate : undefined
    }
  } catch {
    return null
  }
}

export async function extractVideoFrame(
  filePath: string,
  outputPath: string,
  durationSec?: number | null
): Promise<boolean> {
  const status = await resolveFfmpeg()
  if (!status.ffmpegPath) return false

  // Pick a timestamp slightly into the video to avoid black opening frames
  const seekSec =
    durationSec && Number.isFinite(durationSec) && durationSec > 2
      ? Math.min(Math.max(1, durationSec * 0.12), 10)
      : 0.5

  const runCapture = async (ss: number): Promise<boolean> => {
    try {
      await execFileAsync(
        status.ffmpegPath!,
        [
          '-y',
          '-ss',
          ss.toFixed(2),
          '-i',
          filePath,
          '-vframes',
          '1',
          '-vf',
          "scale='min(480,iw)':-2",
          '-c:v',
          'libwebp',
          '-quality',
          '80',
          outputPath
        ],
        { timeout: 15000 }
      )
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return true
      }
    } catch {
      // Fall back to universal built-in PNG encoder piped through sharp -> WebP
    }

    try {
      const { stdout } = await execFileAsync(
        status.ffmpegPath!,
        [
          '-ss',
          ss.toFixed(2),
          '-i',
          filePath,
          '-vframes',
          '1',
          '-vf',
          "scale='min(480,iw)':-2",
          '-f',
          'image2pipe',
          '-c:v',
          'png',
          '-'
        ],
        { timeout: 15000, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }
      )
      if (stdout && stdout.length > 32) {
        await sharp(stdout).webp({ quality: 80 }).toFile(outputPath)
        return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0
      }
    } catch {
      return false
    }
    return false
  }

  if (await runCapture(seekSec)) return true
  if (seekSec > 0 && (await runCapture(0))) return true
  return false
}
