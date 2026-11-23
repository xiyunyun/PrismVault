import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const pkgPath = path.join(rootDir, 'package.json')
const manifestPath = path.join(rootDir, 'latest.json')

const GITHUB_OWNER = 'xiyunyun'
const GITHUB_REPO = 'PrismVault'
const DEFAULT_MIRRORS = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
  'https://hk.gh-proxy.com/'
]

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()))
    stream.on('error', reject)
  })
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1]
  }
  return null
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const version = (parseArg('--version') || pkg.version || '0.0.0').replace(/^[vV]+/, '')
  const tagName = `v${version}`

  let existingManifest = null
  if (fs.existsSync(manifestPath)) {
    try {
      existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      existingManifest = null
    }
  }

  let notes = parseArg('--notes')
  const notesFile = parseArg('--notes-file')
  if (!notes && notesFile && fs.existsSync(notesFile)) {
    notes = fs.readFileSync(notesFile, 'utf8').trim()
  }
  if (!notes) {
    notes =
      existingManifest?.version === version && existingManifest?.notes
        ? existingManifest.notes
        : `### PrismVault ${tagName}\n\n- 优化与更新内容详见 GitHub Releases 页面。`
  }

  const distFiles = fs.existsSync(distDir) ? fs.readdirSync(distDir) : []
  const versionEscaped = version.replace(/\./g, '\\.')
  const exeName =
    distFiles.find((f) => new RegExp(`${versionEscaped}.*\\.exe$`, 'i').test(f)) ||
    distFiles.find((f) => /\.exe$/i.test(f))
  const zipName =
    distFiles.find((f) => new RegExp(`${versionEscaped}.*\\.zip$`, 'i').test(f)) ||
    distFiles.find((f) => /\.zip$/i.test(f))

  const buildAssetEntry = async (fileName) => {
    if (!fileName) return null
    const fullPath = path.join(distDir, fileName)
    if (!fs.existsSync(fullPath)) return null
    const stat = fs.statSync(fullPath)
    const sha256 = await computeSha256(fullPath)
    // GitHub Releases replaces spaces in uploaded asset filenames with dots
    const ghReleaseFileName = fileName.replace(/\s+/g, '.')
    return {
      name: ghReleaseFileName,
      size: stat.size,
      sha256,
      downloadUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tagName}/${encodeURIComponent(ghReleaseFileName)}`
    }
  }

  const installer = await buildAssetEntry(exeName)
  const portable = await buildAssetEntry(zipName)

  if (!installer && !portable) {
    console.error(`[release:manifest] No .exe or .zip release artifacts found in ${distDir}`)
    process.exit(1)
  }

  const mirrors =
    Array.isArray(existingManifest?.mirrors) && existingManifest.mirrors.length > 0
      ? existingManifest.mirrors
      : DEFAULT_MIRRORS

  const manifest = {
    version,
    tagName,
    name: `PrismVault ${tagName}`,
    publishedAt: new Date().toISOString(),
    htmlUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/${tagName}`,
    notes,
    mirrors,
    assets: {
      installer,
      portable
    }
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`[release:manifest] Generated ${manifestPath} for ${tagName}`)
  if (installer) {
    console.log(`  - installer: ${installer.name} (${installer.size} bytes, sha256=${installer.sha256.slice(0, 16)}...)`)
  }
  if (portable) {
    console.log(`  - portable : ${portable.name} (${portable.size} bytes, sha256=${portable.sha256.slice(0, 16)}...)`)
  }
}

main().catch((err) => {
  console.error('[release:manifest] Failed:', err)
  process.exit(1)
})
