import { create } from 'zustand'
import type {
  AppInfo,
  AppSettings,
  Asset,
  AssetQueryFilter,
  ConflictResolution,
  GroupNode,
  ImportConflictItem,
  LibraryStats,
  ScanProgress,
  SmartView,
  SortField,
  SortOrder,
  SourceRoot,
  UpdateState
} from '@shared/types'
import type { MediaType } from '@shared/mediaTypes'
import { getChangelogForVersion } from '@shared/changelog'
import { applyTypographyToDocument } from '../utils/fonts'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  backdropStyle: 'aurora',
  backdropMotion: true,
  fontFamily: 'system',
  fontSize: 15,
  viewMode: 'waterfall',
  gridAspectRatio: '4:3',
  gridFitMode: 'cover',
  cardSize: 230,
  ffmpegPath: '',
  thumbCacheDir: '',
  clipboardDir: '',
  clipboardMaxFiles: 10,
  clipboardMaxSizeMB: 30,
  previewWheelMode: 'zoom',
  includeOtherFiles: false,
  autoScanOnStartup: false,
  closeToTray: true,
  autoLaunch: true,
  autoCheckUpdates: true,
  updateMirrorUrl: '',
  deleteThumbsOnRemoveSource: true,
  lastSeenVersion: ''
}

export interface ConfirmDialogOptions {
  title: string
  message: string
  detail?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
}

interface ConfirmDialogState extends ConfirmDialogOptions {
  resolve: (accepted: boolean) => void
}

interface ImportConflictDialogState {
  conflicts: ImportConflictItem[]
  resolve: (resolutions: Record<string, ConflictResolution> | null) => void
}

const EMPTY_STATS: LibraryStats = {
  totalActive: 0,
  ungroupedCount: 0,
  recentCount: 0,
  missingCount: 0,
  hiddenCount: 0,
  byType: { image: 0, video: 0, audio: 0, text: 0, model: 0, other: 0 },
  byRoot: {}
}

interface ToastMessage {
  id: number
  text: string
  tone?: 'info' | 'success' | 'error'
}

interface LibraryState {
  initialized: boolean
  loading: boolean
  settings: AppSettings
  sources: SourceRoot[]
  groups: GroupNode[]
  stats: LibraryStats
  assets: Asset[]
  totalAssets: number

  // Active filter & sort state
  smartView: SmartView
  mediaTypes: MediaType[]
  groupId: number | null
  rootId: number | null
  search: string
  sortField: SortField
  sortOrder: SortOrder

  // UI & selection state
  selectedIds: number[]
  lastClickedId: number | null
  previewAssetId: number | null
  settingsOpen: boolean
  settingsInitialTab: 'sources' | 'media' | 'controls' | 'appearance' | 'about'
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  scanProgress: ScanProgress
  toast: ToastMessage | null
  confirmDialog: ConfirmDialogState | null
  importConflictDialog: ImportConflictDialogState | null

  // Inline quick audio playback state
  playingAudioId: number | null

  // App metadata & Cloud Updater state
  appInfo: AppInfo | null
  updateState: UpdateState | null
  updateModalOpen: boolean
  whatsNewOpen: boolean

  // Actions
  init: () => Promise<void>
  refreshMetadata: () => Promise<void>
  refreshAssets: () => Promise<void>
  refreshAll: () => Promise<void>

  setSmartView: (view: SmartView) => void
  toggleMediaType: (type: MediaType, multi: boolean) => void
  clearMediaTypes: () => void
  setGroupId: (groupId: number | null) => void
  setRootId: (rootId: number | null) => void
  setSearch: (search: string) => void
  setSort: (field: SortField, order?: SortOrder) => void
  resetFilters: () => void

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  setCardSizeLocal: (cardSize: number) => void

  selectAsset: (id: number, opts?: { ctrl?: boolean; shift?: boolean }) => void
  setSelectedIds: (ids: number[]) => void
  selectAll: () => void
  clearSelection: () => void

  setPreviewAssetId: (id: number | null) => void
  openSettings: (tab?: 'sources' | 'media' | 'controls' | 'appearance' | 'about') => void
  closeSettings: () => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void

  setScanProgress: (progress: ScanProgress) => void
  setUpdateState: (state: UpdateState) => void
  openUpdateModal: () => void
  closeUpdateModal: () => void
  dismissWhatsNew: () => Promise<void>
  patchThumbReady: (payload: { assetId: number; thumbPath: string; width?: number | null; height?: number | null }) => void
  patchThumbsReadyBatch: (
    payloads: Array<{ assetId: number; thumbPath: string; width?: number | null; height?: number | null }>
  ) => void
  updateAssetNoteLocal: (id: number, note: string) => void
  setPlayingAudioId: (id: number | null) => void
  showToast: (text: string, tone?: 'info' | 'success' | 'error') => void
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
  resolveConfirm: (accepted: boolean) => void
  resolveImportConflicts: (conflicts: ImportConflictItem[]) => Promise<Record<string, ConflictResolution> | null>
  finishImportConflicts: (resolutions: Record<string, ConflictResolution> | null) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastCounter = 0

function buildFilter(state: LibraryState): AssetQueryFilter {
  return {
    smartView: state.smartView,
    mediaTypes: state.mediaTypes,
    groupId: state.groupId,
    includeSubgroups: true,
    rootId: state.rootId,
    search: state.search,
    sortField: state.sortField,
    sortOrder: state.sortOrder
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  initialized: false,
  loading: false,
  settings: DEFAULT_SETTINGS,
  sources: [],
  groups: [],
  stats: EMPTY_STATS,
  assets: [],
  totalAssets: 0,

  smartView: 'all',
  mediaTypes: [],
  groupId: null,
  rootId: null,
  search: '',
  sortField: 'modified_at',
  sortOrder: 'desc',

  selectedIds: [],
  lastClickedId: null,
  previewAssetId: null,
  settingsOpen: false,
  settingsInitialTab: 'sources',
  leftPanelOpen: true,
  rightPanelOpen: true,
  scanProgress: { running: false, scanned: 0, added: 0, updated: 0, relinked: 0, missing: 0 },
  toast: null,
  confirmDialog: null,
  importConflictDialog: null,
  playingAudioId: null,
  appInfo: null,
  updateState: null,
  updateModalOpen: false,
  whatsNewOpen: false,

  init: async () => {
    const [settings, appInfo, updateState] = await Promise.all([
      window.api.settings.getAll(),
      window.api.system.getAppInfo(),
      window.api.updater.getState()
    ])
    const effectiveBackdrop =
      settings.backdropStyle === 'mica' && !appInfo.micaSupported ? 'aurora' : settings.backdropStyle || 'aurora'
    const normalizedSettings =
      effectiveBackdrop === settings.backdropStyle ? settings : { ...settings, backdropStyle: effectiveBackdrop }

    document.documentElement.setAttribute('data-theme', normalizedSettings.theme)
    document.documentElement.setAttribute('data-backdrop', normalizedSettings.backdropStyle)
    document.documentElement.setAttribute('data-motion', normalizedSettings.backdropMotion === false ? 'off' : 'on')
    applyTypographyToDocument(normalizedSettings.fontFamily, normalizedSettings.fontSize)

    const curVer = appInfo.version.trim().replace(/^[vV]+/, '')
    const seenVer = (normalizedSettings.lastSeenVersion || '').trim().replace(/^[vV]+/, '')
    const shouldShowWhatsNew = Boolean(curVer && seenVer !== curVer && getChangelogForVersion(curVer))

    set({ settings: normalizedSettings, appInfo, updateState, whatsNewOpen: shouldShowWhatsNew, initialized: true })
    await get().refreshAll()
  },

  refreshMetadata: async () => {
    const [sources, groups, stats] = await Promise.all([
      window.api.sources.list(),
      window.api.groups.listTree(),
      window.api.assets.getStats()
    ])
    set({ sources, groups, stats })
  },

  refreshAssets: async () => {
    set({ loading: true })
    try {
      const result = await window.api.assets.query(buildFilter(get()))
      const validSet = new Set(result.items.map((a) => a.id))
      set((state) => ({
        assets: result.items,
        totalAssets: result.total,
        loading: false,
        selectedIds: state.selectedIds.filter((id) => validSet.has(id)),
        previewAssetId: state.previewAssetId != null && validSet.has(state.previewAssetId) ? state.previewAssetId : null
      }))
    } catch {
      set({ loading: false })
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshMetadata(), get().refreshAssets()])
  },

  setSmartView: (smartView) => {
    set({ smartView, groupId: null, rootId: null, previewAssetId: null })
    get().refreshAssets()
  },

  toggleMediaType: (type, multi) => {
    set((state) => {
      if (multi) {
        const exists = state.mediaTypes.includes(type)
        return {
          mediaTypes: exists ? state.mediaTypes.filter((t) => t !== type) : [...state.mediaTypes, type],
          previewAssetId: null
        }
      }
      if (state.mediaTypes.length === 1 && state.mediaTypes[0] === type) {
        return { mediaTypes: [], previewAssetId: null }
      }
      return { mediaTypes: [type], previewAssetId: null }
    })
    get().refreshAssets()
  },

  clearMediaTypes: () => {
    set({ mediaTypes: [], previewAssetId: null })
    get().refreshAssets()
  },

  setGroupId: (groupId) => {
    set({ groupId, smartView: 'all', rootId: null, previewAssetId: null })
    get().refreshAssets()
  },

  setRootId: (rootId) => {
    set({ rootId, smartView: 'all', groupId: null, previewAssetId: null })
    get().refreshAssets()
  },

  setSearch: (search) => {
    set({ search })
    get().refreshAssets()
  },

  setSort: (sortField, order) => {
    set((state) => {
      if (order) return { sortField, sortOrder: order }
      if (state.sortField === sortField) {
        return { sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' }
      }
      return { sortField, sortOrder: sortField === 'name' ? 'asc' : 'desc' }
    })
    get().refreshAssets()
  },

  resetFilters: () => {
    set({
      smartView: 'all',
      mediaTypes: [],
      groupId: null,
      rootId: null,
      search: '',
      previewAssetId: null
    })
    get().refreshAssets()
  },

  updateSettings: async (patch) => {
    const next = await window.api.settings.update(patch)
    if (patch.theme !== undefined) {
      document.documentElement.setAttribute('data-theme', next.theme)
    }
    if (patch.backdropStyle !== undefined) {
      document.documentElement.setAttribute('data-backdrop', next.backdropStyle)
    }
    if (patch.backdropMotion !== undefined) {
      document.documentElement.setAttribute('data-motion', next.backdropMotion ? 'on' : 'off')
    }
    if (patch.fontFamily !== undefined || patch.fontSize !== undefined) {
      applyTypographyToDocument(next.fontFamily, next.fontSize)
    }
    set({ settings: next })
  },

  setCardSizeLocal: (cardSize) => {
    set((state) =>
      state.settings.cardSize === cardSize ? state : { settings: { ...state.settings, cardSize } }
    )
  },

  selectAsset: (id, opts) => {
    const state = get()
    if (opts?.shift && state.lastClickedId != null) {
      const idxA = state.assets.findIndex((a) => a.id === state.lastClickedId)
      const idxB = state.assets.findIndex((a) => a.id === id)
      if (idxA !== -1 && idxB !== -1) {
        const start = Math.min(idxA, idxB)
        const end = Math.max(idxA, idxB)
        const rangeIds = state.assets.slice(start, end + 1).map((a) => a.id)
        const merged = opts.ctrl ? Array.from(new Set([...state.selectedIds, ...rangeIds])) : rangeIds
        set({ selectedIds: merged })
        return
      }
    }
    if (opts?.ctrl) {
      const exists = state.selectedIds.includes(id)
      const next = exists ? state.selectedIds.filter((x) => x !== id) : [...state.selectedIds, id]
      set({ selectedIds: next, lastClickedId: id })
      return
    }
    set({ selectedIds: [id], lastClickedId: id })
  },

  setSelectedIds: (ids) => set({ selectedIds: ids }),

  selectAll: () => {
    set((state) => ({ selectedIds: state.assets.map((a) => a.id) }))
  },

  clearSelection: () => set({ selectedIds: [], lastClickedId: null }),

  setPreviewAssetId: (previewAssetId) => {
    set((state) => ({
      previewAssetId,
      playingAudioId: previewAssetId != null ? null : state.playingAudioId,
      selectedIds: previewAssetId != null ? [previewAssetId] : state.selectedIds
    }))
  },

  openSettings: (tab = 'sources') => set({ settingsOpen: true, settingsInitialTab: tab }),
  closeSettings: () => set({ settingsOpen: false }),

  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),

  setScanProgress: (scanProgress) => set({ scanProgress }),
  setUpdateState: (updateState) => set({ updateState }),
  openUpdateModal: () => set({ updateModalOpen: true }),
  closeUpdateModal: () => set({ updateModalOpen: false }),
  dismissWhatsNew: async () => {
    const ver = get().appInfo?.version?.trim().replace(/^[vV]+/, '') || ''
    set({ whatsNewOpen: false })
    if (ver) {
      await get().updateSettings({ lastSeenVersion: ver })
    }
  },

  patchThumbReady: (payload) => {
    get().patchThumbsReadyBatch([payload])
  },

  patchThumbsReadyBatch: (payloads) => {
    if (payloads.length === 0) return
    const map = new Map<number, { thumbPath: string; width?: number | null; height?: number | null }>()
    for (const p of payloads) {
      map.set(p.assetId, p)
    }
    set((state) => {
      let changed = false
      const nextAssets = state.assets.map((a) => {
        const hit = map.get(a.id)
        if (!hit) return a
        changed = true
        return {
          ...a,
          thumbPath: hit.thumbPath,
          width: hit.width ?? a.width,
          height: hit.height ?? a.height
        }
      })
      return changed ? { assets: nextAssets } : state
    })
  },

  updateAssetNoteLocal: (id, note) => {
    set((state) => {
      const idx = state.assets.findIndex((a) => a.id === id)
      if (idx === -1 || state.assets[idx].note === note) return state
      const nextAssets = state.assets.slice()
      nextAssets[idx] = { ...nextAssets[idx], note }
      return { assets: nextAssets }
    })
  },

  setPlayingAudioId: (playingAudioId) => set({ playingAudioId }),

  showToast: (text, tone = 'info') => {
    if (toastTimer) clearTimeout(toastTimer)
    const id = ++toastCounter
    set({ toast: { id, text, tone } })
    toastTimer = setTimeout(() => {
      set((state) => (state.toast?.id === id ? { toast: null } : state))
    }, 2800)
  },

  confirm: (options) => {
    return new Promise<boolean>((resolve) => {
      const existing = get().confirmDialog
      if (existing) existing.resolve(false)
      set({ confirmDialog: { ...options, resolve } })
    })
  },

  resolveConfirm: (accepted) => {
    const cur = get().confirmDialog
    if (cur) {
      set({ confirmDialog: null })
      cur.resolve(accepted)
    }
  },

  resolveImportConflicts: (conflicts) => {
    return new Promise<Record<string, ConflictResolution> | null>((resolve) => {
      const existing = get().importConflictDialog
      if (existing) existing.resolve(null)
      set({ importConflictDialog: { conflicts, resolve } })
    })
  },

  finishImportConflicts: (resolutions) => {
    const cur = get().importConflictDialog
    if (cur) {
      set({ importConflictDialog: null })
      cur.resolve(resolutions)
    }
  }
}))
