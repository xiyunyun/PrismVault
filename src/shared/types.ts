import type { MediaType } from './mediaTypes'

export type AssetStatus = 'active' | 'missing' | 'hidden'
export type SmartView = 'all' | 'ungrouped' | 'recent' | 'missing'
export type SortField = 'name' | 'created_at' | 'modified_at' | 'file_size'
export type SortOrder = 'asc' | 'desc'
export type ViewMode = 'waterfall' | 'grid'
export type GridAspectRatio = '4:3' | '1:1' | '16:9'
export type GridFitMode = 'cover' | 'contain'

export interface AssetExtraMeta {
  fps?: number
  videoCodec?: string
  audioCodec?: string
  bitrate?: number
  sampleRate?: number
  channels?: number
  artist?: string
  album?: string
  title?: string
  lineCount?: number
  charCount?: number
  format?: string
  layerCount?: number
  layerNames?: string[]
  colorMode?: string
  bitsPerChannel?: number
}

export interface SourceRoot {
  id: number
  path: string
  alias: string
  watchEnabled: boolean
  ignorePatterns: string[]
  lastScannedAt: number | null
  createdAt: number
  assetCount: number
}

export interface Asset {
  id: number
  rootId: number
  filePath: string
  fileName: string
  ext: string
  mediaType: MediaType
  mimeType: string
  fileSize: number
  createdAt: number
  modifiedAt: number
  fingerprint: string | null
  width: number | null
  height: number | null
  duration: number | null
  extraMeta: AssetExtraMeta | null
  note: string
  thumbPath: string | null
  textSnippet: string | null
  status: AssetStatus
  indexedAt: number
  groupIds: number[]
}

export interface GroupFlat {
  id: number
  parentId: number | null
  name: string
  color: string
  sortOrder: number
  createdAt: number
  assetCount: number
}

export interface GroupNode extends GroupFlat {
  totalCount: number
  children: GroupNode[]
}

export interface AssetQueryFilter {
  smartView: SmartView
  mediaTypes: MediaType[]
  groupId: number | null
  includeSubgroups?: boolean
  rootId: number | null
  search: string
  sortField: SortField
  sortOrder: SortOrder
}

export interface AssetQueryResult {
  items: Asset[]
  total: number
}

export interface LibraryStats {
  totalActive: number
  ungroupedCount: number
  recentCount: number
  missingCount: number
  byType: Record<MediaType, number>
  byRoot: Record<number, number>
}

export interface ScanProgress {
  running: boolean
  rootId?: number
  rootName?: string
  scanned: number
  added: number
  updated: number
  relinked: number
  missing: number
  currentFile?: string
}

export interface AppSettings {
  theme: 'dark' | 'light'
  fontFamily: string
  fontSize: number
  viewMode: ViewMode
  gridAspectRatio: GridAspectRatio
  gridFitMode: GridFitMode
  cardSize: number
  ffmpegPath: string
  thumbCacheDir: string
  clipboardDir: string
  includeOtherFiles: boolean
  autoScanOnStartup: boolean
}

export interface MoveThumbCacheResult {
  oldDir: string
  newDir: string
  movedCount: number
  failedCount: number
}

export interface ClipboardStats {
  dir: string
  isCustom: boolean
  fileCount: number
  totalBytes: number
}

export interface EagleInspectResult {
  valid: boolean
  libraryPath: string
  libraryName: string
  folderCount: number
  itemCount: number
  error?: string
}

export interface EagleMigrationProgress {
  running: boolean
  total: number
  processed: number
  imported: number
  skipped: number
  failed: number
  currentFile?: string
}

export interface EagleMigrationResult {
  imported: number
  skipped: number
  failed: number
  groupsCreated: number
  deletedOriginals: number
  targetDir: string
  rootId: number
}

export interface CacheStats {
  thumbCount: number
  thumbBytes: number
  dbBytes: number
  cacheDir: string
  dbPath: string
}

export interface FfmpegStatus {
  available: boolean
  ffmpegPath: string | null
  ffprobePath: string | null
}

export interface TextContentResult {
  content: string
  truncated: boolean
  totalBytes: number
}

export interface XiyunApi {
  sources: {
    list: () => Promise<SourceRoot[]>
    pickAndAdd: () => Promise<SourceRoot | null>
    addPath: (dirPath: string, alias?: string) => Promise<SourceRoot>
    remove: (id: number) => Promise<void>
    update: (id: number, patch: { alias?: string; watchEnabled?: boolean; ignorePatterns?: string[] }) => Promise<SourceRoot>
    scan: (id?: number) => Promise<void>
  }
  assets: {
    query: (filter: AssetQueryFilter) => Promise<AssetQueryResult>
    getStats: () => Promise<LibraryStats>
    getById: (id: number) => Promise<Asset | null>
    updateNote: (id: number, note: string) => Promise<void>
    batchAppendNote: (ids: number[], text: string) => Promise<void>
    setStatus: (ids: number[], status: AssetStatus) => Promise<void>
    moveToTrash: (ids: number[]) => Promise<{ trashed: number; failed: string[] }>
    readTextContent: (id: number) => Promise<TextContentResult>
    removeMissing: (ids?: number[]) => Promise<number>
  }
  groups: {
    listTree: () => Promise<GroupNode[]>
    create: (data: { name: string; parentId?: number | null; color?: string }) => Promise<GroupFlat>
    update: (id: number, patch: { name?: string; parentId?: number | null; color?: string; sortOrder?: number }) => Promise<GroupFlat>
    delete: (id: number) => Promise<void>
    assignAssets: (assetIds: number[], groupIds: number[]) => Promise<void>
    unassignAssets: (assetIds: number[], groupIds: number[]) => Promise<void>
  }
  settings: {
    getAll: () => Promise<AppSettings>
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>
    getCacheStats: () => Promise<CacheStats>
    clearThumbCache: () => Promise<void>
    rebuildMissingThumbs: () => Promise<number>
    pickAndMoveThumbCacheDir: () => Promise<MoveThumbCacheResult | null>
    resetThumbCacheDir: () => Promise<MoveThumbCacheResult | null>
    exportDbBackup: () => Promise<string | null>
    pickFfmpegPath: () => Promise<string | null>
  }
  system: {
    revealInExplorer: (filePath: string) => Promise<void>
    openExternal: (filePath: string) => Promise<void>
    openExternalUrl: (url: string) => Promise<void>
    copyPath: (filePath: string) => Promise<void>
    checkFfmpeg: () => Promise<FfmpegStatus>
  }
  clipboard: {
    pasteImage: (targetGroupId?: number | null) => Promise<{ ok: boolean; asset?: Asset; reason?: string }>
    getStats: () => Promise<ClipboardStats>
    pickAndMoveDir: () => Promise<MoveThumbCacheResult | null>
    resetDir: () => Promise<MoveThumbCacheResult | null>
  }
  eagle: {
    pickLibrary: () => Promise<EagleInspectResult | null>
    pickTargetDir: () => Promise<string | null>
    migrate: (opts: { eagleDir: string; targetDir: string; deleteOriginals: boolean }) => Promise<EagleMigrationResult>
  }
  events: {
    onScanProgress: (cb: (progress: ScanProgress) => void) => () => void
    onThumbReady: (cb: (payload: { assetId: number; thumbPath: string; width?: number | null; height?: number | null }) => void) => () => void
    onAssetsChanged: (cb: () => void) => () => void
    onEagleProgress: (cb: (progress: EagleMigrationProgress) => void) => () => void
  }
}
