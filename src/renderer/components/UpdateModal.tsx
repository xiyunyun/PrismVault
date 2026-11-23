import React, { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useShallow } from 'zustand/react/shallow'
import {
  AlertCircle,
  ArrowUpCircle,
  Calendar,
  Download,
  ExternalLink,
  FolderOpen,
  PackageCheck,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  X
} from 'lucide-react'
import { useLibraryStore } from '../store/useLibraryStore'
import { AppLogo } from './AppLogo'
import { formatDateTime, formatFileSize } from '@shared/mediaTypes'
import { getChangelogForVersion } from '@shared/changelog'

export const UpdateModal: React.FC = () => {
  const {
    updateModalOpen,
    closeUpdateModal,
    openSettings,
    appInfo,
    updateState,
    setUpdateState,
    showToast
  } = useLibraryStore(
    useShallow((s) => ({
      updateModalOpen: s.updateModalOpen,
      closeUpdateModal: s.closeUpdateModal,
      openSettings: s.openSettings,
      appInfo: s.appInfo,
      updateState: s.updateState,
      setUpdateState: s.setUpdateState,
      showToast: s.showToast
    }))
  )

  useEffect(() => {
    if (!updateModalOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeUpdateModal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [updateModalOpen, closeUpdateModal])

  if (!updateModalOpen || !updateState?.release) return null

  const release = updateState.release
  const currentVersion = appInfo?.version || updateState.currentVersion || '0.0.0'
  const publishedText = release.publishedAt
    ? formatDateTime(new Date(release.publishedAt).getTime())
    : '未知日期'

  const handleDownload = async (kind?: 'installer' | 'portable') => {
    try {
      const next = await window.api.updater.download(kind)
      setUpdateState(next)
      if (next.status === 'downloaded') {
        showToast(`PrismVault v${release.version} 已下载完成，可立即安装`, 'success')
      } else if (next.status === 'error' && next.error) {
        showToast(next.error, 'error')
      }
    } catch {
      showToast('下载更新包失败，请重试或前往网页下载', 'error')
    }
  }

  const handleInstall = async () => {
    const res = await window.api.updater.install()
    if (res.ok && res.action === 'launched-installer') {
      showToast('正在启动安装向导，应用即将自动退出完成升级...', 'info')
    } else if (res.ok && res.action === 'revealed-portable') {
      showToast('已打开更新包目录，请关闭软件后解压覆盖即可完成升级', 'success')
    } else if (!res.ok) {
      showToast(res.error || '无法启动安装程序', 'error')
    }
  }

  const handleCancel = async () => {
    const next = await window.api.updater.cancelDownload()
    setUpdateState(next)
    showToast('已取消下载更新')
  }

  const handleRecheck = async () => {
    const next = await window.api.updater.check({ silent: false })
    setUpdateState(next)
  }

  return (
    <div
      className="fixed inset-0 z-[72] flex items-center justify-center bg-black/55 backdrop-blur-[3px] p-4"
      onClick={closeUpdateModal}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[84vh]"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)'
        }}
      >
        {/* Modal Header */}
        <div
          className="px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(0, 120, 212, 0.14) 0%, rgba(96, 205, 255, 0.05) 100%)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo size={34} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {updateState.status === 'downloaded' ? '新版本已下载就绪' : '发现 PrismVault 新版本'}
                </h3>
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-mono font-medium"
                  style={{
                    backgroundColor:
                      updateState.status === 'downloaded' ? 'rgba(52, 211, 153, 0.16)' : 'var(--bg-active)',
                    color: updateState.status === 'downloaded' ? 'var(--success)' : 'var(--accent)'
                  }}
                >
                  v{currentVersion} → v{release.version}
                </span>
              </div>
              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                {release.name || `PrismVault v${release.version}`}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={closeUpdateModal}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
            style={{ color: 'var(--text-secondary)' }}
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Metadata Bar: Version + Published Date + Source */}
        <div
          className="px-5 py-2.5 border-b flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs shrink-0"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)'
          }}
        >
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span>版本号：</span>
            <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
              v{release.version}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span>发布日期：</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
              {publishedText}
            </span>
          </div>
          {release.checkSource && (
            <div className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>
              来源：{release.checkSource}
            </div>
          )}
        </div>

        {/* Scrollable Changelog Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
              更新内容
            </div>
            <div
              className="rounded-xl border p-4 markdown-body text-xs leading-relaxed"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-subtle)'
              }}
            >
              {release.notes ? (
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
                  {release.notes}
                </ReactMarkdown>
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>本次版本暂无详细更新日志，可前往 Releases 页面查看。</div>
              )}
            </div>
          </div>

          {/* Downloading Progress */}
          {updateState.status === 'downloading' && updateState.download && (
            <div
              className="rounded-xl border p-3.5 space-y-2"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--accent)'
              }}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }}>
                  正在下载 {updateState.download.fileName}
                </span>
                <span className="font-mono font-semibold tabular-nums shrink-0" style={{ color: 'var(--accent)' }}>
                  {updateState.download.percent}%
                </span>
              </div>
              <div
                className="w-full h-2.5 rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--bg-surface)' }}
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
                  {updateState.download.totalBytes > 0 ? ` / ${formatFileSize(updateState.download.totalBytes)}` : ''}
                  {updateState.download.bytesPerSecond > 0
                    ? ` · ${formatFileSize(updateState.download.bytesPerSecond)}/s`
                    : ''}
                  {updateState.download.routeLabel ? ` · ${updateState.download.routeLabel}` : ''}
                </span>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="h-7 px-2.5 rounded-md border text-xs hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  取消下载
                </button>
              </div>
            </div>
          )}

          {/* Downloaded Ready Banner */}
          {updateState.status === 'downloaded' && updateState.download && (
            <div
              className="rounded-xl border p-3.5 space-y-1.5 text-xs"
              style={{
                backgroundColor: 'rgba(52, 211, 153, 0.08)',
                borderColor: 'rgba(52, 211, 153, 0.35)'
              }}
            >
              <div className="flex items-center gap-2 font-medium flex-wrap" style={{ color: 'var(--success)' }}>
                <PackageCheck className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  已下载完成：{updateState.download.fileName}（{formatFileSize(updateState.download.totalBytes)}）
                </span>
                {updateState.download.verifiedSha256 && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono"
                    style={{ backgroundColor: 'rgba(52, 211, 153, 0.16)', color: 'var(--success)' }}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    SHA-256 已校验
                  </span>
                )}
              </div>
              {updateState.download.kind === 'portable' && (
                <div className="leading-relaxed pl-6" style={{ color: 'var(--text-secondary)' }}>
                  便携版提示：请关闭 PrismVault 后将下载的压缩包解压覆盖程序目录，原有索引与备注完整保留。
                </div>
              )}
            </div>
          )}

          {/* Error Banner */}
          {updateState.status === 'error' && updateState.error && (
            <div
              className="rounded-xl border p-3.5 text-xs flex items-start gap-2"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                borderColor: 'rgba(239, 68, 68, 0.35)',
                color: 'var(--text-primary)'
              }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
              <div className="leading-relaxed">{updateState.error}</div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="px-5 py-3.5 border-t flex items-center justify-between gap-2 flex-wrap shrink-0"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <button
            type="button"
            onClick={() => {
              closeUpdateModal()
              openSettings('about')
            }}
            className="h-8 px-2.5 rounded-md text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>更新设置</span>
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => window.api.updater.openReleasesPage()}
              className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>网页下载</span>
            </button>

            {updateState.status === 'downloaded' && updateState.download ? (
              <>
                {updateState.download.kind === 'installer' && (
                  <button
                    type="button"
                    onClick={() => window.api.system.revealInExplorer(updateState.download!.filePath)}
                    className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>打开位置</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleInstall}
                  className="h-9 px-4 rounded-md text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer hover:opacity-95"
                  style={{ backgroundColor: 'var(--accent-solid)' }}
                >
                  {updateState.download.kind === 'installer' ? (
                    <>
                      <ArrowUpCircle className="w-4 h-4" />
                      <span>立即退出并安装</span>
                    </>
                  ) : (
                    <>
                      <FolderOpen className="w-4 h-4" />
                      <span>打开更新包目录</span>
                    </>
                  )}
                </button>
              </>
            ) : updateState.status === 'downloading' ? (
              <button
                type="button"
                onClick={closeUpdateModal}
                className="h-9 px-4 rounded-md border text-xs font-medium hover:bg-[var(--bg-hover)] cursor-pointer"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                后台继续下载
              </button>
            ) : (
              <>
                {updateState.status === 'error' && (
                  <button
                    type="button"
                    onClick={handleRecheck}
                    className="h-9 px-3 rounded-md border text-xs flex items-center gap-1.5 hover:bg-[var(--bg-hover)] cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>重新检查</span>
                  </button>
                )}
                {release.installerAsset && release.portableAsset && release.recommendedAsset && (
                  <button
                    type="button"
                    onClick={() =>
                      handleDownload(release.recommendedAsset!.kind === 'installer' ? 'portable' : 'installer')
                    }
                    className="h-9 px-3 rounded-md border text-xs hover:bg-[var(--bg-hover)] cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    改下{release.recommendedAsset.kind === 'installer' ? '便携版' : '安装版'}
                  </button>
                )}
                {release.recommendedAsset && (
                  <button
                    type="button"
                    onClick={() => handleDownload(release.recommendedAsset!.kind)}
                    className="h-9 px-4 rounded-md text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer hover:opacity-95"
                    style={{ backgroundColor: 'var(--accent-solid)' }}
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      立即下载{release.recommendedAsset.kind === 'installer' ? '安装版' : '便携版'}
                      {release.recommendedAsset.size > 0
                        ? ` (${formatFileSize(release.recommendedAsset.size)})`
                        : ''}
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const WhatsNewModal: React.FC = () => {
  const { whatsNewOpen, dismissWhatsNew, appInfo } = useLibraryStore(
    useShallow((s) => ({
      whatsNewOpen: s.whatsNewOpen,
      dismissWhatsNew: s.dismissWhatsNew,
      appInfo: s.appInfo
    }))
  )

  useEffect(() => {
    if (!whatsNewOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismissWhatsNew()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [whatsNewOpen, dismissWhatsNew])

  if (!whatsNewOpen || !appInfo) return null

  const entry = getChangelogForVersion(appInfo.version)
  if (!entry) return null

  return (
    <div
      className="fixed inset-0 z-[74] flex items-center justify-center bg-black/55 backdrop-blur-[3px] p-4"
      onClick={() => dismissWhatsNew()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)'
        }}
      >
        {/* Celebratory WinUI Header */}
        <div
          className="px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(0, 120, 212, 0.16) 0%, rgba(56, 189, 248, 0.06) 100%)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Sparkles className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  PrismVault 已更新至 v{entry.version}
                </h3>
                <span
                  className="px-2 py-0.5 rounded-full text-[11px] font-mono"
                  style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
                >
                  {entry.date}
                </span>
              </div>
              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                {entry.title}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => dismissWhatsNew()}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer shrink-0"
            style={{ color: 'var(--text-secondary)' }}
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Changelog Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div
            className="rounded-xl border p-4 markdown-body text-xs leading-relaxed"
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
              {entry.notes}
            </ReactMarkdown>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3.5 border-t flex items-center justify-between gap-3 shrink-0"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            关闭后当前版本不再弹出，直到下次升级至新版本
          </span>
          <button
            type="button"
            onClick={() => dismissWhatsNew()}
            className="h-9 px-5 rounded-md text-xs font-medium text-white cursor-pointer hover:opacity-95 shrink-0"
            style={{ backgroundColor: 'var(--accent-solid)' }}
          >
            我知道了，开始使用
          </button>
        </div>
      </div>
    </div>
  )
}
