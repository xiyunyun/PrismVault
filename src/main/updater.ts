import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import { app, net, shell } from 'electron'
import { getAllSettings } from './db/repositories'
import type {
  AppInfo,
  AppInstallType,
  UpdateAssetInfo,
  UpdateInstallResult,
  UpdateReleaseInfo,
  UpdateState
} from '@shared/types'

export const GITHUB_OWNER = 'xiyunyun'
export const GITHUB_REPO = 'PrismVault'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`
const GITHUB_LATEST_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=5`
const RAW_MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/latest.json`
const JSDELIVR_FASTLY_MANIFEST_URL = `https://fastly.jsdelivr.net/gh/${GITHUB_OWNER}/${GITHUB_REPO}@main/latest.json`
const JSDELIVR_CF_MANIFEST_URL = `https://testingcf.jsdelivr.net/gh/${GITHUB_OWNER}/${GITHUB_REPO}@main/latest.json`

/**
 * Built-in China-friendly GitHub release proxy mirrors.
 * Can also be remotely updated at any time via `latest.json`'s `mirrors` field without shipping a new client!
 */
export const DEFAULT_GITHUB_MIRRORS: string[] = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
  'https://hk.gh-proxy.com/'
]

interface GitHubAssetRaw {
  name?: string
  size?: number
  browser_download_url?: string
}

interface GitHubReleaseRaw {
  tag_name?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
  html_url?: string
  assets?: GitHubAssetRaw[]
}

interface StaticManifestAssetRaw {
  name?: string
  size?: number
  sha256?: string
  downloadUrl?: string
}

interface StaticManifestRaw {
  version?: string
  tagName?: string
  name?: string
  notes?: string
  publishedAt?: string | null
  htmlUrl?: string
  mirrors?: string[]
  assets?: {
    installer?: StaticManifestAssetRaw | null
    portable?: StaticManifestAssetRaw | null
  }
}

interface DownloadRoute {
  label: string
  url: string
  isMirror: boolean
}

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^[vV]+/, '')
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function parseSemver(raw: string): ParsedSemver {
  const cleaned = normalizeVersion(raw).split('+')[0]
  const dashIdx = cleaned.indexOf('-')
  const core = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned
  const pre = dashIdx >= 0 ? cleaned.slice(dashIdx + 1) : ''
  const nums = core.split('.').map((n) => {
    const parsed = Number.parseInt(n, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  })
  return {
    major: nums[0] ?? 0,
    minor: nums[1] ?? 0,
    patch: nums[2] ?? 0,
    prerelease: pre ? pre.split('.').filter(Boolean) : []
  }
}

/**
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch

  const aHasPre = pa.prerelease.length > 0
  const bHasPre = pb.prerelease.length > 0
  if (!aHasPre && !bHasPre) return 0
  if (!aHasPre && bHasPre) return 1
  if (aHasPre && !bHasPre) return -1

  const len = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < len; i++) {
    const ia = pa.prerelease[i]
    const ib = pb.prerelease[i]
    if (ia === undefined) return -1
    if (ib === undefined) return 1
    const na = /^\d+$/.test(ia) ? Number(ia) : null
    const nb = /^\d+$/.test(ib) ? Number(ib) : null
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb
    } else if (na !== null) {
      return -1
    } else if (nb !== null) {
      return 1
    } else if (ia !== ib) {
      return ia < ib ? -1 : 1
    }
  }
  return 0
}

export function applyMirrorPrefix(rawUrl: string, mirrorPrefix: string): string {
  const prefix = mirrorPrefix.trim()
  if (!prefix || !/^https?:\/\//i.test(prefix)) return rawUrl
  if (prefix.includes('{url}')) {
    return prefix.replace(/\{url\}/g, rawUrl)
  }
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`
  return `${normalized}${rawUrl}`
}

function isGitHubDownloadUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return (
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host === 'raw.githubusercontent.com' ||
      host.endsWith('.githubusercontent.com')
    )
  } catch {
    return false
  }
}

function getMirrorHostLabel(mirrorPrefix: string): string {
  try {
    const host = new URL(mirrorPrefix.replace(/\{url\}/g, '')).hostname
    return host || mirrorPrefix
  } catch {
    return mirrorPrefix
  }
}

function normalizeSha256(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined
  const clean = raw.trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(clean) ? clean : undefined
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()))
    stream.on('error', reject)
  })
}

export function detectInstallType(): AppInstallType {
  if (!app.isPackaged) return 'dev'
  try {
    const exeDir = path.dirname(process.execPath)
    const entries = fs.readdirSync(exeDir)
    const hasUninstaller = entries.some((name) => /^uninstall.*\.exe$/i.test(name))
    return hasUninstaller ? 'installer' : 'portable'
  } catch {
    return 'portable'
  }
}

export function getAppInfo(): AppInfo {
  let micaSupported = false
  if (process.platform === 'win32') {
    const parts = os.release().split('.')
    const major = Number(parts[0] ?? 0)
    const build = Number(parts[2] ?? 0)
    micaSupported = major >= 10 && Number.isFinite(build) && build >= 22621
  }
  return {
    version: app.getVersion(),
    installType: detectInstallType(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    micaSupported,
    repoUrl: GITHUB_REPO_URL,
    releasesUrl: GITHUB_RELEASES_URL
  }
}

export function pickReleaseAssets(
  rawAssets: GitHubAssetRaw[] | undefined,
  installType: AppInstallType
): {
  installerAsset: UpdateAssetInfo | null
  portableAsset: UpdateAssetInfo | null
  recommendedAsset: UpdateAssetInfo | null
} {
  const list = Array.isArray(rawAssets) ? rawAssets : []
  const valid = list.filter((a) => {
    const name = a.name?.trim() || ''
    const url = a.browser_download_url?.trim() || ''
    if (!name || !/^https?:\/\//i.test(url)) return false
    if (/\.(blockmap|yml|yaml|sha256|sig|asc|json)$/i.test(name)) return false
    return true
  })

  const exeCandidates = valid.filter((a) => /\.exe$/i.test(a.name || ''))
  const preferredExe =
    exeCandidates.find((a) => /setup|install/i.test(a.name || '')) ?? exeCandidates[0] ?? null

  const zipCandidates = valid.filter((a) => /\.zip$/i.test(a.name || ''))
  const preferredZip =
    zipCandidates.find((a) => /win|x64|portable/i.test(a.name || '')) ?? zipCandidates[0] ?? null

  const installerAsset: UpdateAssetInfo | null = preferredExe
    ? {
        name: preferredExe.name!,
        size: Number(preferredExe.size ?? 0),
        downloadUrl: preferredExe.browser_download_url!,
        kind: 'installer'
      }
    : null

  const portableAsset: UpdateAssetInfo | null = preferredZip
    ? {
        name: preferredZip.name!,
        size: Number(preferredZip.size ?? 0),
        downloadUrl: preferredZip.browser_download_url!,
        kind: 'portable'
      }
    : null

  const recommendedAsset =
    installType === 'portable'
      ? (portableAsset ?? installerAsset)
      : (installerAsset ?? portableAsset)

  return { installerAsset, portableAsset, recommendedAsset }
}

function parseStaticManifestToRelease(
  raw: StaticManifestRaw,
  installType: AppInstallType,
  checkSource: string
): UpdateReleaseInfo | null {
  const rawVer = raw.version?.trim() || raw.tagName?.trim()
  if (!rawVer) return null
  const version = normalizeVersion(rawVer)
  const tagName = raw.tagName?.trim() || `v${version}`

  const toAsset = (item: StaticManifestAssetRaw | null | undefined, kind: 'installer' | 'portable'): UpdateAssetInfo | null => {
    if (!item || !item.name?.trim() || !item.downloadUrl?.trim() || !/^https?:\/\//i.test(item.downloadUrl.trim())) {
      return null
    }
    return {
      name: item.name.trim(),
      size: Number(item.size ?? 0),
      downloadUrl: item.downloadUrl.trim(),
      kind,
      sha256: normalizeSha256(item.sha256)
    }
  }

  const installerAsset = toAsset(raw.assets?.installer, 'installer')
  const portableAsset = toAsset(raw.assets?.portable, 'portable')
  const recommendedAsset =
    installType === 'portable'
      ? (portableAsset ?? installerAsset)
      : (installerAsset ?? portableAsset)

  const mirrors = Array.isArray(raw.mirrors)
    ? raw.mirrors
        .map((m) => (typeof m === 'string' ? m.trim() : ''))
        .filter((m) => /^https?:\/\//i.test(m))
    : undefined

  return {
    version,
    tagName,
    name: raw.name?.trim() || `PrismVault v${version}`,
    notes: raw.notes?.trim() || '',
    publishedAt: raw.publishedAt ?? null,
    htmlUrl: raw.htmlUrl?.trim() || `${GITHUB_RELEASES_URL}/tag/${tagName}`,
    installerAsset,
    portableAsset,
    recommendedAsset,
    mirrors,
    checkSource
  }
}

function parseGitHubReleaseToRelease(
  raw: GitHubReleaseRaw,
  installType: AppInstallType,
  checkSource: string
): UpdateReleaseInfo | null {
  if (!raw.tag_name) return null
  const latestVersion = normalizeVersion(raw.tag_name)
  const { installerAsset, portableAsset, recommendedAsset } = pickReleaseAssets(raw.assets, installType)
  return {
    version: latestVersion,
    tagName: raw.tag_name,
    name: raw.name?.trim() || `PrismVault v${latestVersion}`,
    notes: raw.body?.trim() || '',
    publishedAt: raw.published_at ?? null,
    htmlUrl: raw.html_url?.trim() || GITHUB_RELEASES_URL,
    installerAsset,
    portableAsset,
    recommendedAsset,
    checkSource
  }
}

function getUpdatesDir(): string {
  const dir = path.join(app.getPath('userData'), 'updates')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function cleanupOldUpdateFiles(keepFileName: string): Promise<void> {
  try {
    const dir = getUpdatesDir()
    const files = await fsp.readdir(dir)
    await Promise.all(
      files
        .filter((f) => f !== keepFileName)
        .map((f) => fsp.unlink(path.join(dir, f)).catch(() => undefined))
    )
  } catch {
    // ignore cleanup errors
  }
}

function formatNetworkError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/SHA-256|完整性校验/i.test(raw)) {
    return raw
  }
  if (/abort|timeout|timed out|ERR_TIMED_OUT/i.test(raw)) {
    return '连接更新节点超时，已尝试国内加速通道与直连均未响应，请检查网络连接后重试或前往浏览器手动下载。'
  }
  if (
    /ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_NETWORK_ACCESS_DENIED|ERR_PROXY|ERR_SSL|ERR_CERT/i.test(
      raw
    )
  ) {
    return `无法连接到更新服务器（${raw}），请检查网络连接后重试，也可前往浏览器手动下载。`
  }
  return raw || '检查更新失败，请稍后重试。'
}

class CloudUpdater extends EventEmitter {
  private state: UpdateState
  private downloadAbort: AbortController | null = null

  constructor() {
    super()
    this.state = {
      status: 'idle',
      currentVersion: '0.0.0',
      installType: 'dev',
      release: null,
      download: null,
      error: null,
      checkedAt: null,
      silent: false
    }
  }

  init(): void {
    this.state = {
      ...this.state,
      currentVersion: app.getVersion(),
      installType: detectInstallType()
    }
  }

  getState(): UpdateState {
    if (this.state.currentVersion === '0.0.0') {
      this.init()
    }
    return { ...this.state }
  }

  onStateChange(cb: (state: UpdateState) => void): () => void {
    this.on('state', cb)
    return () => this.off('state', cb)
  }

  private setState(patch: Partial<UpdateState>): UpdateState {
    this.state = {
      ...this.state,
      ...patch
    }
    const snapshot = this.getState()
    this.emit('state', snapshot)
    return snapshot
  }

  private resolveDevTestApiUrl(): string | null {
    const testOverride = process.env.PRISMVAULT_UPDATE_API_URL?.trim()
    if (!app.isPackaged && testOverride && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(testOverride)) {
      return testOverride
    }
    return null
  }

  private async fetchJsonWithTimeout<T>(url: string, headers: Record<string, string>, timeoutMs: number): Promise<T | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
    try {
      const res = await net.fetch(url, { headers, signal: controller.signal })
      if (!res.ok) return null
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (ct.includes('text/html')) return null
      return (await res.json()) as T
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Multi-source update check:
   * 1. Static `latest.json` across China-friendly CDNs (jsDelivr Fastly/CF), built-in GitHub mirrors, and GitHub Raw
   *    (ZERO GitHub API 60/hr rate limit, works without proxy in mainland China!).
   *    Races sources with a short grace window so the highest SemVer wins even if a CDN has brief cache lag.
   * 2. Fallback to GitHub Releases API only if `latest.json` is unreachable / not yet published.
   */
  private async fetchLatestRelease(installType: AppInstallType): Promise<UpdateReleaseInfo | null> {
    const uaHeaders: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `PrismVault/${app.getVersion()} (Windows)`
    }

    // 0. Dev test override
    const devUrl = this.resolveDevTestApiUrl()
    if (devUrl) {
      const raw = await this.fetchJsonWithTimeout<Record<string, unknown>>(devUrl, uaHeaders, 10000)
      if (!raw) throw new Error('本地测试更新接口无响应')
      if ('tag_name' in raw) {
        return parseGitHubReleaseToRelease(raw as unknown as GitHubReleaseRaw, installType, '本地测试源')
      }
      return parseStaticManifestToRelease(raw as unknown as StaticManifestRaw, installType, '本地测试清单')
    }

    const settings = getAllSettings()
    const customMirror = (settings.updateMirrorUrl || '').trim()
    const cacheBuster = Math.floor(Date.now() / 60_000)

    // 1. Static `latest.json` multi-source race (no API rate limits!)
    const manifestSources: Array<{ label: string; url: string }> = []
    if (customMirror && /^https?:\/\//i.test(customMirror)) {
      manifestSources.push({
        label: `自定义镜像 (${getMirrorHostLabel(customMirror)})`,
        url: `${applyMirrorPrefix(RAW_MANIFEST_URL, customMirror)}?t=${cacheBuster}`
      })
    }
    manifestSources.push(
      { label: '国内加速节点 (jsDelivr Fastly)', url: `${JSDELIVR_FASTLY_MANIFEST_URL}?t=${cacheBuster}` },
      { label: '国内加速节点 (jsDelivr CF)', url: `${JSDELIVR_CF_MANIFEST_URL}?t=${cacheBuster}` },
      {
        label: `国内镜像 (${getMirrorHostLabel(DEFAULT_GITHUB_MIRRORS[0])})`,
        url: `${applyMirrorPrefix(RAW_MANIFEST_URL, DEFAULT_GITHUB_MIRRORS[0])}?t=${cacheBuster}`
      },
      {
        label: `国内镜像 (${getMirrorHostLabel(DEFAULT_GITHUB_MIRRORS[1])})`,
        url: `${applyMirrorPrefix(RAW_MANIFEST_URL, DEFAULT_GITHUB_MIRRORS[1])}?t=${cacheBuster}`
      },
      { label: 'GitHub Raw 直连', url: `${RAW_MANIFEST_URL}?t=${cacheBuster}` }
    )

    const manifestResult = await new Promise<UpdateReleaseInfo | null>((resolve) => {
      let settled = false
      let completedCount = 0
      let best: UpdateReleaseInfo | null = null
      let graceTimer: ReturnType<typeof setTimeout> | null = null

      const finish = () => {
        if (settled) return
        settled = true
        if (graceTimer) clearTimeout(graceTimer)
        resolve(best)
      }

      for (const src of manifestSources) {
        this.fetchJsonWithTimeout<StaticManifestRaw>(src.url, uaHeaders, 6500)
          .then((json) => {
            if (settled || !json) return
            const parsed = parseStaticManifestToRelease(json, installType, src.label)
            if (!parsed) return
            if (!best || compareSemver(parsed.version, best.version) > 0) {
              best = parsed
            }
            // Wait up to 900ms after first valid response in case a non-cached source reports an even newer tag
            if (!graceTimer) {
              graceTimer = setTimeout(finish, 900)
            }
          })
          .finally(() => {
            completedCount++
            if (completedCount >= manifestSources.length) {
              finish()
            }
          })
      }
    })

    if (manifestResult) {
      return manifestResult
    }

    // 2. Fallback to GitHub Releases API (kept for compatibility if latest.json isn't published yet)
    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `PrismVault/${app.getVersion()} (Windows)`,
      'X-GitHub-Api-Version': '2022-11-28'
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), 12000)

    try {
      const res = await net.fetch(GITHUB_LATEST_API_URL, { headers: ghHeaders, signal: controller.signal })
      if (res.status === 404) {
        const fallbackRes = await net.fetch(GITHUB_RELEASES_API_URL, { headers: ghHeaders, signal: controller.signal })
        if (!fallbackRes.ok) {
          if (fallbackRes.status === 404) return null
          throw new Error(`GitHub API 返回 HTTP ${fallbackRes.status}`)
        }
        const list = (await fallbackRes.json()) as GitHubReleaseRaw[]
        if (!Array.isArray(list)) return null
        const first = list.find((r) => !r.draft)
        return first ? parseGitHubReleaseToRelease(first, installType, 'GitHub Releases API') : null
      }

      if (res.status === 403) {
        const remaining = res.headers.get('x-ratelimit-remaining')
        if (remaining === '0') {
          throw new Error('更新清单暂未同步，且 GitHub API 当前处于每小时 60 次限流窗口，请稍后重试或直接打开网页下载。')
        }
        throw new Error('GitHub API 拒绝访问（HTTP 403），请检查网络代理或稍后重试。')
      }

      if (!res.ok) {
        throw new Error(`GitHub API 请求失败（HTTP ${res.status}）`)
      }

      const raw = (await res.json()) as GitHubReleaseRaw
      return parseGitHubReleaseToRelease(raw, installType, 'GitHub Releases API')
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Probes candidate routes in parallel (1-byte Range request, 3.5s timeout) and orders them fastest-first.
   * Custom user mirror always stays at index 0 if configured.
   */
  private async buildOrderedDownloadRoutes(
    rawUrl: string,
    remoteMirrors?: string[],
    customMirror?: string
  ): Promise<DownloadRoute[]> {
    // Non-GitHub direct CDN/OSS/R2 URLs (e.g. future Cloudflare R2 / Aliyun OSS): use directly without GitHub proxies
    if (!isGitHubDownloadUrl(rawUrl)) {
      return [{ label: '官方高速直连', url: rawUrl, isMirror: false }]
    }

    const custom = (customMirror || '').trim()
    const customRoutes: DownloadRoute[] = []
    if (custom && /^https?:\/\//i.test(custom)) {
      customRoutes.push({
        label: `自定义镜像 (${getMirrorHostLabel(custom)})`,
        url: applyMirrorPrefix(rawUrl, custom),
        isMirror: true
      })
    }

    // Merge remote mirrors (from latest.json) + built-in mirrors, deduplicated
    const seenMirrors = new Set<string>()
    const allMirrors: string[] = []
    for (const m of [...(remoteMirrors ?? []), ...DEFAULT_GITHUB_MIRRORS]) {
      const clean = m.trim()
      if (!clean || !/^https?:\/\//i.test(clean)) continue
      const key = clean.toLowerCase().replace(/\/+$/, '')
      if (seenMirrors.has(key)) continue
      seenMirrors.add(key)
      allMirrors.push(clean)
    }

    const autoCandidates: DownloadRoute[] = [
      { label: 'GitHub 直连', url: rawUrl, isMirror: false },
      ...allMirrors.map((m) => ({
        label: `国内加速 (${getMirrorHostLabel(m)})`,
        url: applyMirrorPrefix(rawUrl, m),
        isMirror: true
      }))
    ]

    // Probe all auto candidates concurrently with a lightweight 1-byte Range check (3.5s timeout)
    const probeResults = await Promise.all(
      autoCandidates.map(async (route): Promise<{ route: DownloadRoute; ok: boolean; ms: number }> => {
        const start = Date.now()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3500)
        try {
          const res = await net.fetch(route.url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              Range: 'bytes=0-0',
              'User-Agent': `PrismVault/${app.getVersion()} (Windows)`
            }
          })
          const ct = (res.headers.get('content-type') || '').toLowerCase()
          const isValidBinary = (res.status === 206 || res.status === 200) && !ct.includes('text/html') && !ct.includes('application/json')
          // Immediately abort body after reading headers so we don't download extra bytes
          controller.abort()
          return { route, ok: isValidBinary, ms: Date.now() - start }
        } catch {
          return { route, ok: false, ms: 99999 }
        } finally {
          clearTimeout(timer)
        }
      })
    )

    const reachable = probeResults.filter((r) => r.ok).sort((a, b) => a.ms - b.ms).map((r) => r.route)
    const unreachable = probeResults.filter((r) => !r.ok).map((r) => r.route)

    // Fastest reachable routes first, then unreachable routes as last-resort fallbacks
    return [...customRoutes, ...reachable, ...unreachable]
  }

  async checkForUpdates(opts?: { silent?: boolean }): Promise<UpdateState> {
    const silent = Boolean(opts?.silent)
    if (this.state.currentVersion === '0.0.0') {
      this.init()
    }

    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      return this.getState()
    }

    const currentVersion = app.getVersion()
    const installType = detectInstallType()

    this.setState({
      status: 'checking',
      currentVersion,
      installType,
      error: null,
      silent
    })

    try {
      const release = await this.fetchLatestRelease(installType)
      const now = Date.now()

      if (!release) {
        return this.setState({
          status: 'up-to-date',
          release: null,
          download: null,
          error: null,
          checkedAt: now,
          silent
        })
      }

      const hasUpdate = compareSemver(release.version, currentVersion) > 0
      if (!hasUpdate) {
        return this.setState({
          status: 'up-to-date',
          release,
          download: null,
          error: null,
          checkedAt: now,
          silent
        })
      }

      // Check if recommended package was already fully downloaded previously (and passes SHA-256 if provided)
      const recommendedAsset = release.recommendedAsset
      if (recommendedAsset) {
        const existingPath = path.join(getUpdatesDir(), path.basename(recommendedAsset.name))
        try {
          const st = await fsp.stat(existingPath)
          if (st.isFile() && st.size > 0 && (recommendedAsset.size <= 0 || st.size === recommendedAsset.size)) {
            let verifiedSha256 = false
            let shaOk = true
            if (recommendedAsset.sha256) {
              const actual = await computeFileSha256(existingPath)
              if (actual === recommendedAsset.sha256) {
                verifiedSha256 = true
              } else {
                shaOk = false
                await fsp.unlink(existingPath).catch(() => undefined)
              }
            }
            if (shaOk) {
              return this.setState({
                status: 'downloaded',
                release,
                download: {
                  fileName: recommendedAsset.name,
                  filePath: existingPath,
                  kind: recommendedAsset.kind,
                  transferredBytes: st.size,
                  totalBytes: st.size,
                  percent: 100,
                  bytesPerSecond: 0,
                  routeLabel: '本地已缓存',
                  verifiedSha256
                },
                error: null,
                checkedAt: now,
                silent
              })
            }
          }
        } catch {
          // Not yet downloaded
        }
      }

      return this.setState({
        status: 'available',
        release,
        download: null,
        error: null,
        checkedAt: now,
        silent
      })
    } catch (err) {
      if (silent) {
        // Silent startup checks should fail quietly without alarming the user
        return this.setState({
          status: 'idle',
          error: null,
          silent: true
        })
      }
      return this.setState({
        status: 'error',
        error: formatNetworkError(err),
        checkedAt: Date.now(),
        silent: false
      })
    }
  }

  /**
   * Streams from a single route with HTTP Range resume support and a 15-second mid-stream stall watchdog.
   */
  private async streamFromRoute(
    route: DownloadRoute,
    asset: UpdateAssetInfo,
    safeName: string,
    destPath: string,
    partPath: string,
    masterSignal: AbortSignal
  ): Promise<{ transferredBytes: number; totalBytes: number }> {
    let existingBytes = 0
    try {
      const partStat = await fsp.stat(partPath)
      if (partStat.isFile() && partStat.size > 0) {
        if (asset.size > 0 && partStat.size >= asset.size) {
          return { transferredBytes: partStat.size, totalBytes: asset.size }
        }
        existingBytes = partStat.size
      }
    } catch {
      existingBytes = 0
    }

    const routeAbort = new AbortController()
    const onMasterAbort = () => routeAbort.abort(new Error('user-cancelled'))
    masterSignal.addEventListener('abort', onMasterAbort, { once: true })

    let stallTimer: ReturnType<typeof setTimeout> | null = null
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        routeAbort.abort(new Error('stall-timeout'))
      }, 16_000)
    }

    let writeStream: fs.WriteStream | null = null

    try {
      const reqHeaders: Record<string, string> = {
        'User-Agent': `PrismVault/${app.getVersion()} (Windows)`
      }
      if (existingBytes > 0) {
        reqHeaders.Range = `bytes=${existingBytes}-`
      }

      resetStallTimer()
      const response = await net.fetch(route.url, {
        signal: routeAbort.signal,
        headers: reqHeaders
      })

      // Handle stale Range mismatch (416) by clearing .part and letting next attempt start cleanly
      if (response.status === 416) {
        await fsp.unlink(partPath).catch(() => undefined)
        throw new Error('Range 偏移不匹配，准备重新开始下载')
      }

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}`)
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        throw new Error('镜像节点返回了非安装包内容，自动切换下一节点')
      }

      if (!response.body) {
        throw new Error('服务器未返回有效下载流')
      }

      let resumed = false
      let totalBytes = asset.size
      if (response.status === 206 && existingBytes > 0) {
        const cr = response.headers.get('content-range') || ''
        const crMatch = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(cr)
        if (crMatch && Number(crMatch[1]) === existingBytes) {
          resumed = true
          if (crMatch[3] !== '*') {
            const parsedTotal = Number(crMatch[3])
            if (parsedTotal > 0) totalBytes = parsedTotal
          }
        }
      }

      if (!resumed) {
        const headerLen = Number(response.headers.get('content-length') || '0')
        if (headerLen > 0) totalBytes = headerLen
        existingBytes = 0
      }

      writeStream = fs.createWriteStream(partPath, { flags: resumed ? 'a' : 'w' })
      const reader = response.body.getReader()
      let transferredBytes = existingBytes
      let lastReportAt = Date.now()
      let lastReportBytes = transferredBytes

      // Immediately report selected route label to UI
      this.setState({
        download: {
          fileName: safeName,
          filePath: destPath,
          kind: asset.kind,
          transferredBytes,
          totalBytes,
          percent: totalBytes > 0 ? Math.min(99, Math.round((transferredBytes / totalBytes) * 100)) : 0,
          bytesPerSecond: 0,
          routeLabel: route.label
        }
      })

      while (true) {
        resetStallTimer()
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.byteLength === 0) continue

        if (!writeStream.write(value)) {
          await new Promise<void>((resolve, reject) => {
            writeStream!.once('drain', resolve)
            writeStream!.once('error', reject)
          })
        }

        transferredBytes += value.byteLength
        const now = Date.now()
        const elapsedMs = now - lastReportAt
        if (elapsedMs >= 120) {
          const deltaBytes = transferredBytes - lastReportBytes
          const bytesPerSecond = Math.round((deltaBytes * 1000) / Math.max(elapsedMs, 1))
          const percent = totalBytes > 0 ? Math.min(99, Math.round((transferredBytes / totalBytes) * 100)) : 0
          lastReportAt = now
          lastReportBytes = transferredBytes
          this.setState({
            download: {
              fileName: safeName,
              filePath: destPath,
              kind: asset.kind,
              transferredBytes,
              totalBytes,
              percent,
              bytesPerSecond,
              routeLabel: route.label
            }
          })
        }
      }

      if (stallTimer) clearTimeout(stallTimer)
      await new Promise<void>((resolve, reject) => {
        writeStream!.end(() => resolve())
        writeStream!.once('error', reject)
      })
      writeStream = null

      if (transferredBytes <= 0) {
        throw new Error('下载的文件为空')
      }
      if (totalBytes > 0 && transferredBytes !== totalBytes) {
        throw new Error(`下载未完整结束（已收 ${transferredBytes}/${totalBytes} 字节）`)
      }

      return { transferredBytes, totalBytes }
    } finally {
      if (stallTimer) clearTimeout(stallTimer)
      masterSignal.removeEventListener('abort', onMasterAbort)
      if (writeStream) {
        await new Promise<void>((resolve) => {
          writeStream!.end(() => resolve())
        }).catch(() => undefined)
      }
    }
  }

  async downloadUpdate(preferredKind?: 'installer' | 'portable'): Promise<UpdateState> {
    if (this.state.status === 'downloading') {
      return this.getState()
    }

    const release = this.state.release
    if (!release) {
      return this.setState({
        status: 'error',
        error: '请先检查更新后再执行下载。',
        silent: false
      })
    }

    const asset =
      preferredKind === 'installer'
        ? (release.installerAsset ?? release.recommendedAsset)
        : preferredKind === 'portable'
          ? (release.portableAsset ?? release.recommendedAsset)
          : release.recommendedAsset

    if (!asset) {
      return this.setState({
        status: 'error',
        error: '该版本暂未提供适用于 Windows 的安装包，请点击「Releases 页面」手动查看。',
        silent: false
      })
    }

    const updatesDir = getUpdatesDir()
    const safeName = path.basename(asset.name)
    const destPath = path.join(updatesDir, safeName)
    const partPath = `${destPath}.part`

    // Reuse already-complete local file if exact size & SHA-256 match
    try {
      const existingStat = await fsp.stat(destPath)
      if (existingStat.isFile() && existingStat.size > 0 && (asset.size <= 0 || existingStat.size === asset.size)) {
        let verifiedSha256 = false
        let valid = true
        if (asset.sha256) {
          const actual = await computeFileSha256(destPath)
          if (actual === asset.sha256) {
            verifiedSha256 = true
          } else {
            valid = false
            await fsp.unlink(destPath).catch(() => undefined)
          }
        }
        if (valid) {
          return this.setState({
            status: 'downloaded',
            download: {
              fileName: safeName,
              filePath: destPath,
              kind: asset.kind,
              transferredBytes: existingStat.size,
              totalBytes: existingStat.size,
              percent: 100,
              bytesPerSecond: 0,
              routeLabel: '本地已缓存',
              verifiedSha256
            },
            error: null,
            silent: false
          })
        }
      }
    } catch {
      // Proceed to download
    }

    const controller = new AbortController()
    this.downloadAbort = controller

    this.setState({
      status: 'downloading',
      error: null,
      silent: false,
      download: {
        fileName: safeName,
        filePath: destPath,
        kind: asset.kind,
        transferredBytes: 0,
        totalBytes: asset.size,
        percent: 0,
        bytesPerSecond: 0,
        routeLabel: '正在自动测速优选最快节点...'
      }
    })

    try {
      const settings = getAllSettings()
      const routes = await this.buildOrderedDownloadRoutes(
        asset.downloadUrl,
        release.mirrors,
        settings.updateMirrorUrl
      )

      if (controller.signal.aborted) {
        await fsp.unlink(partPath).catch(() => undefined)
        return this.setState({ status: 'available', download: null, error: null })
      }

      let lastErr: unknown = new Error('所有下载节点均不可用')
      let succeededRoute: DownloadRoute | null = null
      let finalTransferred = 0
      let verifiedSha256 = false

      for (let i = 0; i < routes.length; i++) {
        if (controller.signal.aborted) break
        const route = routes[i]
        try {
          const res = await this.streamFromRoute(route, asset, safeName, destPath, partPath, controller.signal)
          finalTransferred = res.transferredBytes

          // SHA-256 integrity verification (critical when downloading via third-party mirrors!)
          if (asset.sha256) {
            this.setState({
              download: {
                fileName: safeName,
                filePath: destPath,
                kind: asset.kind,
                transferredBytes: finalTransferred,
                totalBytes: res.totalBytes || finalTransferred,
                percent: 99,
                bytesPerSecond: 0,
                routeLabel: `${route.label} · 正在校验 SHA-256...`
              }
            })
            const actualSha = await computeFileSha256(partPath)
            if (actualSha !== asset.sha256) {
              // Reject tampered or corrupted file and try next route from scratch
              await fsp.unlink(partPath).catch(() => undefined)
              throw new Error(`安装包 SHA-256 完整性校验未通过（节点：${route.label}），已拦截并尝试其他节点。`)
            }
            verifiedSha256 = true
          }

          succeededRoute = route
          break
        } catch (err) {
          lastErr = err
          if (controller.signal.aborted) break
          // Keep .part on network/stall error so the next route resumes via HTTP Range!
        }
      }

      if (controller.signal.aborted) {
        await fsp.unlink(partPath).catch(() => undefined)
        return this.setState({
          status: 'available',
          download: null,
          error: null
        })
      }

      if (!succeededRoute) {
        throw lastErr
      }

      await fsp.unlink(destPath).catch(() => undefined)
      await fsp.rename(partPath, destPath)
      cleanupOldUpdateFiles(safeName).catch(() => undefined)

      return this.setState({
        status: 'downloaded',
        error: null,
        download: {
          fileName: safeName,
          filePath: destPath,
          kind: asset.kind,
          transferredBytes: finalTransferred,
          totalBytes: finalTransferred,
          percent: 100,
          bytesPerSecond: 0,
          routeLabel: succeededRoute.label,
          verifiedSha256
        }
      })
    } catch (err) {
      if (controller.signal.aborted) {
        await fsp.unlink(partPath).catch(() => undefined)
        return this.setState({
          status: 'available',
          download: null,
          error: null
        })
      }

      return this.setState({
        status: 'error',
        download: null,
        error: formatNetworkError(err)
      })
    } finally {
      if (this.downloadAbort === controller) {
        this.downloadAbort = null
      }
    }
  }

  async cancelDownload(): Promise<UpdateState> {
    if (this.downloadAbort) {
      this.downloadAbort.abort()
      this.downloadAbort = null
    }
    if (this.state.status === 'downloading') {
      return this.setState({
        status: this.state.release ? 'available' : 'idle',
        download: null,
        error: null
      })
    }
    return this.getState()
  }

  async installDownloadedUpdate(): Promise<UpdateInstallResult> {
    const dl = this.state.download
    if (this.state.status !== 'downloaded' || !dl || !fs.existsSync(dl.filePath)) {
      return {
        ok: false,
        action: 'error',
        error: '更新文件不存在或尚未下载完成，请重新下载。'
      }
    }

    if (dl.kind === 'installer') {
      const openErr = await shell.openPath(dl.filePath)
      if (openErr) {
        return {
          ok: false,
          action: 'error',
          error: `无法启动安装程序：${openErr}`
        }
      }
      // Give IPC response a moment to arrive at renderer, then quit gracefully so NSIS can overwrite
      setTimeout(() => {
        app.quit()
      }, 450)
      return {
        ok: true,
        action: 'launched-installer',
        filePath: dl.filePath
      }
    }

    shell.showItemInFolder(dl.filePath)
    return {
      ok: true,
      action: 'revealed-portable',
      filePath: dl.filePath
    }
  }

  async openReleasesPage(): Promise<void> {
    const url = this.state.release?.htmlUrl || GITHUB_RELEASES_URL
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  }
}

export const cloudUpdater = new CloudUpdater()
