import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ClipboardPaste,
  Database,
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Github,
  HardDrive,
  Heart,
  Info,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Scale,
  Sun,
  Trash2,
  Type,
  User,
  Wrench,
  X,
  XCircle
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { FONT_PRESETS, FONT_SIZE_PRESETS } from '../utils/fonts'
import { formatDateTime, formatFileSize } from '@shared/mediaTypes'
import { AppLogo } from './AppLogo'
import type {
  CacheStats,
  ClipboardStats,
  EagleInspectResult,
  EagleMigrationProgress,
  FfmpegStatus,
  GridAspectRatio,
  GridFitMode
} from '@shared/types'

const OPEN_SOURCE_DEPS = [
  { name: 'Electron', desc: '跨平台桌面应用内核', license: 'MIT', url: 'https://www.electronjs.org' },
  { name: 'React', desc: '声明式用户界面框架', license: 'MIT', url: 'https://react.dev' },
  { name: 'Tailwind CSS', desc: '现代化原子样式引擎', license: 'MIT', url: 'https://tailwindcss.com' },
  { name: 'Lucide Icons', desc: '简洁一致的开源图标集', license: 'ISC', url: 'https://lucide.dev' },
  { name: 'sharp', desc: '高性能图像处理与缩略图引擎', license: 'Apache-2.0', url: 'https://sharp.pixelplumbing.com' },
  { name: 'ag-psd', desc: 'Photoshop PSD/PSB 图层与图像解析', license: 'MIT', url: 'https://github.com/Agamnentzar/ag-psd' },
  { name: 'music-metadata', desc: '音频流元数据与封面提取', license: 'MIT', url: 'https://github.com/Borewit/music-metadata' },
  { name: 'chokidar', desc: '轻量级跨平台目录文件监听', license: 'MIT', url: 'https://github.com/paulmillr/chokidar' },
  { name: 'react-markdown', desc: 'Markdown 渲染与 GFM 支持', license: 'MIT', url: 'https://github.com/remarkjs/react-markdown' },
  { name: 'FFmpeg', desc: '视频抽帧与媒体流元信息解析', license: 'LGPL / GPL', url: 'https://ffmpeg.org' }
]

export const SettingsModal: React.FC = () => {
  const {
    settingsOpen,
    settingsInitialTab,
    closeSettings,
    settings,
    updateSettings,
    sources,
    refreshAll,
    showToast,
    confirm
  } = useLibraryStore()

  const [tab, setTab] = useState<'sources' | 'media' | 'appearance' | 'about'>('sources')
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [clipboardStats, setClipboardStats] = useState<ClipboardStats | null>(null)
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null)
  const [editingIgnoreId, setEditingIgnoreId] = useState<number | null>(null)
  const [ignoreDraft, setIgnoreDraft] = useState('')
  const [customFontDraft, setCustomFontDraft] = useState('')
  const [movingCache, setMovingCache] = useState(false)
  const [movingClipboard, setMovingClipboard] = useState(false)

  // Eagle migration wizard modal state
  const [eagleWizard, setEagleWizard] = useState<{
    inspect: EagleInspectResult
    targetDir: string
    deleteOriginals: boolean
  } | null>(null)
  const [eagleProgress, setEagleProgress] = useState<EagleMigrationProgress | null>(null)

  useEffect(() => {
    const unsub = window.api.events.onEagleProgress((p) => {
      setEagleProgress(p)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (settingsOpen) {
      setTab(settingsInitialTab)
      const isPreset = FONT_PRESETS.some((p) => p.id === settings.fontFamily)
      setCustomFontDraft(isPreset ? '' : settings.fontFamily)
      loadSystemStats()
    }
  }, [settingsOpen, settingsInitialTab])

  const loadSystemStats = async () => {
    const [cs, cbStats, ff] = await Promise.all([
      window.api.settings.getCacheStats(),
      window.api.clipboard.getStats(),
      window.api.system.checkFfmpeg()
    ])
    setCacheStats(cs)
    setClipboardStats(cbStats)
    setFfmpegStatus(ff)
  }

  const handleStartEagleWizard = async () => {
    const inspect = await window.api.eagle.pickLibrary()
    if (!inspect) return
    if (!inspect.valid) {
      showToast(inspect.error || '请选择有效的 Eagle 资源库目录（*.library）', 'error')
      return
    }
    const targetDir = await window.api.eagle.pickTargetDir()
    if (!targetDir) return
    if (targetDir.toLowerCase() === inspect.libraryPath.toLowerCase()) {
      showToast('迁移目标目录不能与原 Eagle 库目录相同，请选择新的存放目录', 'error')
      return
    }
    setEagleWizard({
      inspect,
      targetDir,
      deleteOriginals: false
    })
  }

  const handleRunEagleMigration = async () => {
    if (!eagleWizard) return
    setEagleProgress({
      running: true,
      total: eagleWizard.inspect.itemCount,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0
    })
    try {
      const result = await window.api.eagle.migrate({
        eagleDir: eagleWizard.inspect.libraryPath,
        targetDir: eagleWizard.targetDir,
        deleteOriginals: eagleWizard.deleteOriginals
      })
      setEagleWizard(null)
      setEagleProgress(null)
      await loadSystemStats()
      await refreshAll()
      const delMsg = result.deletedOriginals > 0 ? `，已移至回收站 ${result.deletedOriginals} 项原文件` : ''
      showToast(
        `Eagle 迁移完成：导入 ${result.imported} 项，重建 ${result.groupsCreated} 个分组${delMsg}`,
        'success'
      )
    } catch (err) {
      setEagleProgress(null)
      showToast(`Eagle 迁移失败：${String(err)}`, 'error')
    }
  }

  if (!settingsOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      onClick={closeSettings}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl h-[620px] max-h-[88vh] rounded-xl border shadow-2xl flex overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)'
        }}
      >
        {/* Left Settings Nav */}
        <div
          className="w-48 shrink-0 border-r p-3 flex flex-col gap-1"
          style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="px-3 py-2 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            系统设置
          </div>
          {[
            { id: 'sources' as const, label: '索引目录源', icon: HardDrive },
            { id: 'media' as const, label: '媒体与缓存', icon: Database },
            { id: 'appearance' as const, label: '外观与字体', icon: Palette },
            { id: 'about' as const, label: '关于 PrismVault', icon: Info }
          ].map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className="relative h-10 px-3 rounded-md flex items-center gap-2.5 text-sm font-medium cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                style={{
                  backgroundColor: active ? 'var(--bg-active)' : undefined,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
                }}
              >
                {active && (
                  <span
                    className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
                <Icon className="w-4 h-4" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>

        {/* Right Settings Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div
            className="h-14 px-5 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {tab === 'sources' && '索引目录源管理（跨盘符零复制）'}
              {tab === 'media' && '媒体解析引擎与缓存维护'}
              {tab === 'appearance' && '外观主题、字体字号与高 DPI 适配'}
              {tab === 'about' && '关于 PrismVault · 棱镜匣'}
            </h3>
            <button
              type="button"
              onClick={closeSettings}
              className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* ==================== TAB 1: Sources ==================== */}
            {tab === 'sources' && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    挂载任意盘符下的目录，PrismVault 只会读取并建立索引，绝不会复制或改动你的原文件。
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleStartEagleWizard}
                      className="h-9 px-3 rounded-md border text-xs font-medium flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-primary)'
                      }}
                      title="从 Eagle 资源库 (*.library) 无损迁移原始素材与多级文件夹结构"
                    >
                      <FolderInput className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                      <span>从 Eagle 迁移文件</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const added = await window.api.sources.pickAndAdd()
                        if (added) {
                          showToast(`已挂载「${added.alias}」`, 'success')
                          await refreshAll()
                        }
                      }}
                      className="h-9 px-3.5 rounded-md text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-solid)' }}
                    >
                      <FolderPlus className="w-4 h-4" />
                      <span>添加目录</span>
                    </button>
                  </div>
                </div>

                {sources.length === 0 ? (
                  <div
                    className="rounded-lg border border-dashed p-8 text-center text-sm"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                  >
                    尚未挂载任何索引目录，点击右上角「添加目录」开始。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sources.map((src) => (
                      <div
                        key={src.id}
                        className="rounded-lg border p-4 space-y-3"
                        style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                              {src.alias}
                            </div>
                            <div className="text-xs font-mono break-all mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {src.path}
                            </div>
                            <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                              已索引 {src.assetCount} 项 · 上次同步：{formatDateTime(src.lastScannedAt)}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                window.api.sources.scan(src.id)
                                showToast(`正在扫描「${src.alias}」...`)
                              }}
                              className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              扫描
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `移除索引目录「${src.alias}」`,
                                  message: `确定从 PrismVault 中移除索引源「${src.alias}」吗？`,
                                  detail: '仅移除库内的索引记录以及该目录下文件的备注与分组关联，绝不会删除硬盘上的任何原始文件。',
                                  confirmText: '确认移除',
                                  variant: 'danger'
                                })
                                if (!ok) return
                                await window.api.sources.remove(src.id)
                                showToast(`已移除索引目录「${src.alias}」`)
                                await refreshAll()
                              }}
                              className="h-8 w-8 rounded-md border flex items-center justify-center hover:bg-red-500/15 cursor-pointer"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--danger)' }}
                              title="移除索引源（不删原文件）"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div
                          className="pt-2.5 border-t flex items-center justify-between gap-3 text-xs"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={src.watchEnabled}
                              onChange={async (e) => {
                                await window.api.sources.update(src.id, { watchEnabled: e.target.checked })
                                showToast(e.target.checked ? '已开启实时文件监听' : '已关闭实时文件监听')
                                await refreshAll()
                              }}
                              className="accent-[var(--accent-solid)] w-4 h-4 cursor-pointer"
                            />
                            <span>实时监听此目录变更</span>
                          </label>

                          <button
                            type="button"
                            onClick={() => {
                              if (editingIgnoreId === src.id) {
                                setEditingIgnoreId(null)
                              } else {
                                setEditingIgnoreId(src.id)
                                setIgnoreDraft(src.ignorePatterns.join(', '))
                              }
                            }}
                            className="text-xs hover:underline cursor-pointer"
                            style={{ color: 'var(--accent)' }}
                          >
                            {editingIgnoreId === src.id ? '取消编辑' : '配置忽略规则'}
                          </button>
                        </div>

                        {editingIgnoreId === src.id && (
                          <div className="space-y-2 pt-1">
                            <input
                              type="text"
                              value={ignoreDraft}
                              onChange={(e) => setIgnoreDraft(e.target.value)}
                              placeholder="用英文逗号分隔，如 node_modules, .git, *.tmp"
                              className="w-full h-9 px-3 rounded-md border text-xs font-mono outline-none focus:border-[var(--accent)]"
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                borderColor: 'var(--border-subtle)',
                                color: 'var(--text-primary)'
                              }}
                            />
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={async () => {
                                  const list = ignoreDraft
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean)
                                  await window.api.sources.update(src.id, { ignorePatterns: list })
                                  setEditingIgnoreId(null)
                                  showToast('已更新忽略规则', 'success')
                                  await refreshAll()
                                }}
                                className="h-8 px-3.5 rounded-md text-xs text-white cursor-pointer"
                                style={{ backgroundColor: 'var(--accent-solid)' }}
                              >
                                保存规则
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                    <div>
                      <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        纳管“其他”未知扩展名文件
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        开启后，除图片/视频/音频/文本之外的其他类型文件也会被收入库中（重新扫描生效）
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.includeOtherFiles}
                      onChange={(e) => updateSettings({ includeOtherFiles: e.target.checked })}
                      className="accent-[var(--accent-solid)] w-4 h-4 cursor-pointer shrink-0"
                    />
                  </label>

                  <label
                    className="flex items-center justify-between gap-3 text-sm cursor-pointer pt-3 border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div>
                      <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        启动应用时自动增量同步
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        每次打开应用自动核对已挂载目录的新增/变更/离线文件
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoScanOnStartup}
                      onChange={(e) => updateSettings({ autoScanOnStartup: e.target.checked })}
                      className="accent-[var(--accent-solid)] w-4 h-4 cursor-pointer shrink-0"
                    />
                  </label>
                </div>
              </>
            )}

            {/* ==================== TAB 2: Media & Cache ==================== */}
            {tab === 'media' && (
              <>
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Wrench className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                      <span>FFmpeg 视频缩略图与流解析引擎</span>
                    </div>
                    {ffmpegStatus?.available ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        已就绪
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                        <XCircle className="w-4 h-4" />
                        未检测到
                      </span>
                    )}
                  </div>

                  <div className="text-xs font-mono break-all" style={{ color: 'var(--text-muted)' }}>
                    当前路径：{ffmpegStatus?.ffmpegPath || '未自动探测到（视频仍可播放，但无法生成预览帧）'}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const picked = await window.api.settings.pickFfmpegPath()
                        if (picked) {
                          await updateSettings({ ffmpegPath: picked })
                          await loadSystemStats()
                          showToast('已更新 FFmpeg 路径', 'success')
                        }
                      }}
                      className="h-8 px-3 rounded-md border text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                    >
                      手动指定 ffmpeg.exe
                    </button>
                    {settings.ffmpegPath && (
                      <button
                        type="button"
                        onClick={async () => {
                          await updateSettings({ ffmpegPath: '' })
                          await loadSystemStats()
                        }}
                        className="h-8 px-3 rounded-md text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        恢复自动探测
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">缩略图缓存目录与索引数据库</div>
                    {settings.thumbCacheDir && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                      >
                        已自定义路径
                      </span>
                    )}
                  </div>

                  {cacheStats && (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>已生成缩略图</span>
                        <span className="font-mono">
                          {cacheStats.thumbCount} 张 ({formatFileSize(cacheStats.thumbBytes)})
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>SQLite 数据库体积</span>
                        <span className="font-mono">{formatFileSize(cacheStats.dbBytes)}</span>
                      </div>
                      <div className="pt-1 space-y-1">
                        <div style={{ color: 'var(--text-secondary)' }}>当前缩略图缓存路径：</div>
                        <div
                          className="p-2 rounded-md border font-mono break-all select-text"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        >
                          {cacheStats.cacheDir}
                        </div>
                      </div>
                      <div className="text-xs font-mono break-all pt-0.5" style={{ color: 'var(--text-muted)' }}>
                        索引数据库位置：{cacheStats.dbPath}
                      </div>
                    </div>
                  )}

                  {/* Custom Thumbnail Cache Directory Controls */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={movingCache}
                      onClick={async () => {
                        setMovingCache(true)
                        try {
                          const res = await window.api.settings.pickAndMoveThumbCacheDir()
                          if (res) {
                            const updatedSettings = await window.api.settings.getAll()
                            useLibraryStore.setState({ settings: updatedSettings })
                            await loadSystemStats()
                            await refreshAll()
                            showToast(
                              `已迁移 ${res.movedCount} 张缩略图至新目录${res.failedCount > 0 ? `（${res.failedCount} 张跳过）` : ''}`,
                              'success'
                            )
                          }
                        } finally {
                          setMovingCache(false)
                        }
                      }}
                      className="h-9 px-3.5 rounded-md text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-solid)' }}
                    >
                      <FolderOpen className="w-4 h-4" />
                      <span>{movingCache ? '正在迁移缩略图...' : '更改缓存目录（自动迁移）'}</span>
                    </button>

                    {cacheStats && (
                      <button
                        type="button"
                        onClick={() => window.api.system.openExternal(cacheStats.cacheDir)}
                        className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>打开目录</span>
                      </button>
                    )}

                    {settings.thumbCacheDir && (
                      <button
                        type="button"
                        disabled={movingCache}
                        onClick={async () => {
                          const ok = await confirm({
                            title: '恢复默认缓存目录',
                            message: '确定将缩略图缓存迁移回系统默认目录吗？',
                            detail: '已有缩略图会自动迁移回去，不会丢失。',
                            confirmText: '恢复默认',
                            variant: 'info'
                          })
                          if (!ok) return
                          setMovingCache(true)
                          try {
                            const res = await window.api.settings.resetThumbCacheDir()
                            const updatedSettings = await window.api.settings.getAll()
                            useLibraryStore.setState({ settings: updatedSettings })
                            await loadSystemStats()
                            await refreshAll()
                            if (res) {
                              showToast(`已恢复默认缓存目录并迁移 ${res.movedCount} 张缩略图`, 'success')
                            }
                          } finally {
                            setMovingCache(false)
                          }
                        }}
                        className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>恢复默认</span>
                      </button>
                    )}
                  </div>

                  <div
                    className="flex flex-wrap items-center gap-2 pt-3 border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={async () => {
                        const count = await window.api.settings.rebuildMissingThumbs()
                        showToast(`已将 ${count} 个缺失缩略图的素材加入后台生成队列`, 'success')
                      }}
                      className="h-9 px-3.5 rounded-md border text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                    >
                      补全缺失缩略图
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirm({
                          title: '清空缩略图缓存',
                          message: '确定要清空当前缓存目录中的所有缩略图吗？',
                          detail: '仅清理本应用生成的 WebP 缩略图，不影响原文件。之后可随时点击「补全缺失缩略图」重新生成。',
                          confirmText: '确认清空',
                          variant: 'warning'
                        })
                        if (!ok) return
                        await window.api.settings.clearThumbCache()
                        await loadSystemStats()
                        await refreshAll()
                        showToast('已清空缩略图缓存')
                      }}
                      className="h-9 px-3.5 rounded-md border text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >
                      清空缩略图缓存
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const saved = await window.api.settings.exportDbBackup()
                        if (saved) showToast(`已导出数据库备份至 ${saved}`, 'success')
                      }}
                      className="h-9 px-3.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                    >
                      <Download className="w-4 h-4" />
                      导出数据库备份
                    </button>
                  </div>
                </div>

                {/* Clipboard Image Import Storage Directory */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <ClipboardPaste className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                      <span>剪贴板图片导入目录（Ctrl + V）</span>
                    </div>
                    {clipboardStats?.isCustom && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                      >
                        已自定义路径
                      </span>
                    )}
                  </div>

                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    在软件置顶聚焦状态下按 <kbd className="px-1.5 py-0.5 rounded bg-black/20 font-mono">Ctrl + V</kbd> 可自动抓取剪贴板图片并保存到该独立目录；更改路径时会自动迁移全部已有文件并保持备注与分组无损。
                  </p>

                  {clipboardStats && (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>已通过剪贴板导入</span>
                        <span className="font-mono">
                          {clipboardStats.fileCount} 张 ({formatFileSize(clipboardStats.totalBytes)})
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div style={{ color: 'var(--text-secondary)' }}>当前剪贴板存放路径：</div>
                        <div
                          className="p-2 rounded-md border font-mono break-all select-text"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        >
                          {clipboardStats.dir}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={movingClipboard}
                      onClick={async () => {
                        setMovingClipboard(true)
                        try {
                          const res = await window.api.clipboard.pickAndMoveDir()
                          if (res) {
                            const updatedSettings = await window.api.settings.getAll()
                            useLibraryStore.setState({ settings: updatedSettings })
                            await loadSystemStats()
                            await refreshAll()
                            showToast(
                              `已迁移 ${res.movedCount} 个剪贴板文件至新目录${res.failedCount > 0 ? `（${res.failedCount} 个跳过）` : ''}`,
                              'success'
                            )
                          }
                        } finally {
                          setMovingClipboard(false)
                        }
                      }}
                      className="h-9 px-3.5 rounded-md text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-solid)' }}
                    >
                      <FolderOpen className="w-4 h-4" />
                      <span>{movingClipboard ? '正在迁移文件...' : '更改存放目录（自动迁移）'}</span>
                    </button>

                    {clipboardStats && (
                      <button
                        type="button"
                        onClick={() => window.api.system.openExternal(clipboardStats.dir)}
                        className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>打开目录</span>
                      </button>
                    )}

                    {clipboardStats?.isCustom && (
                      <button
                        type="button"
                        disabled={movingClipboard}
                        onClick={async () => {
                          const ok = await confirm({
                            title: '恢复默认剪贴板目录',
                            message: '确定将剪贴板导入目录迁移回系统默认目录吗？',
                            detail: '所有已导入的图片文件会自动迁回并保持分组与备注关联不变。',
                            confirmText: '恢复默认',
                            variant: 'info'
                          })
                          if (!ok) return
                          setMovingClipboard(true)
                          try {
                            const res = await window.api.clipboard.resetDir()
                            const updatedSettings = await window.api.settings.getAll()
                            useLibraryStore.setState({ settings: updatedSettings })
                            await loadSystemStats()
                            await refreshAll()
                            if (res) {
                              showToast(`已恢复默认剪贴板目录并迁移 ${res.movedCount} 个文件`, 'success')
                            }
                          } finally {
                            setMovingClipboard(false)
                          }
                        }}
                        className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>恢复默认</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ==================== TAB 3: Appearance & Typography ==================== */}
            {tab === 'appearance' && (
              <div className="space-y-4">
                {/* Theme */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="text-sm font-semibold">界面主题（WinUI 3 风格）</div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'dark' as const, label: '深色 Fluent 工作台', icon: Moon },
                      { id: 'light' as const, label: '浅色明亮模式', icon: Sun }
                    ].map(({ id, label, icon: Icon }) => {
                      const active = settings.theme === id
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => updateSettings({ theme: id })}
                          className="h-12 px-3.5 rounded-lg border flex items-center gap-2.5 text-sm font-medium cursor-pointer transition-colors"
                          style={{
                            backgroundColor: active ? 'var(--bg-active)' : 'var(--bg-surface)',
                            borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        >
                          <Icon className="w-4 h-4" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
                          <span>{label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Font Size (4K High-DPI Friendly) */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Type className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                      <span>全局字体大小（4K 高分屏适配）</span>
                    </div>
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                    >
                      {settings.fontSize} px
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>13px</span>
                    <input
                      type="range"
                      min={13}
                      max={22}
                      step={1}
                      value={settings.fontSize}
                      onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
                      className="flex-1 accent-[var(--accent-solid)] cursor-pointer"
                    />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>22px</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {FONT_SIZE_PRESETS.map((p) => {
                      const active = settings.fontSize === p.size
                      return (
                        <button
                          key={p.size}
                          type="button"
                          onClick={() => updateSettings({ fontSize: p.size })}
                          className="h-8 px-3 rounded-md border text-xs cursor-pointer transition-colors"
                          style={{
                            backgroundColor: active ? 'var(--accent-solid)' : 'var(--bg-surface)',
                            borderColor: active ? 'var(--accent-solid)' : 'var(--border-subtle)',
                            color: active ? '#fff' : 'var(--text-secondary)'
                          }}
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Font Family */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="text-sm font-semibold">界面字体</div>
                  <div className="space-y-1.5">
                    {FONT_PRESETS.map((preset) => {
                      const active = settings.fontFamily === preset.id
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setCustomFontDraft('')
                            updateSettings({ fontFamily: preset.id })
                          }}
                          className="w-full px-3.5 py-2.5 rounded-lg border text-left flex items-center justify-between gap-2 cursor-pointer transition-colors"
                          style={{
                            backgroundColor: active ? 'var(--bg-active)' : 'var(--bg-surface)',
                            borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                            fontFamily: preset.stack
                          }}
                        >
                          <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                              {preset.label}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {preset.preview}
                            </div>
                          </div>
                          {active && (
                            <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--accent)' }}>
                              使用中
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Custom local font input */}
                  <div className="pt-2 border-t flex items-center gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                    <input
                      type="text"
                      value={customFontDraft}
                      onChange={(e) => setCustomFontDraft(e.target.value)}
                      placeholder="或输入本机已安装的字体名称（如 思源黑体 CN / MiSans）"
                      className="flex-1 h-9 px-3 rounded-md border text-xs outline-none focus:border-[var(--accent)]"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-primary)'
                      }}
                    />
                    <button
                      type="button"
                      disabled={!customFontDraft.trim()}
                      onClick={() => {
                        updateSettings({ fontFamily: customFontDraft.trim() })
                        showToast(`已切换字体为「${customFontDraft.trim()}」`, 'success')
                      }}
                      className="h-9 px-3.5 rounded-md text-xs font-medium text-white disabled:opacity-45 cursor-pointer shrink-0"
                      style={{ backgroundColor: 'var(--accent-solid)' }}
                    >
                      应用自定义字体
                    </button>
                  </div>
                </div>

                {/* Grid Defaults */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="text-sm font-semibold">等比网格默认设置</div>
                  <div className="flex items-center justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>等比卡片画布比例</span>
                    <div className="flex gap-1.5">
                      {(['4:3', '1:1', '16:9'] as GridAspectRatio[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => updateSettings({ gridAspectRatio: r })}
                          className="h-8 px-3 rounded-md border text-xs cursor-pointer"
                          style={{
                            backgroundColor: settings.gridAspectRatio === r ? 'var(--accent-solid)' : 'var(--bg-surface)',
                            borderColor: settings.gridAspectRatio === r ? 'var(--accent-solid)' : 'var(--border-subtle)',
                            color: settings.gridAspectRatio === r ? '#fff' : 'var(--text-secondary)'
                          }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    className="flex items-center justify-between text-xs pt-2.5 border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>图片/视频填充方式</span>
                    <div className="flex gap-1.5">
                      {(
                        [
                          { id: 'cover', label: '铺满裁剪 (Cover)' },
                          { id: 'contain', label: '完整留白 (Contain)' }
                        ] as Array<{ id: GridFitMode; label: string }>
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateSettings({ gridFitMode: opt.id })}
                          className="h-8 px-3 rounded-md border text-xs cursor-pointer"
                          style={{
                            backgroundColor: settings.gridFitMode === opt.id ? 'var(--accent-solid)' : 'var(--bg-surface)',
                            borderColor: settings.gridFitMode === opt.id ? 'var(--accent-solid)' : 'var(--border-subtle)',
                            color: settings.gridFitMode === opt.id ? '#fff' : 'var(--text-secondary)'
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== TAB 4: About ==================== */}
            {tab === 'about' && (
              <div className="space-y-4">
                {/* Brand Hero */}
                <div
                  className="rounded-xl border p-5 flex items-center gap-4"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <AppLogo size={64} className="drop-shadow-md" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                        PrismVault · 棱镜匣
                      </h4>
                      <span
                        className="text-xs font-mono px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                      >
                        v0.1.0
                      </span>
                      <span
                        className="text-xs font-mono px-2 py-0.5 rounded-full border"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        MIT License
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      面向创作者的跨盘符、零复制本地全媒体素材管理工具 —— 统一纳管图片（含 PSD/PSB/TIFF）、视频、音频、文本与文档，提供瀑布流 / 等比双视图、一体化内嵌预览、层级分组与 Markdown 备注。
                    </p>
                  </div>
                </div>

                {/* Author & Repository Info */}
                <div
                  className="rounded-xl border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <User className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span>作者与项目信息</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--text-muted)' }}>开发者 / Author</span>
                      <span className="font-medium select-text" style={{ color: 'var(--text-primary)' }}>
                        熙云 (Xiyun)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--text-muted)' }}>开源协议 / License</span>
                      <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                        MIT License
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--text-muted)' }}>GitHub 项目主页</span>
                      <button
                        type="button"
                        onClick={() => window.api.system.openExternalUrl('https://github.com/xiyunyun/PrismVault')}
                        className="inline-flex items-center gap-1 hover:underline cursor-pointer font-mono"
                        style={{ color: 'var(--accent)' }}
                      >
                        <Github className="w-3.5 h-3.5" />
                        <span>github.com/xiyunyun/PrismVault</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* MIT License Summary */}
                <div
                  className="rounded-xl border p-4 space-y-2.5"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <Scale className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span>开源协议（MIT License）</span>
                  </div>
                  <pre
                    className="p-3 rounded-lg border text-xs font-mono leading-relaxed whitespace-pre-wrap select-text m-0 max-h-40 overflow-y-auto"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-secondary)'
                    }}
                  >{`MIT License

Copyright (c) 2026 Xiyun (熙云)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.`}</pre>
                </div>

                {/* Open Source Acknowledgments */}
                <div
                  className="rounded-xl border p-4 space-y-2.5"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <Heart className="w-4 h-4 text-rose-400" />
                    <span>开源社区致谢</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {OPEN_SOURCE_DEPS.map((dep) => (
                      <button
                        key={dep.name}
                        type="button"
                        onClick={() => window.api.system.openExternalUrl(dep.url)}
                        className="p-2.5 rounded-lg border text-left hover:bg-[var(--bg-hover)] cursor-pointer transition-colors flex items-start justify-between gap-2"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          borderColor: 'var(--border-subtle)'
                        }}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                            <span>{dep.name}</span>
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.2 rounded"
                              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                            >
                              {dep.license}
                            </span>
                          </div>
                          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {dep.desc}
                          </div>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unified WinUI 3 Eagle Migration Confirmation & Progress Dialog */}
      {eagleWizard && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
          onClick={() => {
            if (!eagleProgress?.running) setEagleWizard(null)
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)'
            }}
          >
            <div
              className="px-5 py-4 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2.5">
                <FolderInput className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  从 Eagle 无损迁移素材
                </h3>
              </div>
              {!eagleProgress?.running && (
                <button
                  type="button"
                  onClick={() => setEagleWizard(null)}
                  className="p-1 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-5 space-y-4">
              <div
                className="rounded-lg border p-3.5 space-y-2 text-xs"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex justify-between gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>源 Eagle 库</span>
                  <span className="font-semibold text-right truncate" style={{ color: 'var(--text-primary)' }}>
                    {eagleWizard.inspect.libraryName}
                  </span>
                </div>
                <div className="font-mono break-all" style={{ color: 'var(--text-muted)' }}>
                  {eagleWizard.inspect.libraryPath}
                </div>
                <div className="flex justify-between gap-2 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>探测到结构</span>
                  <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                    {eagleWizard.inspect.folderCount} 个多级分组 · {eagleWizard.inspect.itemCount} 个素材项目
                  </span>
                </div>
              </div>

              <div
                className="rounded-lg border p-3.5 space-y-1 text-xs"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div style={{ color: 'var(--text-muted)' }}>迁移目标存放目录（将按分组结构整理源文件）</div>
                <div className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>
                  {eagleWizard.targetDir}
                </div>
                <div className="pt-1" style={{ color: 'var(--text-muted)' }}>
                  自动过滤 Eagle 的 `_thumbnail` 缩略图与回收站项目，由本软件重新生成缩略图并完整保留多级分组、备注与标签。
                </div>
              </div>

              {/* Keep vs Delete Originals Choice */}
              {!eagleProgress?.running ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    迁移完成后，如何处理原 Eagle 库中的文件？
                  </div>

                  <label
                    className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: !eagleWizard.deleteOriginals ? 'var(--bg-active)' : 'var(--bg-elevated)',
                      borderColor: !eagleWizard.deleteOriginals ? 'var(--accent)' : 'var(--border-subtle)'
                    }}
                  >
                    <input
                      type="radio"
                      name="eagle-delete-mode"
                      checked={!eagleWizard.deleteOriginals}
                      onChange={() => setEagleWizard({ ...eagleWizard, deleteOriginals: false })}
                      className="mt-0.5 accent-[var(--accent-solid)] cursor-pointer"
                    />
                    <div className="text-xs space-y-0.5">
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        保留原 Eagle 文件夹内容（推荐，仅复制源文件到新目录）
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        安全无风险，原 Eagle 库保持原样不变。
                      </div>
                    </div>
                  </label>

                  <label
                    className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: eagleWizard.deleteOriginals ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-elevated)',
                      borderColor: eagleWizard.deleteOriginals ? 'var(--danger)' : 'var(--border-subtle)'
                    }}
                  >
                    <input
                      type="radio"
                      name="eagle-delete-mode"
                      checked={eagleWizard.deleteOriginals}
                      onChange={() => setEagleWizard({ ...eagleWizard, deleteOriginals: true })}
                      className="mt-0.5 accent-[var(--danger)] cursor-pointer"
                    />
                    <div className="text-xs space-y-0.5">
                      <div className="font-semibold" style={{ color: 'var(--danger)' }}>
                        校验复制成功后，删除原 Eagle 对应素材目录（移至回收站）
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        仅在目标文件字节数校验完全一致后，才将对应原项目移入 Windows 回收站，避免重复占用磁盘空间。
                      </div>
                    </div>
                  </label>
                </div>
              ) : (
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      正在无损迁移...
                    </span>
                    <span className="font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {eagleProgress.processed} / {eagleProgress.total}
                    </span>
                  </div>
                  <div
                    className="w-full h-2.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    <div
                      className="h-full transition-all duration-150 rounded-full"
                      style={{
                        width: `${eagleProgress.total > 0 ? Math.min(100, Math.round((eagleProgress.processed / eagleProgress.total) * 100)) : 0}%`,
                        backgroundColor: 'var(--accent-solid)'
                      }}
                    />
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    已导入 {eagleProgress.imported} · 跳过 {eagleProgress.skipped}
                    {eagleProgress.failed > 0 ? ` · 失败 ${eagleProgress.failed}` : ''}
                    {eagleProgress.currentFile ? ` · 当前：${eagleProgress.currentFile}` : ''}
                  </div>
                </div>
              )}
            </div>

            <div
              className="px-5 py-3.5 border-t flex items-center justify-end gap-2.5"
              style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-subtle)' }}
            >
              <button
                type="button"
                disabled={Boolean(eagleProgress?.running)}
                onClick={() => setEagleWizard(null)}
                className="h-9 px-4 rounded-md border text-sm font-medium hover:bg-[var(--bg-hover)] disabled:opacity-45 cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={Boolean(eagleProgress?.running)}
                onClick={handleRunEagleMigration}
                className="h-9 px-4 rounded-md text-sm font-medium text-white disabled:opacity-50 cursor-pointer"
                style={{
                  backgroundColor: eagleWizard.deleteOriginals ? '#d13438' : 'var(--accent-solid)'
                }}
              >
                {eagleProgress?.running ? '迁移中...' : '开始无损迁移'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
