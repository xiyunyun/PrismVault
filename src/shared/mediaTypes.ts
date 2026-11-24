export type MediaType = 'image' | 'video' | 'audio' | 'text' | 'model' | 'other'

export const MODEL_3D_EXTS = new Set([
  '.obj', '.fbx', '.glb', '.gltf', '.stl', '.ply'
])

export const CAD_EXTS = new Set([
  '.dwg', '.dxf'
])

export const MODEL_EXTS = new Set([
  ...MODEL_3D_EXTS,
  ...CAD_EXTS
])

export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp',
  '.svg', '.avif', '.ico', '.tiff', '.tif', '.jfif',
  '.psd', '.psb'
])

export const VIDEO_EXTS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv',
  '.wmv', '.m4v', '.ts', '.mts', '.m2ts', '.3gp', '.ogv'
])

export const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a',
  '.opus', '.wma', '.aiff', '.aif', '.alac'
])

export const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml',
  '.csv', '.tsv', '.log', '.ini', '.cfg', '.conf', '.env', '.toml',
  '.pdf', '.html', '.htm', '.css', '.scss', '.less',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
  '.rb', '.php', '.sh', '.ps1', '.bat', '.sql', '.vue', '.svelte',
  '.srt', '.vtt', '.ass', '.lrc'
])

export const MIME_MAP: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.psd': 'image/vnd.adobe.photoshop',
  '.psb': 'image/vnd.adobe.photoshop',
  // Videos
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.ogv': 'video/ogg',
  '.3gp': 'video/3gpp',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  // Docs / Text
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  // 3D Models & CAD
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.stl': 'model/stl',
  '.ply': 'application/octet-stream',
  '.dwg': 'application/acad',
  '.dxf': 'application/dxf'
}

export function normalizeExt(ext: string): string {
  const lower = ext.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}

export function classifyExtension(ext: string): MediaType {
  const e = normalizeExt(ext)
  if (IMAGE_EXTS.has(e)) return 'image'
  if (VIDEO_EXTS.has(e)) return 'video'
  if (AUDIO_EXTS.has(e)) return 'audio'
  if (TEXT_EXTS.has(e)) return 'text'
  if (MODEL_EXTS.has(e)) return 'model'
  return 'other'
}

export function is3DModelExt(ext: string): boolean {
  return MODEL_3D_EXTS.has(normalizeExt(ext))
}

export function isCadExt(ext: string): boolean {
  return CAD_EXTS.has(normalizeExt(ext))
}

export function isDwgExt(ext: string): boolean {
  return normalizeExt(ext) === '.dwg'
}

export function isDxfExt(ext: string): boolean {
  return normalizeExt(ext) === '.dxf'
}

export function getMimeType(ext: string): string {
  const e = normalizeExt(ext)
  if (MIME_MAP[e]) return MIME_MAP[e]
  if (TEXT_EXTS.has(e)) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

export function isPsdExt(ext: string): boolean {
  const e = normalizeExt(ext)
  return e === '.psd' || e === '.psb'
}

export function needsTranscodedImagePreview(ext: string): boolean {
  const e = normalizeExt(ext)
  return e === '.psd' || e === '.psb' || e === '.tif' || e === '.tiff'
}

export function isPdfExt(ext: string): boolean {
  return normalizeExt(ext) === '.pdf'
}

export function isMarkdownExt(ext: string): boolean {
  const e = normalizeExt(ext)
  return e === '.md' || e === '.markdown'
}

export function isReadableTextExt(ext: string): boolean {
  const e = normalizeExt(ext)
  return TEXT_EXTS.has(e) && e !== '.pdf'
}

export function stripThumbVersion(thumbPath: string | null | undefined): string {
  if (!thumbPath) return ''
  const qIdx = thumbPath.indexOf('?')
  return qIdx >= 0 ? thumbPath.slice(0, qIdx) : thumbPath
}

function trimIncompleteUtf8Tail(buf: Uint8Array): Uint8Array {
  const len = buf.length
  if (len === 0) return buf
  let i = len - 1
  const minIdx = Math.max(0, len - 4)
  while (i >= minIdx && (buf[i] & 0xc0) === 0x80) {
    i--
  }
  if (i < minIdx) return buf
  const lead = buf[i]
  if (lead < 0x80) {
    return i === len - 1 ? buf : buf.subarray(0, i + 1)
  }
  let expectedLen = 1
  if ((lead & 0xe0) === 0xc0) expectedLen = 2
  else if ((lead & 0xf0) === 0xe0) expectedLen = 3
  else if ((lead & 0xf8) === 0xf0) expectedLen = 4
  else return buf
  const actualRemaining = len - i
  return actualRemaining < expectedLen ? buf.subarray(0, i) : buf
}

/**
 * Decodes UTF-8 / UTF-16 BOM / legacy Chinese GBK & GB18030 text buffers cleanly.
 * When `isTruncated` is true (e.g. reading a 1KB/4KB/512KB prefix), incomplete trailing
 * UTF-8 multi-byte sequences are trimmed before fatal UTF-8 validation so valid UTF-8
 * CJK files never falsely fall back to GB18030.
 */
export function decodeTextBuffer(buf: Uint8Array, isTruncated = false): string {
  if (!buf || buf.length === 0) return ''

  // Check BOMs first
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    const body = isTruncated ? trimIncompleteUtf8Tail(buf.subarray(3)) : buf.subarray(3)
    return new TextDecoder('utf-8', { fatal: false }).decode(body)
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    const body = buf.subarray(2, buf.length - ((buf.length - 2) % 2))
    return new TextDecoder('utf-16le', { fatal: false }).decode(body)
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = buf.subarray(2, buf.length - ((buf.length - 2) % 2))
    return new TextDecoder('utf-16be', { fatal: false }).decode(body)
  }

  const utf8Candidate = isTruncated ? trimIncompleteUtf8Tail(buf) : buf
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(utf8Candidate)
  } catch {
    try {
      const decoded = new TextDecoder('gb18030', { fatal: false }).decode(buf)
      return isTruncated ? decoded.replace(/\uFFFD+$/, '') : decoded
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(utf8Candidate)
    }
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unitIdx = 0
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024
    unitIdx++
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIdx]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
  model: '3D / CAD',
  other: '其他'
}
