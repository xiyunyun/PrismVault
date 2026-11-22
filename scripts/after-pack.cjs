const path = require('path')
const fs = require('fs')

/**
 * electron-builder afterPack hook:
 * Embeds resources/icon.ico and Windows version metadata directly into PrismVault.exe
 * using standalone `rcedit` (avoids winCodeSign symlink extraction failures on Windows).
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const icoPath = path.resolve(context.packager.projectDir, 'resources', 'icon.ico')
  const pkg = require(path.resolve(context.packager.projectDir, 'package.json'))

  if (!fs.existsSync(exePath) || !fs.existsSync(icoPath)) return

  const { rcedit } = require('rcedit')
  await rcedit(exePath, {
    icon: icoPath,
    'version-string': {
      ProductName: 'PrismVault',
      FileDescription: 'PrismVault (棱镜匣) — 跨盘零复制全媒体素材库',
      CompanyName: 'Xiyun',
      LegalCopyright: 'Copyright © 2026 Xiyun (熙云)',
      OriginalFilename: exeName
    },
    'file-version': pkg.version,
    'product-version': pkg.version
  })
  console.log(`  • embedded PrismVault icon & metadata into ${exeName}`)
}
