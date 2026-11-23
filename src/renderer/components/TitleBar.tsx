import React, { useEffect, useState } from 'react'
import {
  ArrowUpCircle,
  Download,
  FolderPlus,
  Moon,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Sun,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { AppLogo } from './AppLogo'

export const TitleBar: React.FC = () => {
  const {
    search,
    setSearch,
    settings,
    updateSettings,
    scanProgress,
    updateState,
    openSettings,
    leftPanelOpen,
    rightPanelOpen,
    toggleLeftPanel,
    toggleRightPanel,
    refreshAll,
    showToast
  } = useLibraryStore()

  const [localSearch, setLocalSearch] = useState(search)

  useEffect(() => {
    setLocalSearch(search)
  }, [search])

  useEffect(() => {
    const t = setTimeout(() => {
      if (localSearch !== search) {
        setSearch(localSearch)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [localSearch, search, setSearch])

  const handleScanAll = async () => {
    if (scanProgress.running) return
    showToast('开始增量同步索引目录...')
    await window.api.sources.scan()
  }

  const handleAddSource = async () => {
    const added = await window.api.sources.pickAndAdd()
    if (added) {
      showToast(`已挂载目录「${added.alias}」，正在后台索引...`, 'success')
      await refreshAll()
    }
  }

  return (
    <header
      className="app-drag-region h-[42px] shrink-0 flex items-center justify-between gap-3 pl-3 pr-[146px] border-b select-none"
      style={{
        backgroundColor: 'var(--bg-mica)',
        borderColor: 'var(--border-subtle)'
      }}
    >
      {/* Left: Brand Identity + Sidebar Toggle */}
      <div className="app-no-drag flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={toggleLeftPanel}
          className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          style={{
            color: leftPanelOpen ? 'var(--accent)' : 'var(--text-secondary)'
          }}
          title={leftPanelOpen ? '收起左侧导航栏' : '展开左侧导航栏'}
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 pr-1">
          <AppLogo size={24} />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              PrismVault
            </span>
            <span className="hidden xl:inline text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              棱镜匣
            </span>
          </div>
        </div>
      </div>

      {/* Center: Integrated WinUI Search Bar */}
      <div className="app-no-drag flex-1 max-w-xl min-w-[200px] mx-2">
        <div
          className="flex items-center gap-2 h-8 px-3 rounded-md border transition-colors focus-within:border-[var(--accent)]"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="搜索文件名、备注内容或盘符路径..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--text-muted)]"
            style={{ color: 'var(--text-primary)' }}
          />
          {localSearch && (
            <button
              type="button"
              onClick={() => {
                setLocalSearch('')
                setSearch('')
              }}
              className="p-0.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
              title="清除搜索"
            >
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Right: Quick actions + Right Inspector Toggle (leaving clean room for Win11 caption controls) */}
      <div className="app-no-drag flex items-center gap-1 shrink-0">
        {updateState &&
          updateState.release &&
          (updateState.status === 'available' ||
            updateState.status === 'downloading' ||
            updateState.status === 'downloaded') && (
            <button
              type="button"
              onClick={() => openSettings('about')}
              className="h-7 px-2.5 mr-0.5 rounded-full border flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors hover:brightness-110"
              style={{
                backgroundColor:
                  updateState.status === 'downloaded' ? 'rgba(52, 211, 153, 0.14)' : 'var(--bg-active)',
                borderColor: updateState.status === 'downloaded' ? 'var(--success)' : 'var(--accent)',
                color: updateState.status === 'downloaded' ? 'var(--success)' : 'var(--accent)'
              }}
              title={
                updateState.status === 'downloaded'
                  ? `PrismVault v${updateState.release.version} 已下载就绪，点击前往安装`
                  : updateState.status === 'downloading'
                    ? `正在下载 PrismVault v${updateState.release.version} (${updateState.download?.percent ?? 0}%)`
                    : `发现 PrismVault 新版本 v${updateState.release.version}，点击查看更新详情`
              }
            >
              {updateState.status === 'downloading' ? (
                <Download className="w-3.5 h-3.5 animate-pulse shrink-0" />
              ) : (
                <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="whitespace-nowrap">
                {updateState.status === 'downloading'
                  ? `更新 ${updateState.download?.percent ?? 0}%`
                  : updateState.status === 'downloaded'
                    ? `安装 v${updateState.release.version}`
                    : `新版本 v${updateState.release.version}`}
              </span>
            </button>
          )}

        <button
          type="button"
          onClick={handleAddSource}
          className="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          title="挂载新的本地目录（不复制原文件）"
        >
          <FolderPlus className="w-4 h-4" />
          <span className="hidden lg:inline">挂载目录</span>
        </button>

        <button
          type="button"
          onClick={handleScanAll}
          disabled={scanProgress.running}
          className="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-60 cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          title="重新同步所有挂载目录"
        >
          <RefreshCw className={`w-4 h-4 ${scanProgress.running ? 'animate-spin text-[var(--accent)]' : ''}`} />
          <span className="hidden xl:inline">{scanProgress.running ? '扫描中' : '同步'}</span>
        </button>

        <button
          type="button"
          onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          title={settings.theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
        >
          {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={toggleRightPanel}
          className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
          style={{
            backgroundColor: rightPanelOpen ? 'var(--bg-active)' : 'transparent',
            color: rightPanelOpen ? 'var(--accent)' : 'var(--text-secondary)'
          }}
          title={rightPanelOpen ? '收起右侧信息与备注栏' : '展开右侧信息与备注栏'}
        >
          <PanelRight className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
