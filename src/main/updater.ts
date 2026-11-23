import fs from 'fs'
import fsp from 'fs/promises'
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
  return {
    version: app.getVersion(),
    installType: detectInstallType(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
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
    if (/\.(blockmap|yml|yaml|sha256|sig|asc)$/i.test(name)) return false
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
  if (/abort|timeout|timed out|ERR_TIMED_OUT/i.test(raw)) {
    return '连接 GitHub 超时，请检查网络或代理设置后重试，也可前往网页手动下载。'
  }
  if (
    /ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_NETWORK_ACCESS_DENIED|ERR_PROXY|ERR_SSL|ERR_CERT/i.test(
      raw
    )
  ) {
    return `无法连接到 GitHub 服务器（${raw}），请检查网络连接、系统代理设置或直接打开网页下载。`
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

  private resolveLatestApiUrl(): string {
    const testOverride = process.env.PRISMVAULT_UPDATE_API_URL?.trim()
    if (!app.isPackaged && testOverride && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(testOverride)) {
      return testOverride
    }
    return GITHUB_LATEST_API_URL
  }

  private async fetchLatestReleaseJson(): Promise<GitHubReleaseRaw | null> {
    const apiUrl = this.resolveLatestApiUrl()
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `PrismVault/${app.getVersion()} (Windows)`,
      'X-GitHub-Api-Version': '2022-11-28'
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), 15000)

    try {
      const res = await net.fetch(apiUrl, { headers, signal: controller.signal })
      if (res.status === 404 && apiUrl === GITHUB_LATEST_API_URL) {
        // Repo might have no published non-prerelease release yet; inspect recent releases list
        const fallbackRes = await net.fetch(GITHUB_RELEASES_API_URL, { headers, signal: controller.signal })
        if (!fallbackRes.ok) {
          if (fallbackRes.status === 404) return null
          throw new Error(`GitHub API 返回 HTTP ${fallbackRes.status}`)
        }
        const list = (await fallbackRes.json()) as GitHubReleaseRaw[]
        if (!Array.isArray(list)) return null
        return list.find((r) => !r.draft) ?? null
      }

      if (res.status === 403) {
        const remaining = res.headers.get('x-ratelimit-remaining')
        if (remaining === '0') {
          throw new Error('GitHub API 请求频率受限（匿名每小时 60 次），请稍后再试或直接打开 GitHub Releases 页面。')
        }
        throw new Error('GitHub API 拒绝访问（HTTP 403），请检查网络代理或稍后重试。')
      }

      if (!res.ok) {
        throw new Error(`GitHub API 请求失败（HTTP ${res.status}）`)
      }

      return (await res.json()) as GitHubReleaseRaw
    } finally {
      clearTimeout(timer)
    }
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
      const raw = await this.fetchLatestReleaseJson()
      const now = Date.now()

      if (!raw || !raw.tag_name) {
        return this.setState({
          status: 'up-to-date',
          release: null,
          download: null,
          error: null,
          checkedAt: now,
          silent
        })
      }

      const latestVersion = normalizeVersion(raw.tag_name)
      const { installerAsset, portableAsset, recommendedAsset } = pickReleaseAssets(raw.assets, installType)

      const release: UpdateReleaseInfo = {
        version: latestVersion,
        tagName: raw.tag_name,
        name: raw.name?.trim() || `PrismVault v${latestVersion}`,
        notes: raw.body?.trim() || '',
        publishedAt: raw.published_at ?? null,
        htmlUrl: raw.html_url?.trim() || GITHUB_RELEASES_URL,
        installerAsset,
        portableAsset,
        recommendedAsset
      }

      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0
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

      // Check if recommended package was already fully downloaded previously
      if (recommendedAsset) {
        const existingPath = path.join(getUpdatesDir(), path.basename(recommendedAsset.name))
        try {
          const st = await fsp.stat(existingPath)
          if (st.isFile() && st.size > 0 && (recommendedAsset.size <= 0 || st.size === recommendedAsset.size)) {
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
                bytesPerSecond: 0
              },
              error: null,
              checkedAt: now,
              silent
            })
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
        error: '该版本暂未提供适用于 Windows 的安装包，请点击「前往 GitHub Releases」手动查看。',
        silent: false
      })
    }

    const updatesDir = getUpdatesDir()
    const safeName = path.basename(asset.name)
    const destPath = path.join(updatesDir, safeName)
    const partPath = `${destPath}.part`

    // Reuse already-complete local file if exact size matches
    try {
      const existingStat = await fsp.stat(destPath)
      if (existingStat.isFile() && existingStat.size > 0 && (asset.size <= 0 || existingStat.size === asset.size)) {
        return this.setState({
          status: 'downloaded',
          download: {
            fileName: safeName,
            filePath: destPath,
            kind: asset.kind,
            transferredBytes: existingStat.size,
            totalBytes: existingStat.size,
            percent: 100,
            bytesPerSecond: 0
          },
          error: null,
          silent: false
        })
      }
    } catch {
      // Proceed to download
    }

    const settings = getAllSettings()
    const finalUrl = applyMirrorPrefix(asset.downloadUrl, settings.updateMirrorUrl || '')
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
        bytesPerSecond: 0
      }
    })

    let writeStream: fs.WriteStream | null = null

    try {
      const response = await net.fetch(finalUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': `PrismVault/${app.getVersion()} (Windows)`
        }
      })

      if (!response.ok) {
        throw new Error(`下载更新包失败（HTTP ${response.status}）${settings.updateMirrorUrl ? '，请检查下载加速镜像地址是否可用' : ''}`)
      }

      if (!response.body) {
        throw new Error('服务器未返回有效的下载数据流。')
      }

      const headerLen = Number(response.headers.get('content-length') || '0')
      const totalBytes = headerLen > 0 ? headerLen : asset.size

      await fsp.unlink(partPath).catch(() => undefined)
      writeStream = fs.createWriteStream(partPath)

      const reader = response.body.getReader()
      let transferredBytes = 0
      let lastReportAt = Date.now()
      let lastReportBytes = 0

      while (true) {
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
              bytesPerSecond
            }
          })
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream!.end(() => resolve())
        writeStream!.once('error', reject)
      })
      writeStream = null

      if (transferredBytes <= 0) {
        throw new Error('下载的文件为空，请重试或前往浏览器手动下载。')
      }
      if (totalBytes > 0 && transferredBytes !== totalBytes) {
        throw new Error('下载未完整结束，请重试或检查网络连接。')
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
          transferredBytes,
          totalBytes: transferredBytes,
          percent: 100,
          bytesPerSecond: 0
        }
      })
    } catch (err) {
      if (writeStream) {
        try {
          writeStream.destroy()
        } catch {
          // ignore
        }
      }
      await fsp.unlink(partPath).catch(() => undefined)

      if (controller.signal.aborted) {
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
