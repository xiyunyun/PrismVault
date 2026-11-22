import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, protocol } from 'electron'
import { closeDatabase, initDatabase } from './db'
import { getAllSettings } from './db/repositories'
import { MEDIA_SCHEME, registerMediaProtocol } from './protocol'
import { registerIpcHandlers } from './ipc'
import { watcherManager } from './indexer/watcher'
import { indexScanner } from './indexer/scanner'

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

export function syncWindowTitleBarTheme(theme: 'dark' | 'light'): void {
  const isDark = theme === 'dark'
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setBackgroundColor(isDark ? '#202020' : '#f3f3f3')
    if (typeof win.setTitleBarOverlay === 'function') {
      win.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: isDark ? '#f3f3f3' : '#1a1a1a',
        height: 42
      })
    }
  }
}

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../resources/icon.png'),
    path.join(process.resourcesPath || '', 'icon.png')
  ]
  return candidates.find((p) => p && fs.existsSync(p))
}

function createMainWindow(): BrowserWindow {
  const settings = getAllSettings()
  const isDark = settings.theme === 'dark'

  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    title: 'PrismVault — 棱镜匣',
    icon: resolveAppIconPath(),
    backgroundColor: isDark ? '#202020' : '#f3f3f3',
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

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  initDatabase()
  registerMediaProtocol()
  registerIpcHandlers()
  watcherManager.initAll()

  createMainWindow()

  const settings = getAllSettings()
  if (settings.autoScanOnStartup) {
    indexScanner.scanSource().catch(() => undefined)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  watcherManager.stopAll()
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
