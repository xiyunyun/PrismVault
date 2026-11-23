import type { MediaType } from './mediaTypes'

export type AssetStatus = 'active' | 'missing' | 'hidden'
export type SmartView = 'all' | 'favorites' | 'ungrouped' | 'recent' | 'missing' | 'hidden'
export type SortField = 'name' | 'created_at' | 'modified_at' | 'file_size'
export type SortOrder = 'asc' | 'desc'
export type ViewMode = 'waterfall' | 'grid'
export type GridAspectRatio = '4:3' | '1:1' | '16:9'
export type GridFitMode = 'cover' | 'contain'
export type BackdropStyle = 'aurora' | 'mica' | 'pastel' | 'solid'
export type AspectFilter = 'all' | 'landscape' | 'portrait' | 'square'
export type FileSizeFilter = 'all' | 'small' | 'medium' | 'large'

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
  // 3D model metadata
  vertexCount?: number
  triangleCount?: number
  meshCount?: number
  materialCount?: number
  animationCount?: number
  animationNames?: string[]
  boundsX?: number
  boundsY?: number
  boundsZ?: number
  // CAD (DWG / DXF) metadata
  cadVersion?: string
  cadEntityCount?: number
  cadLayerCount?: number
  cadBlockCount?: number
  cadLayers?: string[]
  cadHasEmbeddedPreview?: boolean
}

export interface CadLayerInfo {
  name: string
  color: string
  entityCount: number
  visible: boolean
}

export interface CadBatch {
  layerIndex: number
  /** '#rrggbb' or 'default' for theme-adaptive ACI 7 / foreground color */
  color: string
  /** Flat [x1, y1, x2, y2, ...] line segments relative to scene origin */
  segments: Float32Array
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface CadTextItem {
  layerIndex: number
  color: string
  x: number
  y: number
  height: number
  rotation: number
  text: string
}

export interface CadPreviewData {
  ok: boolean
  format: 'dwg' | 'dxf'
  version?: string
  layers: CadLayerInfo[]
  batches: CadBatch[]
  texts: CadTextItem[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null
  entityCount: number
  segmentCount: number
  blockCount: number
  unknownEntityCount?: number
  spaceUsed?: 'model' | 'paper'
  parseMs?: number
  embeddedPreviewDataUrl: string | null
  error?: string
}

export interface MissingModelThumbItem {
  id: number
  filePath: string
  fileName: string
  ext: string
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

export interface ConvertSourceToGroupsResult {
  ok: boolean
  rootGroupId: number
  rootGroupName: string
  createdGroups: number
  reusedGroups: number
  assignedAssets: number
  error?: string
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
  isFavorite: boolean
  dominantColors: string[]
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
  extensions?: string[]
  aspectFilter?: AspectFilter
  sizeFilter?: FileSizeFilter
  hasNoteOnly?: boolean
  colorHex?: string | null
  limit?: number
  offset?: number
}

export interface AssetQueryResult {
  items: Asset[]
  total: number
  hasMore: boolean
}

export interface LibraryStats {
  totalActive: number
  favoriteCount: number
  ungroupedCount: number
  recentCount: number
  missingCount: number
  hiddenCount: number
  maskedOtherCount: number
  byType: Record<MediaType, number>
  byRoot: Record<number, number>
  extensions: Array<{ ext: string; count: number }>
  extensionsByType: Record<MediaType, Array<{ ext: string; count: number }>>
}

export interface DuplicateGroup {
  fingerprint: string
  fileSize: number
  count: number
  items: Asset[]
}

export interface ThumbProgress {
  running: boolean
  completed: number
  total: number
  pending: number
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
  backdropStyle: BackdropStyle
  backdropMotion: boolean
  fontFamily: string
  fontSize: number
  viewMode: ViewMode
  gridAspectRatio: GridAspectRatio
  gridFitMode: GridFitMode
  cardSize: number
  ffmpegPath: string
  thumbCacheDir: string
  clipboardDir: string
  clipboardMaxFiles: number
  clipboardMaxSizeMB: number
  previewWheelMode: 'zoom' | 'navigate'
  includeOtherFiles: boolean
  autoScanOnStartup: boolean
  closeToTray: boolean
  autoLaunch: boolean
  videoHoverPreview: boolean
  quickSearchEnabled: boolean
  quickSearchShortcut: string
  autoCheckUpdates: boolean
  updateMirrorUrl: string
  deleteThumbsOnRemoveSource: boolean
  lastSeenVersion: string
}

export type AppInstallType = 'installer' | 'portable' | 'dev'

export interface AppInfo {
  version: string
  installType: AppInstallType
  isPackaged: boolean
  platform: string
  arch: string
  micaSupported: boolean
  repoUrl: string
  releasesUrl: string
}

export interface UpdateAssetInfo {
  name: string
  size: number
  downloadUrl: string
  kind: 'installer' | 'portable'
  sha256?: string
}

export interface UpdateReleaseInfo {
  version: string
  tagName: string
  name: string
  notes: string
  publishedAt: string | null
  htmlUrl: string
  installerAsset: UpdateAssetInfo | null
  portableAsset: UpdateAssetInfo | null
  recommendedAsset: UpdateAssetInfo | null
  mirrors?: string[]
  checkSource?: string
}

export interface UpdateDownloadProgress {
  fileName: string
  filePath: string
  kind: 'installer' | 'portable'
  transferredBytes: number
  totalBytes: number
  percent: number
  bytesPerSecond: number
  routeLabel?: string
  verifiedSha256?: boolean
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  installType: AppInstallType
  release: UpdateReleaseInfo | null
  download: UpdateDownloadProgress | null
  error: string | null
  checkedAt: number | null
  silent: boolean
}

export interface UpdateInstallResult {
  ok: boolean
  action: 'launched-installer' | 'revealed-portable' | 'error'
  filePath?: string
  error?: string
}

export type ConflictResolution = 'replace' | 'skip' | 'keep_both'

export interface ImportConflictItem {
  incomingPath: string
  fileName: string
  incomingSize: number
  incomingModifiedAt: number
  incomingWidth?: number | null
  incomingHeight?: number | null
  incomingMediaType: MediaType
  incomingExt: string
  incomingThumbDataUrl?: string | null
  incomingTextSnippet?: string | null
  existingAsset: Asset
}

export interface ClipboardInspectResult {
  hasContent: boolean
  kind: 'files' | 'image' | 'empty'
  fileCount: number
  totalBytes: number
  filePaths?: string[]
  conflicts: ImportConflictItem[]
  reason?: string
}

export interface ClipboardImportResult {
  ok: boolean
  assets: Asset[]
  importedCount: number
  replacedCount: number
  skippedCount: number
  reason?: string
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
    remove: (id: number) => Promise<{ removedThumbs: number }>
    update: (id: number, patch: { alias?: string; watchEnabled?: boolean; ignorePatterns?: string[] }) => Promise<SourceRoot>
    scan: (id?: number) => Promise<void>
    convertToGroups: (id: number) => Promise<ConvertSourceToGroupsResult>
  }
  assets: {
    query: (filter: AssetQueryFilter) => Promise<AssetQueryResult>
    getStats: () => Promise<LibraryStats>
    getById: (id: number) => Promise<Asset | null>
    updateNote: (id: number, note: string) => Promise<void>
    batchAppendNote: (ids: number[], text: string) => Promise<void>
    setStatus: (ids: number[], status: AssetStatus) => Promise<void>
    setFavorite: (ids: number[], isFavorite: boolean) => Promise<void>
    moveToTrash: (ids: number[]) => Promise<{ trashed: number; failed: string[] }>
    readTextContent: (id: number) => Promise<TextContentResult>
    removeMissing: (ids?: number[]) => Promise<number>
    findDuplicates: () => Promise<DuplicateGroup[]>
    mergeDuplicates: (
      keepId: number,
      removeIds: number[],
      moveToTrash: boolean
    ) => Promise<{ removed: number; failed: string[] }>
    backfillColors: () => Promise<number>
    parseCad: (id: number) => Promise<CadPreviewData>
    saveRenderedThumb: (
      id: number,
      pngDataUrl: string,
      extraMetaPatch?: Partial<AssetExtraMeta>
    ) => Promise<string | null>
    getMissingModelThumbs: () => Promise<MissingModelThumbItem[]>
  }
  groups: {
    listTree: () => Promise<GroupNode[]>
    create: (data: { name: string; parentId?: number | null; color?: string }) => Promise<GroupFlat>
    update: (id: number, patch: { name?: string; parentId?: number | null; color?: string; sortOrder?: number }) => Promise<GroupFlat>
    reorder: (id: number, targetParentId: number | null, orderedSiblingIds: number[]) => Promise<void>
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
    copyFilesToClipboard: (filePaths: string[], mode?: 'file' | 'image') => Promise<{ ok: boolean; error?: string }>
    startDragOut: (filePaths: string[], thumbPath?: string | null) => void
    checkFfmpeg: () => Promise<FfmpegStatus>
    getPathForFile: (file: File) => string
    getAppInfo: () => Promise<AppInfo>
  }
  quickSearch: {
    hide: () => Promise<void>
    openAssetInMain: (assetId: number) => Promise<void>
  }
  updater: {
    getState: () => Promise<UpdateState>
    check: (opts?: { silent?: boolean }) => Promise<UpdateState>
    download: (kind?: 'installer' | 'portable') => Promise<UpdateState>
    cancelDownload: () => Promise<UpdateState>
    install: () => Promise<UpdateInstallResult>
    openReleasesPage: () => Promise<void>
  }
  clipboard: {
    inspect: () => Promise<ClipboardInspectResult>
    inspectPaths: (paths: string[]) => Promise<ClipboardInspectResult>
    commitImport: (opts: {
      targetGroupId?: number | null
      filePaths?: string[]
      resolutions?: Record<string, ConflictResolution>
    }) => Promise<ClipboardImportResult>
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
    onThumbReady: (
      cb: (payload: {
        assetId: number
        thumbPath: string
        width?: number | null
        height?: number | null
        dominantColors?: string[]
      }) => void
    ) => () => void
    onThumbProgress: (cb: (progress: ThumbProgress) => void) => () => void
    onAssetsChanged: (cb: () => void) => () => void
    onEagleProgress: (cb: (progress: EagleMigrationProgress) => void) => () => void
    onUpdateState: (cb: (state: UpdateState) => void) => () => void
    onFocusAsset: (cb: (assetId: number) => void) => () => void
  }
}
