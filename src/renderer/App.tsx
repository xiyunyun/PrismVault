import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderDown } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { TitleBar } from './components/TitleBar'
import { LeftSidebar } from './components/LeftSidebar'
import { TopToolbar } from './components/TopToolbar'
import { AssetCanvas } from './components/AssetCanvas'
import { InlinePreview } from './components/InlinePreview'
import { RightInspector } from './components/RightInspector'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ImportConflictDialog } from './components/ImportConflictDialog'
import { UpdateModal, WhatsNewModal } from './components/UpdateModal'
import { useLibraryStore } from './store/useLibraryStore'
import { flattenGroupTree } from './utils/mediaUrl'
import { formatFileSize } from '@shared/mediaTypes'
import type { ClipboardInspectResult, ConflictResolution } from '@shared/types'

const SettingsModal = React.lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
)

async function enqueueMissing3DThumbsLazily(): Promise<void> {
  const missing = await window.api.assets.getMissingModelThumbs()
  if (missing.length === 0) return
  // Only load Three.js bundle into memory when there are actually 3D models lacking thumbnails
  const { modelThumbQueue } = await import('./utils/model3d')
  modelThumbQueue.enqueueMany(missing)
}

export const App: React.FC = () => {
  const {
    init,
    refreshAll,
    setScanProgress,
    setUpdateState,
    patchThumbsReadyBatch,
    leftPanelOpen,
    rightPanelOpen,
    previewAssetId,
    settingsOpen,
    backdropStyle,
    backdropMotion,
    groupId,
    groups,
    toast,
    showToast
  } = useLibraryStore(
    useShallow((s) => ({
      init: s.init,
      refreshAll: s.refreshAll,
      setScanProgress: s.setScanProgress,
      setUpdateState: s.setUpdateState,
      patchThumbsReadyBatch: s.patchThumbsReadyBatch,
      leftPanelOpen: s.leftPanelOpen,
      rightPanelOpen: s.rightPanelOpen,
      previewAssetId: s.previewAssetId,
      settingsOpen: s.settingsOpen,
      backdropStyle: s.settings.backdropStyle,
      backdropMotion: s.settings.backdropMotion,
      groupId: s.groupId,
      groups: s.groups,
      toast: s.toast,
      showToast: s.showToast
    }))
  )

  const [leftWidth, setLeftWidth] = useState(268)
  const [rightWidth, setRightWidth] = useState(330)
  const [externalDragOver, setExternalDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  const importingRef = useRef(false)
  const resizingRef = useRef<'left' | 'right' | null>(null)

  const activeGroupName = useMemo(() => {
    if (groupId == null) return null
    const flat = flattenGroupTree(groups)
    return flat.find((g) => g.id === groupId)?.fullPath ?? null
  }, [groupId, groups])

  /**
   * Unified import pipeline shared by BOTH external Drag-and-Drop AND Ctrl+V Clipboard paste:
   * 1. Batch count/size threshold warning dialog
   * 2. Side-by-side thumbnail conflict resolution dialog (Replace / Skip / Keep Both)
   * 3. Commit import into active group (or ungrouped when no group is selected)
   */
  const executeImportFlow = useCallback(async (info: ClipboardInspectResult, sourceLabel: string) => {
    if (!info.hasContent) {
      useLibraryStore.getState().showToast(info.reason || `${sourceLabel}中没有可导入的文件`, 'info')
      return
    }

    const { clipboardMaxFiles, clipboardMaxSizeMB } = useLibraryStore.getState().settings
    const exceedsCount = clipboardMaxFiles > 0 && info.fileCount > clipboardMaxFiles
    const exceedsSize = clipboardMaxSizeMB > 0 && info.totalBytes > clipboardMaxSizeMB * 1024 * 1024

    if (exceedsCount || exceedsSize) {
      let title = '确认批量导入'
      let message = ''
      if (exceedsCount && exceedsSize) {
        title = `导入的文件超过 ${clipboardMaxFiles} 个且总大小超过 ${clipboardMaxSizeMB} MB`
        message = `本次共有 ${info.fileCount} 个文件，总大小 ${formatFileSize(info.totalBytes)}，是否确定全部导入？`
      } else if (exceedsCount) {
        title = `导入的文件超过 ${clipboardMaxFiles} 个`
        message = `本次共有 ${info.fileCount} 个文件（总大小 ${formatFileSize(info.totalBytes)}），是否确定全部导入？`
      } else {
        title = `导入的总大小超过 ${clipboardMaxSizeMB} MB`
        message = `本次共有 ${info.fileCount} 个文件，总大小 ${formatFileSize(info.totalBytes)}，是否确定全部导入？`
      }

      const ok = await useLibraryStore.getState().confirm({
        title,
        message,
        detail: '可在「设置 → 操作与交互」中自由调整单次导入的数量或大小提醒阈值。',
        confirmText: '确定导入',
        variant: 'warning'
      })
      if (!ok) return
    }

    // Check filename conflicts and present side-by-side thumbnail comparison dialog
    let resolutions: Record<string, ConflictResolution> | undefined
    if (info.conflicts && info.conflicts.length > 0) {
      const userChoice = await useLibraryStore.getState().resolveImportConflicts(info.conflicts)
      if (userChoice === null) {
        useLibraryStore.getState().showToast('已取消本次导入')
        return
      }
      resolutions = userChoice
    }

    const targetGroupId = useLibraryStore.getState().groupId
    const res = await window.api.clipboard.commitImport({
      targetGroupId,
      filePaths: info.filePaths,
      resolutions
    })

    if (res.ok) {
      await useLibraryStore.getState().refreshAll()
      if (res.assets.length > 0) {
        useLibraryStore.getState().setSelectedIds(res.assets.map((a) => a.id))
      }

      const summaryParts: string[] = []
      if (res.importedCount > 0) summaryParts.push(`新增 ${res.importedCount} 个`)
      if (res.replacedCount > 0) summaryParts.push(`替换 ${res.replacedCount} 个`)
      if (res.skippedCount > 0) summaryParts.push(`跳过 ${res.skippedCount} 个`)

      const groupHint = targetGroupId != null ? '（已归入当前分组）' : '（已放入未分类）'
      if (summaryParts.length > 0) {
        useLibraryStore
          .getState()
          .showToast(`${sourceLabel}导入完成：${summaryParts.join('，')}${res.assets.length > 0 ? groupHint : ''}`, 'success')
      } else {
        useLibraryStore.getState().showToast('未导入任何文件', 'info')
      }
    } else {
      useLibraryStore.getState().showToast(res.reason || `${sourceLabel}导入失败`, 'error')
    }
  }, [])

  useEffect(() => {
    init().then(() => {
      // Kick off low-priority background 3D model thumbnail generation only if needed (lazy loads Three.js)
      setTimeout(() => {
        enqueueMissing3DThumbsLazily().catch(() => undefined)
      }, 600)
    })

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let modelThumbTimer: ReturnType<typeof setTimeout> | null = null
    let thumbBatchTimer: ReturnType<typeof setTimeout> | null = null
    const pendingThumbs = new Map<
      number,
      { assetId: number; thumbPath: string; width?: number | null; height?: number | null }
    >()

    const flushThumbBatch = () => {
      thumbBatchTimer = null
      if (pendingThumbs.size === 0) return
      const batch = Array.from(pendingThumbs.values())
      pendingThumbs.clear()
      patchThumbsReadyBatch(batch)
    }

    const scheduleModelThumbs = () => {
      if (modelThumbTimer) clearTimeout(modelThumbTimer)
      modelThumbTimer = setTimeout(() => {
        enqueueMissing3DThumbsLazily().catch(() => undefined)
      }, 800)
    }
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshAll()
        scheduleModelThumbs()
      }, 220)
    }

    const unsubProgress = window.api.events.onScanProgress((progress) => {
      const prevRunning = useLibraryStore.getState().scanProgress.running
      setScanProgress(progress)
      if (prevRunning && !progress.running) {
        const parts: string[] = []
        if (progress.added > 0) parts.push(`新增 ${progress.added}`)
        if (progress.updated > 0) parts.push(`更新 ${progress.updated}`)
        if (progress.relinked > 0) parts.push(`自动重连 ${progress.relinked}`)
        if (progress.missing > 0) parts.push(`离线 ${progress.missing}`)
        showToast(parts.length > 0 ? `索引同步完成：${parts.join('，')}` : '索引同步完成，暂无变更', 'success')
        scheduleRefresh()
      }
    })

    const unsubThumb = window.api.events.onThumbReady((payload) => {
      pendingThumbs.set(payload.assetId, payload)
      if (!thumbBatchTimer) {
        thumbBatchTimer = setTimeout(flushThumbBatch, 140)
      }
    })

    const unsubChanged = window.api.events.onAssetsChanged(() => {
      scheduleRefresh()
    })

    let notifiedVersion: string | null = null
    const unsubUpdate = window.api.events.onUpdateState((nextState) => {
      setUpdateState(nextState)
      if (
        nextState.silent &&
        (nextState.status === 'available' || nextState.status === 'downloaded') &&
        nextState.release &&
        notifiedVersion !== nextState.release.version
      ) {
        notifiedVersion = nextState.release.version
        showToast(`发现新版本 v${nextState.release.version}，可点击左上角「有更新」按钮查看详情`, 'info')
      }
    })

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      if (modelThumbTimer) clearTimeout(modelThumbTimer)
      if (thumbBatchTimer) clearTimeout(thumbBatchTimer)
      unsubProgress()
      unsubThumb()
      unsubChanged()
      unsubUpdate()
    }
  }, [])

  // Global keyboard shortcuts (including Ctrl+V clipboard multi-file/image import)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (isEditing) return

      const state = useLibraryStore.getState()
      if (state.confirmDialog != null || state.importConflictDialog != null || state.updateModalOpen || state.whatsNewOpen) return
      if (state.settingsOpen) {
        if (e.key === 'Escape') state.closeSettings()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (!document.hasFocus() || importingRef.current) return
        e.preventDefault()
        importingRef.current = true
        ;(async () => {
          try {
            const info = await window.api.clipboard.inspect()
            await executeImportFlow(info, '剪贴板')
          } catch {
            useLibraryStore.getState().showToast('读取剪贴板内容失败', 'error')
          } finally {
            importingRef.current = false
          }
        })()
        return
      }

      if (state.previewAssetId != null) return

      if (e.code === 'Space' && state.selectedIds.length === 1) {
        e.preventDefault()
        state.setPreviewAssetId(state.selectedIds[0])
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        state.selectAll()
      } else if (e.key === 'Escape' && state.selectedIds.length > 0) {
        state.clearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [executeImportFlow])

  // External OS File Drag-and-Drop onto window
  const isExternalFileDrag = (e: React.DragEvent): boolean => {
    const types = Array.from(e.dataTransfer.types || [])
    return types.includes('Files') && !types.includes('application/x-xiyun-assets')
  }

  const handleWindowDragEnter = (e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    dragDepthRef.current++
    setExternalDragOver(true)
  }

  const handleWindowDragOver = (e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleWindowDragLeave = (e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setExternalDragOver(false)
    }
  }

  const handleWindowDrop = async (e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    dragDepthRef.current = 0
    setExternalDragOver(false)

    if (importingRef.current) return
    const files = Array.from(e.dataTransfer.files || [])
    const paths = files
      .map((f) => {
        try {
          return window.api.system.getPathForFile(f)
        } catch {
          return ''
        }
      })
      .filter((p) => p && p.length > 0)

    if (paths.length === 0) return

    importingRef.current = true
    try {
      const info = await window.api.clipboard.inspectPaths(paths)
      await executeImportFlow(info, '拖放')
    } catch {
      useLibraryStore.getState().showToast('拖放导入文件失败', 'error')
    } finally {
      importingRef.current = false
    }
  }

  // Docked left & right sidebar drag resizing
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      if (resizingRef.current === 'left') {
        setLeftWidth(Math.min(400, Math.max(210, e.clientX)))
      } else if (resizingRef.current === 'right') {
        setRightWidth(Math.min(480, Math.max(280, window.innerWidth - e.clientX)))
      }
    }
    const onMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null
        document.body.style.cursor = ''
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const isPreviewing = previewAssetId != null
  const activeBackdrop = backdropStyle || 'aurora'
  const pauseAmbientMotion = !backdropMotion || isPreviewing

  return (
    <div
      onDragEnter={handleWindowDragEnter}
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
      className={`h-screen w-screen flex flex-col overflow-hidden relative ${pauseAmbientMotion ? 'prism-motion-paused' : ''}`}
      style={{ backgroundColor: activeBackdrop === 'mica' ? 'transparent' : 'var(--bg-mica)' }}
    >
      {/* Ambient Fluid Prism / Pastel Backdrop Layer (zero GPU cost when Mica/Solid/Paused) */}
      {activeBackdrop === 'aurora' && (
        <div className="prism-backdrop-layer" aria-hidden="true">
          <div className="prism-aurora-orb prism-aurora-orb-1" />
          <div className="prism-aurora-orb prism-aurora-orb-2" />
          <div className="prism-aurora-orb prism-aurora-orb-3" />
          <div className="prism-aurora-orb prism-aurora-orb-4" />
        </div>
      )}
      {activeBackdrop === 'pastel' && (
        <div className="prism-backdrop-layer" aria-hidden="true">
          <div className="prism-pastel-mesh" />
        </div>
      )}

      {/* Unified Frameless WinUI 3 TitleBar */}
      <div className="relative z-10 shrink-0">
        <TitleBar />
      </div>

      {/* Unified Full-Height Three-Column Docked Workspace */}
      <div className="relative z-10 flex-1 flex min-h-0 min-w-0 overflow-hidden">
        {leftPanelOpen && (
          <>
            <LeftSidebar width={leftWidth} />
            <div
              onMouseDown={() => {
                resizingRef.current = 'left'
                document.body.style.cursor = 'col-resize'
              }}
              className="w-[3px] shrink-0 cursor-col-resize hover:bg-[var(--accent)]/60 transition-colors"
              title="拖拽调整左侧边栏宽度"
            />
          </>
        )}

        <div className="prism-glass-canvas flex-1 min-w-0 h-full flex flex-col overflow-hidden">
          {!isPreviewing && <TopToolbar />}
          <AssetCanvas hidden={isPreviewing} />
          {isPreviewing && <InlinePreview />}
        </div>

        {rightPanelOpen && (
          <>
            <div
              onMouseDown={() => {
                resizingRef.current = 'right'
                document.body.style.cursor = 'col-resize'
              }}
              className="w-[3px] shrink-0 cursor-col-resize hover:bg-[var(--accent)]/60 transition-colors"
              title="拖拽调整右侧信息栏宽度"
            />
            <RightInspector width={rightWidth} />
          </>
        )}
      </div>

      {/* External File Drop Overlay */}
      {externalDragOver && (
        <div className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-[3px] p-6">
          <div
            className="w-full max-w-md rounded-2xl border-2 border-dashed p-8 text-center shadow-2xl space-y-3"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--accent)'
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
              style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
            >
              <FolderDown className="w-8 h-8" />
            </div>
            <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              松开鼠标即可导入文件
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {activeGroupName ? (
                <>
                  将自动归入当前选中分组：
                  <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                    「{activeGroupName}」
                  </span>
                </>
              ) : (
                <>
                  当前未选中分组，导入后将自动放入
                  <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                    「未分类」
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings (Lazy-loaded on demand), Update/WhatsNew Modals & Unified Dialogs */}
      <Suspense fallback={null}>{settingsOpen && <SettingsModal />}</Suspense>
      <UpdateModal />
      <WhatsNewModal />
      <ConfirmDialog />
      <ImportConflictDialog />

      {/* Toast Notification */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[85] px-4 py-2.5 rounded-lg border shadow-2xl text-sm font-medium backdrop-blur-md pointer-events-none"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor:
              toast.tone === 'success'
                ? 'var(--success)'
                : toast.tone === 'error'
                ? 'var(--danger)'
                : 'var(--border-strong)',
            color: 'var(--text-primary)'
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}
