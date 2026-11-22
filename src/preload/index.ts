import { contextBridge, ipcRenderer } from 'electron'
import type { XiyunApi } from '@shared/types'

const api: XiyunApi = {
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    pickAndAdd: () => ipcRenderer.invoke('sources:pickAndAdd'),
    addPath: (dirPath, alias) => ipcRenderer.invoke('sources:addPath', dirPath, alias),
    remove: (id) => ipcRenderer.invoke('sources:remove', id),
    update: (id, patch) => ipcRenderer.invoke('sources:update', id, patch),
    scan: (id) => ipcRenderer.invoke('sources:scan', id)
  },
  assets: {
    query: (filter) => ipcRenderer.invoke('assets:query', filter),
    getStats: () => ipcRenderer.invoke('assets:getStats'),
    getById: (id) => ipcRenderer.invoke('assets:getById', id),
    updateNote: (id, note) => ipcRenderer.invoke('assets:updateNote', id, note),
    batchAppendNote: (ids, text) => ipcRenderer.invoke('assets:batchAppendNote', ids, text),
    setStatus: (ids, status) => ipcRenderer.invoke('assets:setStatus', ids, status),
    moveToTrash: (ids) => ipcRenderer.invoke('assets:moveToTrash', ids),
    readTextContent: (id) => ipcRenderer.invoke('assets:readTextContent', id),
    removeMissing: (ids) => ipcRenderer.invoke('assets:removeMissing', ids)
  },
  groups: {
    listTree: () => ipcRenderer.invoke('groups:listTree'),
    create: (data) => ipcRenderer.invoke('groups:create', data),
    update: (id, patch) => ipcRenderer.invoke('groups:update', id, patch),
    delete: (id) => ipcRenderer.invoke('groups:delete', id),
    assignAssets: (assetIds, groupIds) => ipcRenderer.invoke('groups:assignAssets', assetIds, groupIds),
    unassignAssets: (assetIds, groupIds) => ipcRenderer.invoke('groups:unassignAssets', assetIds, groupIds)
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    getCacheStats: () => ipcRenderer.invoke('settings:getCacheStats'),
    clearThumbCache: () => ipcRenderer.invoke('settings:clearThumbCache'),
    rebuildMissingThumbs: () => ipcRenderer.invoke('settings:rebuildMissingThumbs'),
    pickAndMoveThumbCacheDir: () => ipcRenderer.invoke('settings:pickAndMoveThumbCacheDir'),
    resetThumbCacheDir: () => ipcRenderer.invoke('settings:resetThumbCacheDir'),
    exportDbBackup: () => ipcRenderer.invoke('settings:exportDbBackup'),
    pickFfmpegPath: () => ipcRenderer.invoke('settings:pickFfmpegPath')
  },
  system: {
    revealInExplorer: (filePath) => ipcRenderer.invoke('system:revealInExplorer', filePath),
    openExternal: (filePath) => ipcRenderer.invoke('system:openExternal', filePath),
    openExternalUrl: (url) => ipcRenderer.invoke('system:openExternalUrl', url),
    copyPath: (filePath) => ipcRenderer.invoke('system:copyPath', filePath),
    checkFfmpeg: () => ipcRenderer.invoke('system:checkFfmpeg')
  },
  clipboard: {
    pasteImage: (targetGroupId) => ipcRenderer.invoke('clipboard:pasteImage', targetGroupId),
    getStats: () => ipcRenderer.invoke('clipboard:getStats'),
    pickAndMoveDir: () => ipcRenderer.invoke('clipboard:pickAndMoveDir'),
    resetDir: () => ipcRenderer.invoke('clipboard:resetDir')
  },
  eagle: {
    pickLibrary: () => ipcRenderer.invoke('eagle:pickLibrary'),
    pickTargetDir: () => ipcRenderer.invoke('eagle:pickTargetDir'),
    migrate: (opts) => ipcRenderer.invoke('eagle:migrate', opts)
  },
  events: {
    onScanProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, progress: Parameters<typeof cb>[0]) => cb(progress)
      ipcRenderer.on('event:scan-progress', listener)
      return () => ipcRenderer.removeListener('event:scan-progress', listener)
    },
    onThumbReady: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on('event:thumb-ready', listener)
      return () => ipcRenderer.removeListener('event:thumb-ready', listener)
    },
    onAssetsChanged: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('event:assets-changed', listener)
      return () => ipcRenderer.removeListener('event:assets-changed', listener)
    },
    onEagleProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, progress: Parameters<typeof cb>[0]) => cb(progress)
      ipcRenderer.on('event:eagle-progress', listener)
      return () => ipcRenderer.removeListener('event:eagle-progress', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
