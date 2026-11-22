import React, { useEffect, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { LeftSidebar } from './components/LeftSidebar'
import { TopToolbar } from './components/TopToolbar'
import { AssetCanvas } from './components/AssetCanvas'
import { InlinePreview } from './components/InlinePreview'
import { RightInspector } from './components/RightInspector'
import { SettingsModal } from './components/SettingsModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { useLibraryStore } from './store/useLibraryStore'

export const App: React.FC = () => {
  const {
    init,
    refreshAll,
    setScanProgress,
    patchThumbReady,
    leftPanelOpen,
    rightPanelOpen,
    previewAssetId,
    toast,
    showToast
  } = useLibraryStore()

  const [leftWidth, setLeftWidth] = useState(268)
  const [rightWidth, setRightWidth] = useState(330)
  const resizingRef = useRef<'left' | 'right' | null>(null)

  useEffect(() => {
    init()

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshAll()
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
      patchThumbReady(payload)
    })

    const unsubChanged = window.api.events.onAssetsChanged(() => {
      scheduleRefresh()
    })

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubProgress()
      unsubThumb()
      unsubChanged()
    }
  }, [])

  // Global keyboard shortcuts (including Ctrl+V clipboard image import when window is active)
  useEffect(() => {
    let pasting = false
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (isEditing) return

      const state = useLibraryStore.getState()
      if (state.confirmDialog != null) return
      if (state.settingsOpen) {
        if (e.key === 'Escape') state.closeSettings()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (!document.hasFocus() || pasting) return
        e.preventDefault()
        pasting = true
        window.api.clipboard
          .pasteImage(state.groupId)
          .then(async (res) => {
            if (res.ok && res.asset) {
              await state.refreshAll()
              state.selectAsset(res.asset.id)
              state.showToast(
                state.groupId != null
                  ? `已从剪贴板导入图片并加入当前分组：${res.asset.fileName}`
                  : `已从剪贴板导入图片：${res.asset.fileName}`,
                'success'
              )
            } else {
              state.showToast(res.reason || '剪贴板中没有可导入的图片', 'info')
            }
          })
          .catch(() => {
            state.showToast('读取剪贴板图片失败', 'error')
          })
          .finally(() => {
            pasting = false
          })
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
  }, [])

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

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-mica)' }}>
      {/* Unified Frameless WinUI 3 TitleBar */}
      <TitleBar />

      {/* Unified Full-Height Three-Column Docked Workspace */}
      <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
        {/* Left Navigation Sidebar (Docked) */}
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

        {/* Center Main Column (Automatically resizes & reflows when Left/Right panels toggle or resize) */}
        <div
          className="flex-1 min-w-0 h-full flex flex-col overflow-hidden"
          style={{ backgroundColor: 'var(--bg-canvas)' }}
        >
          {!isPreviewing && <TopToolbar />}
          <AssetCanvas hidden={isPreviewing} />
          {isPreviewing && <InlinePreview />}
        </div>

        {/* Right Info & Notes Inspector (Docked full-height, pushes center column cleanly without ever overlapping) */}
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

      {/* Settings & Unified Confirm Dialogs */}
      <SettingsModal />
      <ConfirmDialog />

      {/* Toast Notification */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-lg border shadow-2xl text-sm font-medium backdrop-blur-md pointer-events-none"
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
