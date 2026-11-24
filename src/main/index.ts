import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  screen,
  shell,
  Tray
} from 'electron'
import { closeDatabase, initDatabase } from './db'
import { getAllSettings } from './db/repositories'
import { MEDIA_SCHEME, registerMediaProtocol } from './protocol'
import { registerIpcHandlers } from './ipc'
import { watcherManager } from './indexer/watcher'
import { indexScanner } from './indexer/scanner'
import { thumbnailQueue } from './indexer/thumbnailer'
import { cloudUpdater } from './updater'
import { cadWorkerPool } from './indexer/cad'
import type { BackdropStyle } from '@shared/types'

let mainWindowRef: BrowserWindow | null = null
let quickSearchWindowRef: BrowserWindow | null = null
let appTray: Tray | null = null
let isQuitting = false
let hasShownTrayBalloon = false
let registeredQuickSearchShortcut: string | null = null
let lastQuickSearchShortcutError: string | null = null
let lastAutoUpdateCheckAt = 0
let updateCheckInterval: ReturnType<typeof setInterval> | null = null

const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const AUTO_UPDATE_WAKE_MIN_GAP_MS = 4 * 60 * 60 * 1000 // 4 hours on tray wake

const isQuitRunningArg = process.argv.includes('--quit-running')
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock || isQuitRunningArg) {
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
    // Exclude the transparent frameless Spotlight overlay from main-window Mica / titleBarOverlay mutations
    if (win === quickSearchWindowRef) {
      win.webContents.send('event:quicksearch-opened')
      continue
    }
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

function triggerSilentUpdateCheckIfDue(minGapMs = 0): void {
  if (!getAllSettings().autoCheckUpdates) return
  const now = Date.now()
  if (minGapMs > 0 && now - lastAutoUpdateCheckAt < minGapMs) return
  lastAutoUpdateCheckAt = now
  cloudUpdater.checkForUpdates({ silent: true }).catch(() => undefined)
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
    triggerSilentUpdateCheckIfDue(AUTO_UPDATE_WAKE_MIN_GAP_MS)
  }
  mainWindowRef.focus()
}

function isAllowedRendererNavigation(url: string): boolean {
  const devBase = process.env.ELECTRON_RENDERER_URL
  if (devBase) {
    try {
      const allowedOrigin = new URL(devBase).origin
      return new URL(url).origin === allowedOrigin
    } catch {
      return url.startsWith(devBase)
    }
  }
  return url.startsWith('file://')
}

function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => undefined)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedRendererNavigation(url)) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => undefined)
      }
    }
  })
}

function createQuickSearchWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 680,
    height: 500,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  hardenWebContents(win)

  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide()
    }
  })

  win.on('closed', () => {
    if (quickSearchWindowRef === win) {
      quickSearchWindowRef = null
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const sep = process.env.ELECTRON_RENDERER_URL.includes('?') ? '&' : '?'
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${sep}mode=quicksearch`)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { mode: 'quicksearch' }
    })
  }

  quickSearchWindowRef = win
  return win
}

export function toggleQuickSearchWindow(): void {
  if (!quickSearchWindowRef || quickSearchWindowRef.isDestroyed()) {
    createQuickSearchWindow()
  }
  const win = quickSearchWindowRef!
  if (win.isVisible()) {
    win.hide()
    return
  }
  // Center on the display currently holding the user's cursor
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  const winW = 680
  const winH = 500
  const targetX = Math.round(x + (width - winW) / 2)
  const targetY = Math.round(y + Math.max(48, (height - winH) * 0.22))
  win.setBounds({ x: targetX, y: targetY, width: winW, height: winH })
  win.show()
  win.focus()
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('event:quicksearch-opened')
      }
    })
  } else {
    win.webContents.send('event:quicksearch-opened')
  }
}

export function hideQuickSearchWindow(): void {
  if (quickSearchWindowRef && !quickSearchWindowRef.isDestroyed() && quickSearchWindowRef.isVisible()) {
    quickSearchWindowRef.hide()
  }
}

export function openAssetInMainWindow(assetId: number): void {
  hideQuickSearchWindow()
  showAndFocusMainWindow()
  const win = mainWindowRef
  if (!win || win.isDestroyed()) return
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('event:focus-asset', assetId)
      }
    })
  } else {
    win.webContents.send('event:focus-asset', assetId)
  }
}

export function getQuickSearchShortcutStatus(): {
  registered: boolean
  shortcut: string
  error: string | null
} {
  const s = getAllSettings()
  return {
    registered: Boolean(registeredQuickSearchShortcut),
    shortcut: registeredQuickSearchShortcut || (s.quickSearchShortcut || 'Alt+Space').trim(),
    error: s.quickSearchEnabled ? lastQuickSearchShortcutError : null
  }
}

export function syncQuickSearchShortcut(enabled: boolean, shortcut: string): { ok: boolean; error?: string } {
  if (registeredQuickSearchShortcut) {
    try {
      globalShortcut.unregister(registeredQuickSearchShortcut)
    } catch {
      // ignore
    }
    registeredQuickSearchShortcut = null
  }
  if (!enabled) {
    lastQuickSearchShortcutError = null
    hideQuickSearchWindow()
    return { ok: true }
  }
  const accel = (shortcut || 'Alt+Space').trim()
  if (!accel) {
    lastQuickSearchShortcutError = '快捷键不能为空'
    return { ok: false, error: lastQuickSearchShortcutError }
  }
  try {
    const ok = globalShortcut.register(accel, () => {
      toggleQuickSearchWindow()
    })
    if (ok) {
      registeredQuickSearchShortcut = accel
      lastQuickSearchShortcutError = null
      return { ok: true }
    }
    lastQuickSearchShortcutError = `快捷键 ${accel} 已被系统或其他软件占用，请切换其他组合`
    return { ok: false, error: lastQuickSearchShortcutError }
  } catch (err) {
    lastQuickSearchShortcutError = err instanceof Error ? err.message : '注册全局快捷键失败'
    return { ok: false, error: lastQuickSearchShortcutError }
  }
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

  hardenWebContents(win)

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

if (gotSingleInstanceLock && !isQuitRunningArg) {
  app.on('second-instance', (_event, commandLine) => {
    if (Array.isArray(commandLine) && commandLine.includes('--quit-running')) {
      isQuitting = true
      app.quit()
      return
    }
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
    syncQuickSearchShortcut(Boolean(settings.quickSearchEnabled), settings.quickSearchShortcut || 'Alt+Space')
    if (settings.closeToTray) {
      ensureAppTray()
    }

    const mainWin = createMainWindow()

    if (settings.autoScanOnStartup) {
      indexScanner.scanSource().catch(() => undefined)
    }

    // Low-priority background dominant-color backfill for existing image libraries
    setTimeout(() => {
      thumbnailQueue.backfillMissingColors().catch(() => undefined)
    }, 5500)

    if (settings.autoCheckUpdates) {
      mainWin.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          triggerSilentUpdateCheckIfDue(0)
        }, 3000)
      })
    }

    // Lightweight periodic silent update check every 6 hours while tray-resident
    if (updateCheckInterval) clearInterval(updateCheckInterval)
    updateCheckInterval = setInterval(() => {
      triggerSilentUpdateCheckIfDue(AUTO_UPDATE_INTERVAL_MS - 60_000)
    }, AUTO_UPDATE_INTERVAL_MS)

    app.on('activate', () => {
      showAndFocusMainWindow()
    })
  })

  app.on('will-quit', () => {
    try {
      globalShortcut.unregisterAll()
    } catch {
      // ignore
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    if (updateCheckInterval) {
      clearInterval(updateCheckInterval)
      updateCheckInterval = null
    }
    if (quickSearchWindowRef && !quickSearchWindowRef.isDestroyed()) {
      quickSearchWindowRef.destroy()
      quickSearchWindowRef = null
    }
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
