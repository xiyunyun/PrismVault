import React, { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  ClipboardPaste,
  CloudDownload,
  Database,
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Github,
  Globe,
  HardDrive,
  Heart,
  Info,
  Moon,
  Mouse,
  PackageCheck,
  Palette,
  Power,
  RefreshCw,
  RotateCcw,
  Scale,
  Sparkles,
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
  BackdropStyle,
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
  { name: 'Three.js', desc: 'WebGL 3D 模型内嵌渲染与离屏缩略图引擎', license: 'MIT', url: 'https://threejs.org' },
  { name: '@mlightcad/libredwg-web', desc: '基于 GNU LibreDWG 的离线 WASM DWG/DXF 解析引擎', license: 'GPL-3.0', url: 'https://github.com/mlightcad/libredwg-web' },
  { name: 'dxf-parser', desc: '轻量级纯 JS DXF 图纸解析器', license: 'MIT', url: 'https://github.com/gdsestimating/dxf-parser' },
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
    appInfo,
    updateState,
    setUpdateState,
    refreshAll,
    showToast,
    confirm
  } = useLibraryStore(
    useShallow((s) => ({
      settingsOpen: s.settingsOpen,
      settingsInitialTab: s.settingsInitialTab,
      closeSettings: s.closeSettings,
      settings: s.settings,
      updateSettings: s.updateSettings,
      sources: s.sources,
      appInfo: s.appInfo,
      updateState: s.updateState,
      setUpdateState: s.setUpdateState,
      refreshAll: s.refreshAll,
      showToast: s.showToast,
      confirm: s.confirm
    }))
  )

  const [tab, setTab] = useState<'sources' | 'media' | 'controls' | 'appearance' | 'about'>('sources')
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [clipboardStats, setClipboardStats] = useState<ClipboardStats | null>(null)
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null)
  const [editingIgnoreId, setEditingIgnoreId] = useState<number | null>(null)
  const [ignoreDraft, setIgnoreDraft] = useState('')
  const [customFontDraft, setCustomFontDraft] = useState('')
  const [mirrorDraft, setMirrorDraft] = useState('')
  const [movingCache, setMovingCache] = useState(false)
  const [movingClipboard, setMovingClipboard] = useState(false)

  const displayVersion = appInfo?.version || updateState?.currentVersion || '0.2.0'
  const installTypeLabel =
    (appInfo?.installType || updateState?.installType) === 'installer'
      ? '安装版'
      : (appInfo?.installType || updateState?.installType) === 'portable'
        ? '绿色便携版'
        : '开发模式'
  const hasPendingUpdate = Boolean(
    updateState &&
      updateState.release &&
      (updateState.status === 'available' ||
        updateState.status === 'downloading' ||
        updateState.status === 'downloaded')
  )

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
      setMirrorDraft(settings.updateMirrorUrl || '')
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

    const handleCheckUpdates = async () => {
    const next = await window.api.updater.check({ silent: false })
    setUpdateState(next)
    if (next.status === 'up-to-date') {
      showToast(`当前已是最新版本 v${next.currentVersion}`, 'success')
    } else if (next.status === 'available' && next.release) {
      showToast(`发现新版本 v${next.release.version}`, 'info')
    } else if (next.status === 'downloaded' && next.release) {
      showToast(`新版本 v${next.release.version} 已下载就绪`, 'success')
    } else if (next.status === 'error' && next.error) {
      showToast(next.error, 'error')
    }
  }

  const handleDownloadUpdate = async (kind?: 'installer' | 'portable') => {
    const next = await window.api.updater.download(kind)
    setUpdateState(next)
    if (next.status === 'downloaded' && next.download) {
      showToast(`更新包 ${next.download.fileName} 下载完成`, 'success')
    } else if (next.status === 'error' && next.error) {
      showToast(next.error, 'error')
    }
  }

  const handleInstallUpdate = async () => {
    if (!updateState?.download) return
    const isInstaller = updateState.download.kind === 'installer'
    if (isInstaller) {
      const ok = await confirm({
        title: `安装 PrismVault v${updateState.release?.version || ''}`,
        message: '将关闭当前 PrismVault 并启动新版安装向导，是否立即继续？',
        detail: '你的所有索引源配置、自定义分组、Markdown 备注与原始素材文件均保存在独立位置，覆盖安装不会丢失任何数据。',
        confirmText: '立即退出并安装',
        variant: 'info'
      })
      if (!ok) return
    }

    const res = await window.api.updater.install()
    if (!res.ok) {
      showToast(res.error || '启动更新失败', 'error')
    } else if (res.action === 'revealed-portable') {
      showToast('已在资源管理器中定位便携版更新包，解压替换目录即可完成升级', 'success')
    }
  }

  const handleSaveMirror = async () => {
    const trimmed = mirrorDraft.trim()
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      showToast('加速镜像前缀必须以 https:// 或 http:// 开头', 'error')
      return
    }
    await updateSettings({ updateMirrorUrl: trimmed })
    showToast(trimmed ? '已保存下载加速镜像前缀' : '已切换为直连 GitHub 下载', 'success')
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
            { id: 'controls' as const, label: '操作与交互', icon: Mouse },
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
                <Icon className="w-4 h-4 shrink-0" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {item.id === 'about' && hasPendingUpdate && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: updateState?.status === 'downloaded' ? 'var(--success)' : 'var(--accent)'
                    }}
                  />
                )}
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
              {tab === 'media' && '媒体解析引擎与存储路径'}
              {tab === 'controls' && '鼠标交互、导入提醒阈值与操作习惯'}
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
                              onClick={async () => {
                                const ok = await confirm({
                                  title: '转换为自定义分组结构',
                                  message: `确定将「${src.alias}」的文件夹层级转换为自定义分组结构吗？`,
                                  detail:
                                    '将以该目录作为一级主分组，所有子文件夹按原层级自动生成多级子分组并自动归类素材（不改动硬盘原文件，同名分组自动复用）。',
                                  confirmText: '立即转换',
                                  variant: 'info'
                                })
                                if (!ok) return
                                const res = await window.api.sources.convertToGroups(src.id)
                                if (res.ok) {
                                  await refreshAll()
                                  showToast(
                                    res.createdGroups === 0 && res.assignedAssets === 0
                                      ? `「${res.rootGroupName}」的分组结构已是最新状态`
                                      : `已转换「${res.rootGroupName}」：新建 ${res.createdGroups} 个分组，归类 ${res.assignedAssets} 个素材`,
                                    'success'
                                  )
                                } else {
                                  showToast(res.error || '转换失败', 'error')
                                }
                              }}
                              className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
                              title="按文件夹层级一键生成自定义多级分组"
                            >
                              <FolderTree className="w-3.5 h-3.5" />
                              生成分组
                            </button>
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
                                const willCleanThumbs = settings.deleteThumbsOnRemoveSource
                                const ok = await confirm({
                                  title: `移除索引目录「${src.alias}」`,
                                  message: `确定从 PrismVault 中移除索引源「${src.alias}」吗？`,
                                  detail: willCleanThumbs
                                    ? '将移除该目录的索引记录、备注与分组关联，并同步清理对应缩略图缓存（可在「媒体与缓存」中关闭）；绝不会删除硬盘上的任何原始文件。'
                                    : '仅移除该目录的索引记录、备注与分组关联，保留已生成的缩略图缓存（可在「媒体与缓存」中开启自动清理）；绝不会删除硬盘上的任何原始文件。',
                                  confirmText: '确认移除',
                                  variant: 'danger'
                                })
                                if (!ok) return
                                const res = await window.api.sources.remove(src.id)
                                showToast(
                                  res && res.removedThumbs > 0
                                    ? `已移除索引目录「${src.alias}」，并清理 ${res.removedThumbs} 个缩略图缓存`
                                    : `已移除索引目录「${src.alias}」`
                                )
                                await loadSystemStats()
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
                        <div style={{ color: 'var(--text-secondary)' }}>
                          当前缩略图缓存路径（3D 模型存放在 <code className="font-mono">models/</code>，CAD 图纸存放在{' '}
                          <code className="font-mono">cad/</code>）：
                        </div>
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
                    className="pt-3 border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                      <div>
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          移除索引目录时同步清理对应缩略图缓存
                        </div>
                        <div className="mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                          开启后，删除某个索引源目录会自动清理该目录下素材生成的缩略图与高清预览缓存，避免长期占用磁盘空间；若计划稍后重新挂载同一目录可临时关闭。
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.deleteThumbsOnRemoveSource}
                        onChange={(e) => updateSettings({ deleteThumbsOnRemoveSource: e.target.checked })}
                        className="accent-[var(--accent-solid)] w-4 h-4 cursor-pointer shrink-0"
                      />
                    </label>
                  </div>

                  <div
                    className="flex flex-wrap items-center gap-2 pt-3 border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={async () => {
                        const count = await window.api.settings.rebuildMissingThumbs()
                        window.api.assets
                          .getMissingModelThumbs()
                          .then(async (missingModels) => {
                            if (missingModels.length === 0) return
                            const { modelThumbQueue } = await import('../utils/model3d')
                            modelThumbQueue.resetFailed()
                            modelThumbQueue.enqueueMany(missingModels)
                          })
                          .catch(() => undefined)
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
                      <span>剪贴板与拖放导入存放目录</span>
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
                    通过 <kbd className="px-1.5 py-0.5 rounded bg-black/20 font-mono">Ctrl + V</kbd> 剪贴板粘贴或直接向窗口拖放导入的文件将存放在该独立目录；更改路径时会自动迁移全部已有文件并保持备注与分组无损。
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

            {/* ==================== TAB 3: Controls & Interaction ==================== */}
            {tab === 'controls' && (
              <div className="space-y-4">
                {/* Background Tray Residency & Auto-Launch */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Power className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span>后台驻留与开机自启</span>
                  </div>

                  <label
                    className="flex items-start justify-between gap-3 p-3 rounded-lg border cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                    style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        关闭窗口时隐藏到系统托盘（后台运行）
                      </div>
                      <div className="text-[0.72rem] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        开启后点击右上角关闭按钮将最小化到右下角任务栏托盘继续后台运行，点击托盘图标可瞬间呼出，右键托盘图标可彻底退出；关闭此项则直接退出程序。
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.closeToTray !== false}
                      onChange={async (e) => {
                        await updateSettings({ closeToTray: e.target.checked })
                        showToast(
                          e.target.checked
                            ? '已开启关闭时隐藏至系统托盘（后台运行）'
                            : '已切换为关闭窗口时直接退出软件',
                          'success'
                        )
                      }}
                      className="w-4 h-4 mt-0.5 accent-[var(--accent-solid)] cursor-pointer shrink-0"
                    />
                  </label>

                  <label
                    className="flex items-start justify-between gap-3 p-3 rounded-lg border cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                    style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          开机自动启动
                        </span>
                        {appInfo && !appInfo.isPackaged && (
                          <span
                            className="text-[0.66rem] px-1.5 py-0.2 rounded-full"
                            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                          >
                            打包版生效
                          </span>
                        )}
                      </div>
                      <div className="text-[0.72rem] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        随 Windows 登录自动启动 PrismVault；若同时开启「隐藏到系统托盘」，开机时将静默驻留后台不打扰桌面。
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoLaunch !== false}
                      onChange={async (e) => {
                        await updateSettings({ autoLaunch: e.target.checked })
                        showToast(
                          e.target.checked
                            ? appInfo && !appInfo.isPackaged
                              ? '已保存开启开机自启（正式打包安装后自动生效）'
                              : '已开启开机自动启动'
                            : '已关闭开机自动启动',
                          'success'
                        )
                      }}
                      className="w-4 h-4 mt-0.5 accent-[var(--accent-solid)] cursor-pointer shrink-0"
                    />
                  </label>
                </div>

                {/* Preview Mouse Wheel Interaction Mode */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Mouse className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span>内嵌预览鼠标滚轮功能</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    选择单图/文件内嵌预览时的默认滚轮操作；无论选择哪一种，按住 <kbd className="px-1.5 py-0.5 rounded bg-black/20 font-mono">Ctrl + 滚轮</kbd> 都会自动切换为另一种操作。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(
                      [
                        {
                          id: 'zoom' as const,
                          title: '滚轮缩放画面（默认）',
                          desc: '按住 Ctrl + 滚轮 → 切换上下文件'
                        },
                        {
                          id: 'navigate' as const,
                          title: '滚轮切换上下文件',
                          desc: '按住 Ctrl + 滚轮 → 缩放图片画面'
                        }
                      ] as const
                    ).map((opt) => {
                      const active = settings.previewWheelMode === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateSettings({ previewWheelMode: opt.id })}
                          className="p-3 rounded-lg border text-left cursor-pointer transition-colors space-y-0.5"
                          style={{
                            backgroundColor: active ? 'var(--bg-active)' : 'var(--bg-surface)',
                            borderColor: active ? 'var(--accent)' : 'var(--border-subtle)'
                          }}
                        >
                          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {opt.title}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {opt.desc}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Batch Import Threshold Controls (Clipboard + Drag-and-Drop) */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ClipboardPaste className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span>单次批量导入提醒阈值（剪贴板与拖放通用）</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    当通过 <kbd className="px-1.5 py-0.5 rounded bg-black/20 font-mono">Ctrl + V</kbd> 或拖放导入的文件总数或总大小超过以下阈值时，将弹出确认提醒；设为 <code className="font-mono">0</code> 表示不限制。导入同名文件时会自动弹出缩略图对比确认窗。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label
                      className="space-y-1.5 p-3 rounded-lg border text-xs"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                    >
                      <span className="block font-medium" style={{ color: 'var(--text-primary)' }}>
                        最大单次导入文件数量
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={9999}
                          value={settings.clipboardMaxFiles}
                          onChange={(e) => {
                            const val = Math.max(0, Math.floor(Number(e.target.value) || 0))
                            updateSettings({ clipboardMaxFiles: val })
                          }}
                          className="w-24 h-8 px-2.5 rounded-md border text-xs font-mono outline-none select-text focus:border-[var(--accent)]"
                          style={{
                            backgroundColor: 'var(--bg-elevated)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        />
                        <span style={{ color: 'var(--text-muted)' }}>个文件</span>
                      </div>
                    </label>

                    <label
                      className="space-y-1.5 p-3 rounded-lg border text-xs"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                    >
                      <span className="block font-medium" style={{ color: 'var(--text-primary)' }}>
                        最大单次导入总体积
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={102400}
                          value={settings.clipboardMaxSizeMB}
                          onChange={(e) => {
                            const val = Math.max(0, Math.floor(Number(e.target.value) || 0))
                            updateSettings({ clipboardMaxSizeMB: val })
                          }}
                          className="w-24 h-8 px-2.5 rounded-md border text-xs font-mono outline-none select-text focus:border-[var(--accent)]"
                          style={{
                            backgroundColor: 'var(--bg-elevated)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        />
                        <span style={{ color: 'var(--text-muted)' }}>MB</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Quick Interaction Reference */}
                <div
                  className="rounded-lg border p-4 space-y-2.5"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="text-sm font-semibold">快捷操作一览</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <div className="flex justify-between p-2 rounded bg-[var(--bg-surface)]">
                      <span>外部文件导入</span>
                      <kbd className="font-mono">拖放至窗口 / Ctrl + V</kbd>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-[var(--bg-surface)]">
                      <span>进入 / 退出内嵌预览</span>
                      <kbd className="font-mono">双击 / Space / Esc</kbd>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-[var(--bg-surface)]">
                      <span>预览局部放大 / 还原</span>
                      <kbd className="font-mono">双击图片 / 0</kbd>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-[var(--bg-surface)]">
                      <span>预览切换上下文件</span>
                      <kbd className="font-mono">← / → / 边缘悬浮键</kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== TAB 4: Appearance & Typography ==================== */}
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

                {/* Backdrop Material & Fluid Ambience */}
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                      <span>背景材质与流体氛围</span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      深浅主题均已专属调色
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(
                      [
                        {
                          id: 'aurora' as BackdropStyle,
                          title: '棱镜流光（Prism Aurora）',
                          badge: '默认推荐',
                          desc: '多色光学弥散流光 + 磨砂玻璃层次，契合棱镜匣质感',
                          swatchDark:
                            'radial-gradient(circle at 20% 25%, #38bdf8 0%, transparent 55%), radial-gradient(circle at 82% 25%, #a855f7 0%, transparent 55%), radial-gradient(circle at 60% 88%, #ec4899 0%, transparent 55%), #121520',
                          swatchLight:
                            'radial-gradient(circle at 20% 25%, #7dd3fc 0%, transparent 58%), radial-gradient(circle at 82% 25%, #c4b5fd 0%, transparent 58%), radial-gradient(circle at 60% 88%, #fbcfe8 0%, transparent 58%), #f1f5fc'
                        },
                        {
                          id: 'mica' as BackdropStyle,
                          title: 'Win11 原生云母（Mica）',
                          badge: appInfo?.micaSupported ? '跟随壁纸' : '需 Win11 22H2+',
                          disabled: appInfo ? !appInfo.micaSupported : false,
                          desc: appInfo?.micaSupported
                            ? '调用 Windows 11 系统真云母，柔和透出当前桌面壁纸色彩'
                            : '当前系统不支持原生云母，已自动回退为棱镜流光效果',
                          swatchDark:
                            'linear-gradient(135deg, rgba(96,165,250,0.28) 0%, rgba(45,48,60,0.85) 55%, rgba(167,139,250,0.22) 100%)',
                          swatchLight:
                            'linear-gradient(135deg, rgba(191,219,254,0.8) 0%, rgba(244,246,252,0.92) 55%, rgba(233,213,255,0.75) 100%)'
                        },
                        {
                          id: 'pastel' as BackdropStyle,
                          title: '谷歌柔彩（Google Pastel）',
                          badge: '静态护眼',
                          desc: '低饱和度静态弥散柔彩底，清透轻盈、零动画开销',
                          swatchDark:
                            'linear-gradient(135deg, #161d2f 0%, #1d1a30 50%, #152427 100%)',
                          swatchLight:
                            'linear-gradient(135deg, #e0eeff 0%, #f1eaff 50%, #e1f8f0 100%)'
                        },
                        {
                          id: 'solid' as BackdropStyle,
                          title: '经典纯色（Classic Solid）',
                          badge: '校色友好',
                          desc: '标准中性纯灰界面，适合对画面校色有极致要求的场景',
                          swatchDark: 'linear-gradient(135deg, #202020 0%, #2b2b2b 100%)',
                          swatchLight: 'linear-gradient(135deg, #f3f3f3 0%, #ffffff 100%)'
                        }
                      ] as const
                    ).map((opt) => {
                      const isDisabled = 'disabled' in opt && Boolean(opt.disabled)
                      const active = !isDisabled && (settings.backdropStyle || 'aurora') === opt.id
                      const swatch = settings.theme === 'dark' ? opt.swatchDark : opt.swatchLight
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => {
                            if (!isDisabled) updateSettings({ backdropStyle: opt.id })
                          }}
                          className="p-3 rounded-xl border text-left transition-all flex items-start gap-3 enabled:cursor-pointer enabled:hover:border-[var(--border-strong)] disabled:opacity-55 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: active ? 'var(--bg-active)' : 'var(--bg-surface)',
                            borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                            boxShadow: active ? '0 0 0 1px var(--accent)' : undefined
                          }}
                        >
                          <span
                            className="w-10 h-10 rounded-lg shrink-0 border shadow-inner mt-0.5"
                            style={{
                              background: swatch,
                              borderColor: active ? 'var(--accent)' : 'var(--border-strong)'
                            }}
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {opt.title}
                              </span>
                              <span
                                className="text-[0.66rem] px-1.5 py-0.2 rounded-full"
                                style={{
                                  backgroundColor: active ? 'var(--accent-solid)' : 'var(--bg-elevated)',
                                  color: active ? '#ffffff' : 'var(--text-muted)'
                                }}
                              >
                                {opt.badge}
                              </span>
                            </div>
                            <div className="text-[0.72rem] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                              {opt.desc}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* Motion toggle */}
                  <label
                    className="flex items-center justify-between gap-3 pt-2.5 border-t cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        开启背景流体呼吸动画（仅棱镜流光生效）
                      </div>
                      <div className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>
                        关闭后保持静态极光更省电；进入大图 / 3D / CAD 预览时也会自动暂停动画保障 4K 流畅度
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.backdropMotion !== false}
                      disabled={(settings.backdropStyle || 'aurora') !== 'aurora'}
                      onChange={(e) => updateSettings({ backdropMotion: e.target.checked })}
                      className="w-4 h-4 accent-[var(--accent-solid)] cursor-pointer disabled:opacity-45 shrink-0"
                    />
                  </label>
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

            {/* ==================== TAB 5: About & Cloud Updates ==================== */}
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
                        v{displayVersion}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full border"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        {installTypeLabel}
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

                {/* Cloud Updater (GitHub Releases) */}
                <div
                  className="rounded-xl border p-4 space-y-3.5"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      <CloudDownload className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                      <span>软件云更新（GitHub Releases）</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => window.api.updater.openReleasesPage()}
                        className="h-8 px-2.5 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                        title="在浏览器中打开 GitHub Releases 页面"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Releases 页面</span>
                      </button>
                      <button
                        type="button"
                        disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'}
                        onClick={handleCheckUpdates}
                        className="h-8 px-3.5 rounded-md text-xs font-medium text-white flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        style={{ backgroundColor: 'var(--accent-solid)' }}
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${updateState?.status === 'checking' ? 'animate-spin' : ''}`}
                        />
                        <span>{updateState?.status === 'checking' ? '正在检查...' : '检查更新'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Status Body */}
                  {(!updateState || updateState.status === 'idle') && (
                    <div
                      className="rounded-lg border p-3 text-xs flex items-center justify-between gap-2"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      <span>当前版本 v{displayVersion}（{installTypeLabel}），点击右上角「检查更新」获取最新版本。</span>
                    </div>
                  )}

                  {updateState?.status === 'checking' && (
                    <div
                      className="rounded-lg border p-3.5 text-xs flex items-center gap-2.5"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
                      <span>正在通过多源加速通道检查 PrismVault 最新版本...</span>
                    </div>
                  )}

                  {updateState?.status === 'up-to-date' && (
                    <div
                      className="rounded-lg border p-3.5 text-xs flex items-center justify-between gap-2 flex-wrap"
                      style={{
                        backgroundColor: 'rgba(52, 211, 153, 0.08)',
                        borderColor: 'rgba(52, 211, 153, 0.35)',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--success)' }} />
                        <span>
                          当前已是最新版本 <strong className="font-mono">v{displayVersion}</strong>
                          {updateState.release ? `（云端最新 ${updateState.release.tagName}）` : ''}
                        </span>
                        {updateState.release?.checkSource && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[11px]"
                            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}
                          >
                            通道：{updateState.release.checkSource}
                          </span>
                        )}
                      </div>
                      {updateState.checkedAt && (
                        <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                          检查于 {formatDateTime(updateState.checkedAt)}
                        </span>
                      )}
                    </div>
                  )}

                  {updateState?.status === 'error' && (
                    <div
                      className="rounded-lg border p-3.5 text-xs space-y-2"
                      style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        borderColor: 'rgba(239, 68, 68, 0.35)',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
                        <div className="leading-relaxed">{updateState.error || '检查或下载更新时发生未知错误'}</div>
                      </div>
                      <div className="flex items-center gap-2 pl-6">
                        <button
                          type="button"
                          onClick={handleCheckUpdates}
                          className="h-7 px-3 rounded-md border text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
                          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                        >
                          重试检查
                        </button>
                        <button
                          type="button"
                          onClick={() => window.api.updater.openReleasesPage()}
                          className="h-7 px-3 rounded-md border text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
                          style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent)' }}
                        >
                          在浏览器中手动下载
                        </button>
                      </div>
                    </div>
                  )}

                  {updateState?.release &&
                    (updateState.status === 'available' ||
                      updateState.status === 'downloading' ||
                      updateState.status === 'downloaded') && (
                      <div
                        className="rounded-lg border p-3.5 space-y-3"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          borderColor:
                            updateState.status === 'downloaded' ? 'var(--success)' : 'var(--accent)'
                        }}
                      >
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ArrowUpCircle
                                className="w-4 h-4 shrink-0"
                                style={{
                                  color: updateState.status === 'downloaded' ? 'var(--success)' : 'var(--accent)'
                                }}
                              />
                              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {updateState.release.name || `PrismVault v${updateState.release.version}`}
                              </span>
                              <span
                                className="text-xs font-mono px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                              >
                                v{displayVersion} → v{updateState.release.version}
                              </span>
                            </div>
                            {updateState.release.publishedAt && (
                              <div className="text-xs pl-6" style={{ color: 'var(--text-muted)' }}>
                                发布于 {formatDateTime(new Date(updateState.release.publishedAt).getTime())}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Changelog Markdown */}
                        {updateState.release.notes && (
                          <div
                            className="rounded-md border p-3 max-h-44 overflow-y-auto markdown-body text-xs"
                            style={{
                              backgroundColor: 'var(--bg-elevated)',
                              borderColor: 'var(--border-subtle)'
                            }}
                          >
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({ href, children }) => (
                                  <a
                                    href={href}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      if (href) window.api.system.openExternalUrl(href)
                                    }}
                                  >
                                    {children}
                                  </a>
                                )
                              }}
                            >
                              {updateState.release.notes}
                            </ReactMarkdown>
                          </div>
                        )}

                        {/* State: Available -> Download buttons */}
                        {updateState.status === 'available' && (
                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            {updateState.release.recommendedAsset ? (
                              <button
                                type="button"
                                onClick={() => handleDownloadUpdate(updateState.release!.recommendedAsset!.kind)}
                                className="h-9 px-4 rounded-md text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                                style={{ backgroundColor: 'var(--accent-solid)' }}
                              >
                                <Download className="w-4 h-4" />
                                <span>
                                  下载
                                  {updateState.release.recommendedAsset.kind === 'installer' ? '安装版' : '便携版'}
                                  {updateState.release.recommendedAsset.size > 0
                                    ? ` (${formatFileSize(updateState.release.recommendedAsset.size)})`
                                    : ''}
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => window.api.updater.openReleasesPage()}
                                className="h-9 px-4 rounded-md text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                                style={{ backgroundColor: 'var(--accent-solid)' }}
                              >
                                <ExternalLink className="w-4 h-4" />
                                <span>前往 GitHub Releases 下载</span>
                              </button>
                            )}

                            {/* Offer alternative package format when both exist */}
                            {updateState.release.installerAsset &&
                              updateState.release.portableAsset &&
                              updateState.release.recommendedAsset && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDownloadUpdate(
                                      updateState.release!.recommendedAsset!.kind === 'installer'
                                        ? 'portable'
                                        : 'installer'
                                    )
                                  }
                                  className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>
                                    改下
                                    {updateState.release.recommendedAsset.kind === 'installer'
                                      ? `便携版 .zip (${formatFileSize(updateState.release.portableAsset.size)})`
                                      : `安装版 .exe (${formatFileSize(updateState.release.installerAsset.size)})`}
                                  </span>
                                </button>
                              )}

                            <button
                              type="button"
                              onClick={() => window.api.updater.openReleasesPage()}
                              className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>浏览器下载</span>
                            </button>
                          </div>
                        )}

                        {/* State: Downloading -> Progress bar + Cancel */}
                        {updateState.status === 'downloading' && updateState.download && (
                          <div className="space-y-2 pt-0.5">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }}>
                                正在下载 {updateState.download.fileName}
                              </span>
                              <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--accent)' }}>
                                {updateState.download.percent}%
                              </span>
                            </div>
                            <div
                              className="w-full h-2.5 rounded-full overflow-hidden"
                              style={{ backgroundColor: 'var(--bg-elevated)' }}
                            >
                              <div
                                className="h-full transition-all duration-150 rounded-full"
                                style={{
                                  width: `${Math.max(2, Math.min(100, updateState.download.percent))}%`,
                                  backgroundColor: 'var(--accent-solid)'
                                }}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-mono tabular-nums truncate" style={{ color: 'var(--text-muted)' }}>
                                {formatFileSize(updateState.download.transferredBytes)}
                                {updateState.download.totalBytes > 0
                                  ? ` / ${formatFileSize(updateState.download.totalBytes)}`
                                  : ''}
                                {updateState.download.bytesPerSecond > 0
                                  ? ` · ${formatFileSize(updateState.download.bytesPerSecond)}/s`
                                  : ''}
                                {updateState.download.routeLabel ? ` · ${updateState.download.routeLabel}` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={async () => {
                                  const next = await window.api.updater.cancelDownload()
                                  setUpdateState(next)
                                  showToast('已取消下载更新')
                                }}
                                className="h-7 px-3 rounded-md border text-xs hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
                                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                              >
                                取消下载
                              </button>
                            </div>
                          </div>
                        )}

                        {/* State: Downloaded -> Launch Installer or Reveal Portable Zip */}
                        {updateState.status === 'downloaded' && updateState.download && (
                          <div className="space-y-2.5 pt-0.5">
                            <div
                              className="flex items-center gap-2 text-xs font-medium flex-wrap"
                              style={{ color: 'var(--success)' }}
                            >
                              <PackageCheck className="w-4 h-4 shrink-0" />
                              <span className="truncate">
                                已下载就绪：{updateState.download.fileName}（
                                {formatFileSize(updateState.download.totalBytes)}）
                              </span>
                              {updateState.download.verifiedSha256 && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[11px] font-mono"
                                  style={{
                                    backgroundColor: 'rgba(52, 211, 153, 0.14)',
                                    color: 'var(--success)'
                                  }}
                                >
                                  SHA-256 校验通过
                                </span>
                              )}
                              {updateState.download.routeLabel && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[11px]"
                                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                                >
                                  {updateState.download.routeLabel}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={handleInstallUpdate}
                                className="h-9 px-4 rounded-md text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                                style={{ backgroundColor: 'var(--accent-solid)' }}
                              >
                                {updateState.download.kind === 'installer' ? (
                                  <>
                                    <ArrowUpCircle className="w-4 h-4" />
                                    <span>立即退出并安装更新</span>
                                  </>
                                ) : (
                                  <>
                                    <FolderOpen className="w-4 h-4" />
                                    <span>打开更新包所在目录</span>
                                  </>
                                )}
                              </button>
                              {updateState.download.kind === 'installer' && (
                                <button
                                  type="button"
                                  onClick={() => window.api.system.revealInExplorer(updateState.download!.filePath)}
                                  className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                                >
                                  <FolderOpen className="w-3.5 h-3.5" />
                                  <span>打开安装包位置</span>
                                </button>
                              )}
                            </div>
                            {updateState.download.kind === 'portable' && (
                              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                便携版升级提示：请先关闭当前 PrismVault，将下载的压缩包解压并覆盖程序目录即可；索引数据库、分组与备注保存在系统用户目录中，升级不会丢失。
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                  {/* Update Settings: Auto Check & Optional Mirror */}
                  <div
                    className="pt-3 border-t space-y-3"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                      <div>
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          启动应用时自动静默检查更新
                        </div>
                        <div className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          发现新版本时在窗口顶栏轻提示，无新版本或离线时保持安静
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.autoCheckUpdates}
                        onChange={(e) => updateSettings({ autoCheckUpdates: e.target.checked })}
                        className="accent-[var(--accent-solid)] w-4 h-4 cursor-pointer shrink-0"
                      />
                    </label>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        <Globe className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                        <span>自定义加速镜像前缀（可选，默认已内置国内自动加速）</span>
                      </div>
                      <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        留空时软件会自动从多条国内免代理节点与 GitHub 直连中测速选优，并支持断流自动切线续传与 SHA-256 安全校验；仅在你有专属加速地址时才需手动填写。
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={mirrorDraft}
                          onChange={(e) => setMirrorDraft(e.target.value)}
                          placeholder="留空即自动测速选优（无需手动配置）；可填私人镜像如 https://your-proxy.example/"
                          className="flex-1 h-8 px-2.5 rounded-md border text-xs font-mono outline-none select-text focus:border-[var(--accent)]"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleSaveMirror}
                          className="h-8 px-3 rounded-md border text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
                          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                        >
                          保存
                        </button>
                        {(mirrorDraft || settings.updateMirrorUrl) && (
                          <button
                            type="button"
                            onClick={async () => {
                              setMirrorDraft('')
                              await updateSettings({ updateMirrorUrl: '' })
                              showToast('已恢复自动测速优选模式')
                            }}
                            className="h-8 px-2.5 rounded-md text-xs hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            恢复自动
                          </button>
                        )}
                      </div>
                    </div>
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
