export interface VersionChangelogEntry {
  version: string
  title: string
  date: string
  notes: string
}

/**
 * Built-in release notes shown once when a user opens a newly updated version for the first time.
 * Always available offline without waiting for network requests.
 */
export const VERSION_CHANGELOGS: Record<string, VersionChangelogEntry> = {
  '0.3.0': {
    version: '0.3.0',
    title: '3D / CAD 离线预览、棱镜流光与云母界面焕新及免代理云更新',
    date: '2026-11-23',
    notes: [
      '- **3D 与 CAD 离线预览**：支持 `.obj/.fbx/.glb/.gltf/.stl/.ply` 交互预览与视角封面，以及 DWG/DXF 独立线程 60 FPS 矢量预览与图层开关。',
      '- **视觉全面焕新**：新增棱镜流光 / Win11 原生云母 / 谷歌柔彩 / 经典纯色四套背景材质；重构自定义分组微玻璃卡片树（引导线、搜索过滤与一键折展）。',
      '- **分组与目录效率升级**：右键「添加到分组」升级为可滚动横向多级菜单并支持即时新建分组；索引目录支持一键转多级分组与快捷移除；新增「已隐藏」视图与透明图精准棋盘底。',
      '- **国内免代理云更新**：静态清单多源 CDN 竞速检查、国内镜像自动测速、断点续传与 SHA-256 完整性校验。',
      '- **全链路性能优化**：按需分包提速首屏启动，全面优化虚拟滚动、SQLite 复合索引、并发扫描与异步媒体流。'
    ].join('\n')
  },
  '0.2.0': {
    version: '0.2.0',
    title: 'GitHub 云更新、剪贴板/拖放多文件导入与 Eagle 无损迁移',
    date: '2026-11-20',
    notes: [
      '### 核心功能',
      '- **软件云更新引擎**：支持自动静默检查更新、安装版与便携版智能识别、应用内流式下载与一键安装。',
      '- **剪贴板多文件 & 全局拖放导入**：支持 `Ctrl + V` 与拖放文件/文件夹入库，内置同名文件左右缩略图对比冲突弹窗（替换 / 跳过 / 都保留）。',
      '- **Eagle 资源库无损迁移**：精准排除缩略图与已删除项，完整保留多级分组树、备注与原始时间戳。',
      '- **一体化内嵌预览**：双击或空格键直接在中间窗口预览图/PSD/视频/音频/文本/PDF，支持 GPU 丝滑缩放、双 90° 旋转与边缘自动渐隐切图按钮。'
    ].join('\n')
  }
}

export function getChangelogForVersion(version: string): VersionChangelogEntry | null {
  const clean = version.trim().replace(/^[vV]+/, '')
  return VERSION_CHANGELOGS[clean] ?? null
}
