export interface FontPreset {
  id: string
  label: string
  preview: string
  stack: string
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: 'system',
    label: 'WinUI 系统默认（推荐）',
    preview: 'Segoe UI Variable + 微软雅黑 UI',
    stack: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif'
  },
  {
    id: 'yahei',
    label: '微软雅黑（高清晰度）',
    preview: '经典 Windows 中文屏幕字体',
    stack: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif'
  },
  {
    id: 'modern-sans',
    label: '现代无衬线（鸿蒙 / 思源 / 苹方）',
    preview: '若本机已安装自动优先启用',
    stack: '"HarmonyOS Sans SC", "MiSans", "Alibaba PuHuiTi 3.0", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif'
  },
  {
    id: 'reading-serif',
    label: '人文阅读体（霞鹜文楷 / 宋体）',
    preview: '适合文本与 Markdown 深度阅读',
    stack: '"LXGW WenKai", "Source Han Serif SC", "Noto Serif SC", "SimSun", serif'
  },
  {
    id: 'mono',
    label: '等宽字体（Cascadia / Consolas）',
    preview: '整齐对齐，适合代码与编号素材',
    stack: '"Cascadia Code", "JetBrains Mono", "Consolas", "Microsoft YaHei UI", monospace'
  }
]

export const FONT_SIZE_PRESETS = [
  { size: 13, label: '紧凑 (13px)' },
  { size: 15, label: '标准 (15px)' },
  { size: 17, label: '舒适 (17px)' },
  { size: 19, label: '4K 大字 (19px)' },
  { size: 21, label: '超大 (21px)' }
]

export function resolveFontStack(fontFamilyKey: string): string {
  const key = (fontFamilyKey || 'system').trim()
  const preset = FONT_PRESETS.find((p) => p.id === key)
  if (preset) return preset.stack
  // Custom user-specified local font family name
  const safeName = key.replace(/["\\;]/g, '')
  return `"${safeName}", "Microsoft YaHei UI", "Segoe UI", sans-serif`
}

export function applyTypographyToDocument(fontFamily: string, fontSize: number): void {
  const clampedSize = Math.min(22, Math.max(12, Number(fontSize) || 15))
  document.documentElement.style.setProperty('--app-font-size', `${clampedSize}px`)
  document.documentElement.style.setProperty('--app-font-family', resolveFontStack(fontFamily))
}
