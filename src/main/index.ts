import fs from 'fs'
import os from 'os'
import path from 'path'
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, protocol, Tray } from 'electron'
import { closeDatabase, initDatabase } from './db'
import { getAllSettings } from './db/repositories'
import { MEDIA_SCHEME, registerMediaProtocol } from './protocol'
import { registerIpcHandlers } from './ipc'
import { watcherManager } from './indexer/watcher'
import { indexScanner } from './indexer/scanner'
import { cloudUpdater } from './updater'
import { cadWorkerPool } from './indexer/cad'
import type { BackdropStyle } from '@shared/types'

let mainWindowRef: BrowserWindow | null = null
let appTray: Tray | null = null
let isQuitting = false
let hasShownTrayBalloon = false

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

export function isWin11MicaSupported(): boolean {
  if (process.platform !== 'win32') return false
  // Electron's setBackgroundMaterial('mica') requires Windows 11 22H2+ (build 22621+)
  const parts = os.release().split('.')
  const major = Number(parts[0] ?? 0)
  const build = Number(parts[2] ?? 0)
  return major >= 10 && Number.isFinite(build) && build >= 22621
}

export function resolveEffectiveBackdropStyle(style?: BackdropStyle): BackdropStyle {
  const candidate = style || 'aurora'
  if (candidate === 'mica' && !isWin11MicaSupported()) {
    return 'aurora'
  }
  return candidate
}

function resolveOpaqueWindowBg(theme: 'dark' | 'light', backdropStyle: BackdropStyle): string {
  const isDark = theme === 'dark'
  if (backdropStyle === 'solid') {
    return isDark ? '#202020' : '#f3f3f3'
  }
  if (backdropStyle === 'pastel') {
    return isDark ? '#171a24' : '#f1f5fc'
  }
  return isDark ? '#12151f' : '#eef3fc'
}

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

export function syncWindowAppearance(theme: 'dark' | 'light', backdropStyle: BackdropStyle): void {
  const isDark = theme === 'dark'
  const effectiveBackdrop = resolveEffectiveBackdropStyle(backdropStyle)
  const micaCapable = isWin11MicaSupported()
  nativeTheme.themeSource = theme

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (micaCapable) {
      // Keep DWM Mica initialized cleanly from window creation so dynamic CSS switching never turns black
      if (typeof win.setBackgroundMaterial === 'function') {
        try {
          win.setBackgroundMaterial('mica')
        } catch {
          // Ignore on unsupported OS builds
        }
      }
    } else {
      win.setBackgroundColor(resolveOpaqueWindowBg(theme, effectiveBackdrop))
    }
    if (typeof win.setTitleBarOverlay === 'function') {
      win.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: isDark ? '#f3f3f3' : '#1a1a1a',
        height: 42
      })
    }
  }
}

export function syncWindowTitleBarTheme(theme: 'dark' | 'light'): void {
  const settings = getAllSettings()
  syncWindowAppearance(theme, settings.backdropStyle)
}

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../resources/icon.png'),
    path.join(process.resourcesPath || '', 'icon.png')
  ]
  return candidates.find((p) => p && fs.existsSync(p))
}

function createTrayIconImage() {
  const iconPath = resolveAppIconPath()
  if (iconPath) {
    try {
      const buf = fs.readFileSync(iconPath)
      const img = nativeImage.createFromBuffer(buf)
      if (!img.isEmpty()) {
        return img.resize({ width: 32, height: 32, quality: 'best' })
      }
    } catch {
      // fallback below
    }
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) return img
  }
  return nativeImage.createEmpty()
}

export function showAndFocusMainWindow(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    mainWindowRef = createMainWindow({ forceShow: true })
    return
  }
  if (mainWindowRef.isMinimized()) {
    mainWindowRef.restore()
  }
  if (!mainWindowRef.isVisible()) {
    mainWindowRef.show()
  }
  mainWindowRef.focus()
}

function ensureAppTray(): void {
  if (appTray && !appTray.isDestroyed()) return
  const tray = new Tray(createTrayIconImage())
  tray.setToolTip('PrismVault — 棱镜匣')

  const menu = Menu.buildFromTemplate([
    {
      label: '显示 PrismVault 主窗口',
      click: () => showAndFocusMainWindow()
    },
    {
      label: '立即同步索引目录',
      click: () => {
        indexScanner.scanSource().catch(() => undefined)
      }
    },
    { type: 'separator' },
    {
      label: '彻底退出 PrismVault',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => showAndFocusMainWindow())
  tray.on('double-click', () => showAndFocusMainWindow())
  appTray = tray
}

function destroyAppTray(): void {
  if (appTray && !appTray.isDestroyed()) {
    appTray.destroy()
  }
  appTray = null
}

export function syncTrayPresence(closeToTray: boolean): void {
  if (closeToTray) {
    ensureAppTray()
  } else {
    // Only remove tray if the main window is currently visible so the app never becomes unreachable
    if (mainWindowRef && !mainWindowRef.isDestroyed() && !mainWindowRef.isVisible()) {
      showAndFocusMainWindow()
    }
    destroyAppTray()
  }
}

export function syncAutoLaunch(enabled: boolean): void {
  // Never register bare electron.exe into Windows Startup during pnpm run dev
  if (!app.isPackaged) return
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: enabled ? ['--hidden'] : []
      })
    } else if (process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: enabled
      })
    }
  } catch {
    // Ignore OS policy restrictions
  }
}

function createMainWindow(opts?: { forceShow?: boolean }): BrowserWindow {
  const settings = getAllSettings()
  const isDark = settings.theme === 'dark'
  const effectiveBackdrop = resolveEffectiveBackdropStyle(settings.backdropStyle)
  const micaCapable = isWin11MicaSupported()
  nativeTheme.themeSource = settings.theme

  const launchedHidden = !opts?.forceShow && process.argv.includes('--hidden') && settings.closeToTray

  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    show: !launchedHidden,
    title: 'PrismVault — 棱镜匣',
    icon: resolveAppIconPath(),
    // On Win11 22H2+, omit backgroundColor and initialize backgroundMaterial: 'mica' directly so Electron's
    // DWM Mica compositor stays intact when CSS switches between transparent Mica and opaque themes.
    ...(micaCapable
      ? { backgroundMaterial: 'mica' as const }
      : { backgroundColor: resolveOpaqueWindowBg(settings.theme, effectiveBackdrop) }),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: isDark ? '#f3f3f3' : '#1a1a1a',
      height: 42
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (micaCapable && typeof win.setBackgroundMaterial === 'function') {
    try {
      win.setBackgroundMaterial('mica')
    } catch {
      // Ignore on unsupported OS builds
    }
  }

  win.on('close', (e) => {
    if (!isQuitting && getAllSettings().closeToTray) {
      e.preventDefault()
      ensureAppTray()
      win.hide()
      if (process.platform === 'win32' && !hasShownTrayBalloon && appTray && !appTray.isDestroyed()) {
        hasShownTrayBalloon = true
        try {
          appTray.displayBalloon({
            title: 'PrismVault 已隐藏至系统托盘',
            content: '软件仍在后台运行。点击托盘图标可随时呼出，右键托盘图标可彻底退出。'
          })
        } catch {
          // ignore if balloon unavailable
        }
      }
    }
  })

  win.on('closed', () => {
    if (mainWindowRef === win) {
      mainWindowRef = null
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindowRef = win
  return win
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    showAndFocusMainWindow()
  })

  app.whenReady().then(() => {
    initDatabase()
    cloudUpdater.init()
    registerMediaProtocol()
    registerIpcHandlers()
    watcherManager.initAll()

    const settings = getAllSettings()
    syncAutoLaunch(settings.autoLaunch)
    if (settings.closeToTray) {
      ensureAppTray()
    }

    const mainWin = createMainWindow()

    if (settings.autoScanOnStartup) {
      indexScanner.scanSource().catch(() => undefined)
    }

    if (settings.autoCheckUpdates) {
      mainWin.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          if (getAllSettings().autoCheckUpdates) {
            cloudUpdater.checkForUpdates({ silent: true }).catch(() => undefined)
          }
        }, 3000)
      })
    }

    app.on('activate', () => {
      showAndFocusMainWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    destroyAppTray()
    watcherManager.stopAll()
    cadWorkerPool.dispose()
    closeDatabase()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && (!getAllSettings().closeToTray || isQuitting)) {
      app.quit()
    }
  })
}
