import { create } from 'zustand'
import type {
  AppInfo,
  AppSettings,
  AspectFilter,
  Asset,
  AssetQueryFilter,
  ConflictResolution,
  FileSizeFilter,
  GroupNode,
  ImportConflictItem,
  LibraryStats,
  ScanProgress,
  SmartView,
  SortField,
  SortOrder,
  SourceRoot,
  ThumbProgress,
  UpdateState
} from '@shared/types'
import { classifyExtension, type MediaType } from '@shared/mediaTypes'
import { getChangelogForVersion } from '@shared/changelog'
import { applyTypographyToDocument } from '../utils/fonts'

const PAGE_SIZE = 600

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
  videoHoverPreview: true,
  quickSearchEnabled: false,
  quickSearchShortcut: 'Alt+Space',
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
  favoriteCount: 0,
  ungroupedCount: 0,
  recentCount: 0,
  missingCount: 0,
  hiddenCount: 0,
  maskedOtherCount: 0,
  byType: { image: 0, video: 0, audio: 0, text: 0, model: 0, other: 0 },
  byRoot: {},
  extensions: [],
  extensionsByType: { image: [], video: [], audio: [], text: [], model: [], other: [] }
}

const EMPTY_THUMB_PROGRESS: ThumbProgress = {
  running: false,
  completed: 0,
  total: 0,
  pending: 0
}

interface ToastMessage {
  id: number
  text: string
  tone?: 'info' | 'success' | 'error'
}

interface LibraryState {
  initialized: boolean
  loading: boolean
  loadingMore: boolean
  hasMoreAssets: boolean
  settings: AppSettings
  sources: SourceRoot[]
  groups: GroupNode[]
  stats: LibraryStats
  assets: Asset[]
  totalAssets: number

  // Active filter & sort state
  smartView: SmartView
  mediaTypes: MediaType[]
  extensions: string[]
  aspectFilter: AspectFilter
  sizeFilter: FileSizeFilter
  hasNoteOnly: boolean
  colorHex: string | null
  filterBarOpen: boolean
  groupId: number | null
  rootId: number | null
  search: string
  sortField: SortField
  sortOrder: SortOrder

  // UI & selection state
  selectedIds: number[]
  lastClickedId: number | null
  previewAssetId: number | null
  compareAssetIds: number[]
  duplicatesOpen: boolean
  internalDragAssetIds: number[]
  settingsOpen: boolean
  settingsInitialTab: 'sources' | 'media' | 'controls' | 'appearance' | 'about'
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  scanProgress: ScanProgress
  thumbProgress: ThumbProgress
  modelThumbProgress: ThumbProgress
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
  loadMoreAssets: () => Promise<void>
  refreshAll: () => Promise<void>

  setSmartView: (view: SmartView) => void
  toggleMediaType: (type: MediaType, multi: boolean) => void
  clearMediaTypes: () => void
  toggleExtension: (ext: string) => void
  removeExtensions: (exts: string[]) => void
  clearExtensions: () => void
  setAspectFilter: (aspect: AspectFilter) => void
  setSizeFilter: (size: FileSizeFilter) => void
  setHasNoteOnly: (val: boolean) => void
  setColorHex: (hex: string | null) => void
  toggleFilterBar: () => void
  clearAdvancedFilters: () => void
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

  toggleFavorite: (ids: number[], forceValue?: boolean) => Promise<void>
  setPreviewAssetId: (id: number | null) => void
  openCompare: (ids: number[]) => void
  closeCompare: () => void
  openDuplicates: () => void
  closeDuplicates: () => void
  setInternalDragAssetIds: (ids: number[]) => void
  focusAssetById: (assetId: number) => Promise<void>
  openSettings: (tab?: 'sources' | 'media' | 'controls' | 'appearance' | 'about') => void
  closeSettings: () => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void

  setScanProgress: (progress: ScanProgress) => void
  setThumbProgress: (progress: ThumbProgress) => void
  setModelThumbProgress: (progress: ThumbProgress) => void
  setUpdateState: (state: UpdateState) => void
  openUpdateModal: () => void
  closeUpdateModal: () => void
  dismissWhatsNew: () => Promise<void>
  patchThumbReady: (payload: {
    assetId: number
    thumbPath: string
    width?: number | null
    height?: number | null
    dominantColors?: string[]
  }) => void
  patchThumbsReadyBatch: (
    payloads: Array<{
      assetId: number
      thumbPath: string
      width?: number | null
      height?: number | null
      dominantColors?: string[]
    }>
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
let querySeq = 0

function buildFilter(state: LibraryState, opts?: { limit?: number; offset?: number }): AssetQueryFilter {
  return {
    smartView: state.smartView,
    mediaTypes: state.mediaTypes,
    extensions: state.extensions,
    aspectFilter: state.aspectFilter,
    sizeFilter: state.sizeFilter,
    hasNoteOnly: state.hasNoteOnly,
    colorHex: state.colorHex,
    groupId: state.groupId,
    includeSubgroups: true,
    rootId: state.rootId,
    search: state.search,
    sortField: state.sortField,
    sortOrder: state.sortOrder,
    limit: opts?.limit ?? PAGE_SIZE,
    offset: opts?.offset ?? 0
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  initialized: false,
  loading: false,
  loadingMore: false,
  hasMoreAssets: false,
  settings: DEFAULT_SETTINGS,
  sources: [],
  groups: [],
  stats: EMPTY_STATS,
  assets: [],
  totalAssets: 0,

  smartView: 'all',
  mediaTypes: [],
  extensions: [],
  aspectFilter: 'all',
  sizeFilter: 'all',
  hasNoteOnly: false,
  colorHex: null,
  filterBarOpen: false,
  groupId: null,
  rootId: null,
  search: '',
  sortField: 'modified_at',
  sortOrder: 'desc',

  selectedIds: [],
  lastClickedId: null,
  previewAssetId: null,
  compareAssetIds: [],
  duplicatesOpen: false,
  internalDragAssetIds: [],
  settingsOpen: false,
  settingsInitialTab: 'sources',
  leftPanelOpen: true,
  rightPanelOpen: true,
  scanProgress: { running: false, scanned: 0, added: 0, updated: 0, relinked: 0, missing: 0 },
  thumbProgress: EMPTY_THUMB_PROGRESS,
  modelThumbProgress: EMPTY_THUMB_PROGRESS,
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
    const seq = ++querySeq
    set({ loading: true })
    try {
      const state = get()
      const prevPreviewId = state.previewAssetId
      const prevPreviewIdx = prevPreviewId != null ? state.assets.findIndex((a) => a.id === prevPreviewId) : -1
      // Keep already-loaded pagination depth when refreshing in-place so deep browsing (>2400) never loses position
      const desiredLimit = Math.max(PAGE_SIZE, Math.min(state.assets.length || PAGE_SIZE, 10000))
      const result = await window.api.assets.query(buildFilter(state, { limit: desiredLimit, offset: 0 }))
      if (seq !== querySeq) return

      let items = result.items
      const validSet = new Set(items.map((a) => a.id))
      let nextPreviewId: number | null =
        prevPreviewId != null && validSet.has(prevPreviewId) ? prevPreviewId : null

      if (prevPreviewId != null && nextPreviewId == null) {
        const stillExists = await window.api.assets.getById(prevPreviewId)
        if (seq !== querySeq) return
        const inUnfilteredAll =
          state.smartView === 'all' &&
          !state.groupId &&
          !state.rootId &&
          !state.search.trim() &&
          !state.colorHex &&
          state.mediaTypes.length === 0 &&
          state.extensions.length === 0 &&
          state.aspectFilter === 'all' &&
          state.sizeFilter === 'all' &&
          !state.hasNoteOnly
        if (stillExists && stillExists.status === 'active' && inUnfilteredAll) {
          items = [...items, stillExists]
          validSet.add(stillExists.id)
          nextPreviewId = stillExists.id
        } else if (items.length > 0 && prevPreviewIdx >= 0) {
          // Smoothly advance to neighbor when current item leaves filtered view (e.g. unfavorited in Favorites or trashed)
          nextPreviewId = items[Math.min(prevPreviewIdx, items.length - 1)].id
        }
      }

      set((s) => ({
        assets: items,
        totalAssets: result.total,
        hasMoreAssets: result.hasMore,
        loading: false,
        loadingMore: false,
        selectedIds:
          nextPreviewId != null && s.previewAssetId != null
            ? [nextPreviewId]
            : s.selectedIds.filter((id) => validSet.has(id)),
        previewAssetId: nextPreviewId,
        compareAssetIds: s.compareAssetIds.filter((id) => validSet.has(id))
      }))
    } catch {
      if (seq === querySeq) set({ loading: false })
    }
  },

  loadMoreAssets: async () => {
    const state = get()
    if (state.loading || state.loadingMore || !state.hasMoreAssets) return
    const seq = querySeq
    set({ loadingMore: true })
    try {
      const result = await window.api.assets.query(
        buildFilter(state, { limit: PAGE_SIZE, offset: state.assets.length })
      )
      if (seq !== querySeq) return
      set((s) => {
        const seen = new Set(s.assets.map((a) => a.id))
        const appended = result.items.filter((a) => !seen.has(a.id))
        const nextAssets = appended.length > 0 ? [...s.assets, ...appended] : s.assets
        return {
          assets: nextAssets,
          totalAssets: result.total,
          hasMoreAssets: result.hasMore && appended.length > 0,
          loadingMore: false
        }
      })
    } catch {
      if (seq === querySeq) set({ loadingMore: false })
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshMetadata(), get().refreshAssets()])
  },

  setSmartView: (smartView) => {
    set({ smartView, groupId: null, rootId: null, previewAssetId: null, compareAssetIds: [] })
    get().refreshAssets()
  },

  toggleMediaType: (type, multi) => {
    set((state) => {
      let nextMediaTypes: MediaType[]
      if (multi) {
        const exists = state.mediaTypes.includes(type)
        nextMediaTypes = exists ? state.mediaTypes.filter((t) => t !== type) : [...state.mediaTypes, type]
      } else if (state.mediaTypes.length === 1 && state.mediaTypes[0] === type) {
        nextMediaTypes = []
      } else {
        nextMediaTypes = [type]
      }

      const nextExtensions =
        nextMediaTypes.length > 0
          ? state.extensions.filter((ext) => nextMediaTypes.includes(classifyExtension(ext)))
          : state.extensions.filter((ext) => classifyExtension(ext) !== type)

      return {
        mediaTypes: nextMediaTypes,
        extensions: nextExtensions,
        previewAssetId: null,
        compareAssetIds: []
      }
    })
    get().refreshAssets()
  },

  clearMediaTypes: () => {
    set({ mediaTypes: [], extensions: [], previewAssetId: null, compareAssetIds: [] })
    get().refreshAssets()
  },

  toggleExtension: (ext) => {
    const lower = ext.toLowerCase()
    const norm = lower.startsWith('.') ? lower : `.${lower}`
    set((s) => ({
      extensions: s.extensions.includes(norm) ? s.extensions.filter((x) => x !== norm) : [...s.extensions, norm],
      previewAssetId: null,
      compareAssetIds: []
    }))
    get().refreshAssets()
  },

  removeExtensions: (exts) => {
    if (exts.length === 0) return
    const dropSet = new Set(exts.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
    set((s) => ({
      extensions: s.extensions.filter((x) => !dropSet.has(x)),
      previewAssetId: null,
      compareAssetIds: []
    }))
    get().refreshAssets()
  },

  clearExtensions: () => {
    set({ extensions: [] })
    get().refreshAssets()
  },

  setAspectFilter: (aspectFilter) => {
    set({ aspectFilter, previewAssetId: null, compareAssetIds: [] })
    get().refreshAssets()
  },

  setSizeFilter: (sizeFilter) => {
    set({ sizeFilter, previewAssetId: null, compareAssetIds: [] })
    get().refreshAssets()
  },

  setHasNoteOnly: (hasNoteOnly) => {
    set({ hasNoteOnly, previewAssetId: null, compareAssetIds: [] })
    get().refreshAssets()
  },

  setColorHex: (colorHex) => {
    set({ colorHex, previewAssetId: null, compareAssetIds: [] })
    get().refreshAssets()
  },

  toggleFilterBar: () => set((s) => ({ filterBarOpen: !s.filterBarOpen })),

  clearAdvancedFilters: () => {
    set({
      extensions: [],
      aspectFilter: 'all',
      sizeFilter: 'all',
      hasNoteOnly: false,
      colorHex: null
    })
    get().refreshAssets()
  },

  setGroupId: (groupId) => {
    set({ groupId, smartView: 'all', rootId: null, previewAssetId: null, compareAssetIds: [] })
    get().refreshAssets()
  },

  setRootId: (rootId) => {
    set({ rootId, smartView: 'all', groupId: null, previewAssetId: null, compareAssetIds: [] })
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
      extensions: [],
      aspectFilter: 'all',
      sizeFilter: 'all',
      hasNoteOnly: false,
      colorHex: null,
      groupId: null,
      rootId: null,
      search: '',
      previewAssetId: null,
      compareAssetIds: []
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
    if (patch.includeOtherFiles !== undefined) {
      set((state) => ({
        settings: next,
        mediaTypes: next.includeOtherFiles ? state.mediaTypes : state.mediaTypes.filter((t) => t !== 'other'),
        extensions: next.includeOtherFiles
          ? state.extensions
          : state.extensions.filter((ext) => classifyExtension(ext) !== 'other')
      }))
      await get().refreshAll()
      return
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
    const state = get()
    const loadedIds = state.assets.map((a) => a.id)
    set({ selectedIds: loadedIds })
    if (state.hasMoreAssets && state.totalAssets > loadedIds.length) {
      state.showToast(`已选中当前已加载的 ${loadedIds.length} 项（共 ${state.totalAssets} 项）`, 'info')
    }
  },

  clearSelection: () => set({ selectedIds: [], lastClickedId: null }),

  toggleFavorite: async (ids, forceValue) => {
    if (ids.length === 0) return
    const state = get()
    const idSet = new Set(ids)
    const targetAssets = state.assets.filter((a) => idSet.has(a.id))
    const nextVal =
      forceValue !== undefined
        ? forceValue
        : !(targetAssets.length > 0 && targetAssets.every((a) => a.isFavorite))

    // Optimistic update
    set((s) => ({
      assets:
        s.smartView === 'favorites' && !nextVal
          ? s.assets.filter((a) => !idSet.has(a.id))
          : s.assets.map((a) => (idSet.has(a.id) ? { ...a, isFavorite: nextVal } : a))
    }))

    await window.api.assets.setFavorite(ids, nextVal)
    get().showToast(
      nextVal
        ? ids.length > 1
          ? `已收藏 ${ids.length} 个素材`
          : '已添加到「我的收藏」'
        : ids.length > 1
          ? `已取消收藏 ${ids.length} 个素材`
          : '已取消收藏',
      'success'
    )
    await get().refreshMetadata()
  },

  setPreviewAssetId: (previewAssetId) => {
    set((state) => ({
      previewAssetId,
      compareAssetIds: previewAssetId != null ? [] : state.compareAssetIds,
      playingAudioId: previewAssetId != null ? null : state.playingAudioId,
      selectedIds: previewAssetId != null ? [previewAssetId] : state.selectedIds
    }))
  },

  openCompare: (ids) => {
    const unique = Array.from(new Set(ids)).slice(0, 4)
    if (unique.length < 2) return
    set({ compareAssetIds: unique, previewAssetId: null, playingAudioId: null })
  },

  closeCompare: () => set({ compareAssetIds: [] }),

  openDuplicates: () => set({ duplicatesOpen: true }),
  closeDuplicates: () => set({ duplicatesOpen: false }),

  setInternalDragAssetIds: (internalDragAssetIds) => set({ internalDragAssetIds }),

  focusAssetById: async (assetId) => {
    // Reset filters if the asset isn't in current list so user can always jump straight to it
    const cur = get().assets.find((a) => a.id === assetId)
    if (!cur) {
      set({
        smartView: 'all',
        mediaTypes: [],
        extensions: [],
        aspectFilter: 'all',
        sizeFilter: 'all',
        hasNoteOnly: false,
        colorHex: null,
        groupId: null,
        rootId: null,
        search: '',
        compareAssetIds: []
      })
      await get().refreshAssets()
    }
    const found = get().assets.find((a) => a.id === assetId)
    if (found) {
      set({ selectedIds: [assetId], lastClickedId: assetId, previewAssetId: assetId })
    } else {
      const single = await window.api.assets.getById(assetId)
      if (single) {
        set((s) => ({
          assets: [single, ...s.assets.filter((a) => a.id !== single.id)],
          selectedIds: [assetId],
          lastClickedId: assetId,
          previewAssetId: assetId
        }))
      }
    }
  },

  openSettings: (tab = 'sources') => set({ settingsOpen: true, settingsInitialTab: tab }),
  closeSettings: () => set({ settingsOpen: false }),

  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),

  setScanProgress: (scanProgress) => set({ scanProgress }),
  setThumbProgress: (thumbProgress) => set({ thumbProgress }),
  setModelThumbProgress: (modelThumbProgress) => set({ modelThumbProgress }),
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
    const map = new Map<
      number,
      { thumbPath: string; width?: number | null; height?: number | null; dominantColors?: string[] }
    >()
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
          height: hit.height ?? a.height,
          dominantColors: hit.dominantColors && hit.dominantColors.length > 0 ? hit.dominantColors : a.dominantColors
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
