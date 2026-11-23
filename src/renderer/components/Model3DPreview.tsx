import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  AlertCircle,
  Box,
  Camera,
  ExternalLink,
  Grid3X3,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  RotateCw
} from 'lucide-react'
import { createStudioLights, disposeThreeObject, loadThreeModel } from '../utils/model3d'
import type { Asset, AssetExtraMeta } from '@shared/types'

type ShadingMode = 'material' | 'clay' | 'wireframe'
type StageBg = 'studio' | 'dark' | 'light'

const STAGE_BG_MAP: Record<StageBg, { label: string; color: number; css: string; grid1: number; grid2: number }> = {
  studio: { label: '深灰展台', color: 0x1b202b, css: '#1b202b', grid1: 0x3b4860, grid2: 0x262e3d },
  dark: { label: '纯黑棚拍', color: 0x0d0f14, css: '#0d0f14', grid1: 0x2a3140, grid2: 0x1a1f29 },
  light: { label: '明亮浅灰', color: 0xe8edf3, css: '#e8edf3', grid1: 0x94a3b8, grid2: 0xcbd5e1 }
}

interface Model3DPreviewProps {
  asset: Asset
  wheelMode: 'zoom' | 'navigate'
  onNavigateWheel: (dir: -1 | 1) => void
  onThumbSaved?: () => void
  onToast?: (msg: string, tone?: 'info' | 'success' | 'error') => void
}

export const Model3DPreview: React.FC<Model3DPreviewProps> = ({
  asset,
  wheelMode,
  onNavigateWheel,
  onThumbSaved,
  onToast
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<Partial<AssetExtraMeta> | null>(null)
  const [shading, setShading] = useState<ShadingMode>('material')
  const [showGrid, setShowGrid] = useState(true)
  const [autoRotate, setAutoRotate] = useState(false)
  const [stageBg, setStageBg] = useState<StageBg>('studio')
  const [animNames, setAnimNames] = useState<string[]>([])
  const [activeAnimIdx, setActiveAnimIdx] = useState(0)
  const [animPlaying, setAnimPlaying] = useState(true)
  const [capturingThumb, setCapturingThumb] = useState(false)

  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const modelRootRef = useRef<THREE.Group | null>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const clipsRef = useRef<THREE.AnimationClip[]>([])
  const activeActionRef = useRef<THREE.AnimationAction | null>(null)
  const origMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map())
  const clayMatRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const wireMatRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const defaultCameraRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 }>({
    pos: new THREE.Vector3(3, 2.2, 4),
    target: new THREE.Vector3(0, 1, 0)
  })
  const animPlayingRef = useRef(animPlaying)
  animPlayingRef.current = animPlaying
  const wakeRenderRef = useRef<() => void>(() => undefined)

  const wheelModeRef = useRef(wheelMode)
  const onNavRef = useRef(onNavigateWheel)
  wheelModeRef.current = wheelMode
  onNavRef.current = onNavigateWheel

  const resetCamera = useCallback(() => {
    const cam = cameraRef.current
    const ctrl = controlsRef.current
    if (!cam || !ctrl) return
    cam.position.copy(defaultCameraRef.current.pos)
    ctrl.target.copy(defaultCameraRef.current.target)
    ctrl.update()
    wakeRenderRef.current()
  }, [])

  // Apply shading mode without reloading the model
  const applyShadingMode = useCallback((mode: ShadingMode) => {
    const root = modelRootRef.current
    if (!root) return
    if (!clayMatRef.current) {
      clayMatRef.current = new THREE.MeshStandardMaterial({
        color: 0xd1d8e2,
        roughness: 0.55,
        metalness: 0.05,
        side: THREE.DoubleSide
      })
    }
    if (!wireMatRef.current) {
      wireMatRef.current = new THREE.MeshBasicMaterial({
        color: 0x60cdff,
        wireframe: true
      })
    }
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      if (mode === 'material') {
        const orig = origMaterialsRef.current.get(mesh)
        if (orig) mesh.material = orig
      } else if (mode === 'clay') {
        mesh.material = clayMatRef.current!
      } else if (mode === 'wireframe') {
        mesh.material = wireMatRef.current!
      }
    })
  }, [])

  // Main Three.js lifecycle per asset
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let rafId = 0
    setLoading(true)
    setError(null)
    setStats(null)
    setAnimNames([])
    setActiveAnimIdx(0)
    setShading('material')

    const width = Math.max(container.clientWidth, 320)
    const height = Math.max(container.clientHeight, 240)

    const bgCfg = STAGE_BG_MAP[stageBg]
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(bgCfg.color)
    createStudioLights(scene)

    const grid = new THREE.GridHelper(10, 20, bgCfg.grid1, bgCfg.grid2)
    grid.position.y = -0.002
    grid.visible = showGrid
    scene.add(grid)

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.02, 500)
    camera.position.set(3, 2.2, 4)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08

    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = true
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = 2.0
    controls.minDistance = 0.25
    controls.maxDistance = 60

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    controlsRef.current = controls
    gridRef.current = grid

    // Intercept wheel in capture phase when user intends file navigation (wheelMode XOR Ctrl)
    const onCanvasWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      const ctrlHeld = e.ctrlKey || e.metaKey
      const shouldNavigate = (wheelModeRef.current === 'navigate') !== ctrlHeld
      if (shouldNavigate) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onNavRef.current(e.deltaY < 0 ? -1 : 1)
      }
    }
    renderer.domElement.addEventListener('wheel', onCanvasWheel, { passive: false, capture: true })

    const clock = new THREE.Clock()
    const prevCamPos = new THREE.Vector3()
    const prevTarget = new THREE.Vector3()
    let interacting = false
    let settleFrames = 4

    const wakeRender = (extraSettleFrames = 3) => {
      if (disposed) return
      if (extraSettleFrames > settleFrames) settleFrames = extraSettleFrames
      if (rafId === 0) {
        clock.getDelta() // Reset delta so waking from sleep never causes an animation jump
        rafId = requestAnimationFrame(animate)
      }
    }
    wakeRenderRef.current = () => wakeRender(4)

    const onControlStart = () => {
      interacting = true
      wakeRender(6)
    }
    const onControlChange = () => {
      wakeRender(4)
    }
    const onControlEnd = () => {
      interacting = false
      wakeRender(8)
    }
    controls.addEventListener('start', onControlStart)
    controls.addEventListener('change', onControlChange)
    controls.addEventListener('end', onControlEnd)

    const ro = new ResizeObserver(() => {
      if (!container || disposed) return
      const w = Math.max(container.clientWidth, 100)
      const h = Math.max(container.clientHeight, 100)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      wakeRender(2)
    })
    ro.observe(container)

    const animate = () => {
      rafId = 0
      if (disposed) return
      const delta = Math.min(clock.getDelta(), 0.1)
      const hasActiveAnim = Boolean(mixerRef.current && animPlayingRef.current && clipsRef.current.length > 0)
      if (hasActiveAnim) {
        mixerRef.current!.update(delta)
      }

      prevCamPos.copy(camera.position)
      prevTarget.copy(controls.target)
      controls.update()
      renderer.render(scene, camera)

      const cameraMoved =
        camera.position.distanceToSquared(prevCamPos) > 1e-10 ||
        controls.target.distanceToSquared(prevTarget) > 1e-10

      if (cameraMoved) {
        settleFrames = Math.max(settleFrames, 2)
      } else if (settleFrames > 0) {
        settleFrames--
      }

      if (hasActiveAnim || controls.autoRotate || interacting || settleFrames > 0) {
        rafId = requestAnimationFrame(animate)
      }
    }
    wakeRender(3)

    loadThreeModel(asset.id, asset.fileName, asset.ext)
      .then((loaded) => {
        if (disposed) {
          disposeThreeObject(loaded.root)
          return
        }
        origMaterialsRef.current.clear()
        loaded.root.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (mesh.isMesh && mesh.material) {
            origMaterialsRef.current.set(mesh, mesh.material)
          }
        })

        scene.add(loaded.root)
        modelRootRef.current = loaded.root
        clipsRef.current = loaded.animations
        setStats(loaded.stats)

        // Frame camera nicely at classic 3/4 view
        const dist = Math.max(loaded.radius * 2.45, 2.2)
        const azimuth = (38 * Math.PI) / 180
        const elevation = (24 * Math.PI) / 180
        const camPos = new THREE.Vector3(
          Math.sin(azimuth) * Math.cos(elevation) * dist,
          loaded.centerY + Math.sin(elevation) * dist,
          Math.cos(azimuth) * Math.cos(elevation) * dist
        )
        const camTarget = new THREE.Vector3(0, loaded.centerY, 0)
        defaultCameraRef.current = { pos: camPos.clone(), target: camTarget.clone() }
        camera.position.copy(camPos)
        controls.target.copy(camTarget)
        controls.update()

        if (loaded.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(loaded.root)
          mixerRef.current = mixer
          const action = mixer.clipAction(loaded.animations[0])
          action.play()
          activeActionRef.current = action
          setAnimNames(loaded.animations.map((c, i) => c.name || `动画 ${i + 1}`))
          setAnimPlaying(true)
        }

        setLoading(false)
        wakeRender(4)

        // If this model doesn't have a cached thumbnail yet, capture one automatically after first frame!
        if (!asset.thumbPath) {
          requestAnimationFrame(() => {
            if (disposed || !rendererRef.current || !sceneRef.current || !cameraRef.current) return
            rendererRef.current.render(sceneRef.current, cameraRef.current)
            const dataUrl = rendererRef.current.domElement.toDataURL('image/png')
            window.api.assets
              .saveRenderedThumb(asset.id, dataUrl, loaded.stats)
              .then(() => onThumbSaved?.())
              .catch(() => undefined)
          })
        }
      })
      .catch((err) => {
        if (disposed) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      disposed = true
      wakeRenderRef.current = () => undefined
      if (rafId !== 0) cancelAnimationFrame(rafId)
      ro.disconnect()
      controls.removeEventListener('start', onControlStart)
      controls.removeEventListener('change', onControlChange)
      controls.removeEventListener('end', onControlEnd)
      renderer.domElement.removeEventListener('wheel', onCanvasWheel, { capture: true } as EventListenerOptions)
      controls.dispose()
      if (mixerRef.current) {
        mixerRef.current.stopAllAction()
        mixerRef.current = null
      }
      activeActionRef.current = null
      clipsRef.current = []
      if (modelRootRef.current) {
        scene.remove(modelRootRef.current)
        disposeThreeObject(modelRootRef.current)
        modelRootRef.current = null
      }
      origMaterialsRef.current.clear()
      if (gridRef.current) {
        gridRef.current.geometry.dispose()
        if (Array.isArray(gridRef.current.material)) {
          gridRef.current.material.forEach((m) => m.dispose())
        } else {
          gridRef.current.material.dispose()
        }
        gridRef.current = null
      }
      renderer.dispose()
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
    }
  }, [asset.id])

  // Sync shading mode
  useEffect(() => {
    applyShadingMode(shading)
    wakeRenderRef.current()
  }, [shading, applyShadingMode])

  // Sync grid visibility
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid
      wakeRenderRef.current()
    }
  }, [showGrid])

  // Sync auto-rotate
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate
      wakeRenderRef.current()
    }
  }, [autoRotate])

  // Sync stage background & grid palette
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const cfg = STAGE_BG_MAP[stageBg]
    scene.background = new THREE.Color(cfg.color)
    if (gridRef.current) {
      scene.remove(gridRef.current)
      gridRef.current.geometry.dispose()
      if (Array.isArray(gridRef.current.material)) {
        gridRef.current.material.forEach((m) => m.dispose())
      } else {
        gridRef.current.material.dispose()
      }
      const nextGrid = new THREE.GridHelper(10, 20, cfg.grid1, cfg.grid2)
      nextGrid.position.y = -0.002
      nextGrid.visible = showGrid
      scene.add(nextGrid)
      gridRef.current = nextGrid
    }
    wakeRenderRef.current()
  }, [stageBg, showGrid])

  // Switch animation clip or resume animation playback
  useEffect(() => {
    const mixer = mixerRef.current
    const clips = clipsRef.current
    if (!mixer || clips.length === 0 || !clips[activeAnimIdx]) return
    if (activeActionRef.current) {
      activeActionRef.current.stop()
    }
    const nextAction = mixer.clipAction(clips[activeAnimIdx])
    nextAction.reset().play()
    activeActionRef.current = nextAction
    wakeRenderRef.current()
  }, [activeAnimIdx])

  useEffect(() => {
    if (animPlaying) wakeRenderRef.current()
  }, [animPlaying])

  // Keyboard shortcut '0' to reset view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === '0') resetCamera()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [resetCamera])

  const handleCaptureCurrentAsThumb = async () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current || capturingThumb) return
    setCapturingThumb(true)
    try {
      rendererRef.current.render(sceneRef.current, cameraRef.current)
      const dataUrl = rendererRef.current.domElement.toDataURL('image/png')
      const saved = await window.api.assets.saveRenderedThumb(asset.id, dataUrl, stats ?? undefined)
      if (saved) {
        onThumbSaved?.()
        onToast?.('已将当前视角保存为模型缩略图', 'success')
      }
    } catch {
      onToast?.('保存缩略图失败', 'error')
    } finally {
      setCapturingThumb(false)
    }
  }

  return (
    <div
      className="w-full h-full relative overflow-hidden select-none"
      style={{ backgroundColor: STAGE_BG_MAP[stageBg].css }}
    >
      {/* WebGL Mount Container */}
      <div
        ref={containerRef}
        onDoubleClick={resetCamera}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/35 backdrop-blur-[2px]">
          <RefreshCw className="w-7 h-7 animate-spin" style={{ color: 'var(--accent)' }} />
          <div className="text-sm font-medium text-white">正在加载 3D 模型（{asset.ext.toUpperCase()}）...</div>
          <div className="text-xs text-neutral-300">自动居中适配镜头并尝试加载同目录材质贴图</div>
        </div>
      )}

      {/* Error overlay */}
      {error && !loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-black/55">
          <div
            className="max-w-md rounded-xl border p-6 text-center space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <AlertCircle className="w-10 h-10 mx-auto text-amber-400" />
            <div className="text-sm font-semibold">无法解析此 3D 模型</div>
            <p className="text-xs leading-relaxed break-all" style={{ color: 'var(--text-secondary)' }}>
              {error}
            </p>
            <button
              type="button"
              onClick={() => window.api.system.openExternal(asset.filePath)}
              className="h-9 px-4 rounded-md text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
              style={{ backgroundColor: 'var(--accent-solid)' }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>用系统默认 3D 软件打开</span>
            </button>
          </div>
        </div>
      )}

      {/* Top-Left HUD Stats */}
      {stats && !loading && !error && (
        <div
          className="absolute top-3 left-3 z-20 px-2.5 py-1 rounded-md border backdrop-blur-md text-xs font-mono flex items-center gap-2 pointer-events-none"
          style={{
            backgroundColor: 'rgba(18, 22, 31, 0.72)',
            borderColor: 'rgba(255, 255, 255, 0.14)',
            color: '#e2e8f0'
          }}
        >
          <Box className="w-3.5 h-3.5 text-orange-400" />
          <span className="font-semibold text-orange-300">{stats.format}</span>
          {stats.triangleCount != null && <span>· {stats.triangleCount.toLocaleString()} 面</span>}
          {stats.vertexCount != null && <span>· {stats.vertexCount.toLocaleString()} 顶点</span>}
          {stats.animationCount != null && stats.animationCount > 0 && (
            <span className="text-emerald-300">· {stats.animationCount} 动画</span>
          )}
        </div>
      )}

      {/* Bottom Floating WinUI 3D Control Bar */}
      {!loading && !error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-2.5 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md flex items-center gap-1.5 flex-wrap justify-center max-w-[94%]"
          style={{
            backgroundColor: 'rgba(22, 24, 30, 0.84)',
            borderColor: 'rgba(255, 255, 255, 0.14)',
            color: '#f1f5f9'
          }}
        >
          {/* Shading Modes */}
          {(
            [
              { id: 'material' as const, label: '材质' },
              { id: 'clay' as const, label: '白模' },
              { id: 'wireframe' as const, label: '线框' }
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setShading(m.id)}
              className="h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer transition-colors"
              style={{
                backgroundColor: shading === m.id ? 'rgba(96, 205, 255, 0.22)' : 'transparent',
                color: shading === m.id ? '#60cdff' : '#cbd5e1'
              }}
            >
              {m.label}
            </button>
          ))}

          <div className="w-px h-4 bg-white/15 mx-0.5" />

          {/* Grid Toggle */}
          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className="h-7 px-2 rounded-md text-xs flex items-center gap-1 cursor-pointer transition-colors"
            style={{
              backgroundColor: showGrid ? 'rgba(96, 205, 255, 0.18)' : 'transparent',
              color: showGrid ? '#60cdff' : '#cbd5e1'
            }}
            title="显示/隐藏地面参考网格"
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span>网格</span>
          </button>

          {/* Auto Rotate */}
          <button
            type="button"
            onClick={() => setAutoRotate((v) => !v)}
            className="h-7 px-2 rounded-md text-xs flex items-center gap-1 cursor-pointer transition-colors"
            style={{
              backgroundColor: autoRotate ? 'rgba(96, 205, 255, 0.18)' : 'transparent',
              color: autoRotate ? '#60cdff' : '#cbd5e1'
            }}
            title="开启/关闭自动旋转展示"
          >
            <RotateCw className={`w-3.5 h-3.5 ${autoRotate ? 'animate-spin' : ''}`} />
            <span>旋转</span>
          </button>

          {/* Reset Camera */}
          <button
            type="button"
            onClick={resetCamera}
            className="h-7 px-2 rounded-md text-xs flex items-center gap-1 hover:bg-white/12 cursor-pointer"
            title="重置镜头视角 (双击 / 0)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>复位</span>
          </button>

          <div className="w-px h-4 bg-white/15 mx-0.5" />

          {/* Background Switcher */}
          {(['studio', 'dark', 'light'] as StageBg[]).map((bg) => (
            <button
              key={bg}
              type="button"
              onClick={() => setStageBg(bg)}
              className="h-7 w-6 rounded-md flex items-center justify-center cursor-pointer"
              style={{
                backgroundColor: stageBg === bg ? 'rgba(255,255,255,0.16)' : 'transparent'
              }}
              title={`切换背景：${STAGE_BG_MAP[bg].label}`}
            >
              <span
                className="w-3.5 h-3.5 rounded-full border border-white/40"
                style={{ backgroundColor: STAGE_BG_MAP[bg].css }}
              />
            </button>
          ))}

          {/* Animation Controls (if FBX/GLB has clips) */}
          {animNames.length > 0 && (
            <>
              <div className="w-px h-4 bg-white/15 mx-0.5" />
              <button
                type="button"
                onClick={() => setAnimPlaying((p) => !p)}
                className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-white/12 cursor-pointer text-emerald-300"
                title={animPlaying ? '暂停骨骼动画' : '播放骨骼动画'}
              >
                {animPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              {animNames.length > 1 && (
                <select
                  value={activeAnimIdx}
                  onChange={(e) => setActiveAnimIdx(Number(e.target.value))}
                  className="h-7 px-1.5 rounded-md bg-black/40 border border-white/15 text-xs text-slate-200 outline-none cursor-pointer max-w-[120px]"
                >
                  {animNames.map((name, idx) => (
                    <option key={idx} value={idx} className="bg-neutral-900 text-white">
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          <div className="w-px h-4 bg-white/15 mx-0.5" />

          {/* Capture Current Angle as Thumbnail */}
          <button
            type="button"
            disabled={capturingThumb}
            onClick={handleCaptureCurrentAsThumb}
            className="h-7 px-2.5 rounded-md text-xs flex items-center gap-1 hover:bg-white/12 disabled:opacity-50 cursor-pointer text-sky-300"
            title="将当前调整好的模型视角保存为卡片缩略图（存入 thumbs/models）"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{capturingThumb ? '保存中...' : '设为封面'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
