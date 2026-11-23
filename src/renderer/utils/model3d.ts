import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { getModelFileMediaUrl } from './mediaUrl'
import type { AssetExtraMeta, MissingModelThumbItem, ThumbProgress } from '@shared/types'

export interface LoadedModelResult {
  root: THREE.Group
  animations: THREE.AnimationClip[]
  stats: Partial<AssetExtraMeta>
  radius: number
  centerY: number
}

function createStudioDefaultMaterial(vertexColors = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : 0xb8c4d4,
    roughness: 0.48,
    metalness: 0.12,
    vertexColors,
    side: THREE.DoubleSide
  })
}

export function disposeThreeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) {
      mesh.geometry.dispose()
    }
    const mat = mesh.material
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat]
      for (const m of mats) {
        const std = m as unknown as Record<string, unknown>
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
          const tex = std[key] as THREE.Texture | undefined
          if (tex && typeof tex.dispose === 'function') {
            tex.dispose()
          }
        }
        m.dispose()
      }
    }
  })
}

function extractModelStats(root: THREE.Object3D, animations: THREE.AnimationClip[], ext: string): Partial<AssetExtraMeta> {
  let vertexCount = 0
  let triangleCount = 0
  let meshCount = 0
  const materialSet = new Set<THREE.Material>()

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      meshCount++
      const pos = mesh.geometry.attributes?.position
      if (pos) {
        vertexCount += pos.count
        if (mesh.geometry.index) {
          triangleCount += Math.floor(mesh.geometry.index.count / 3)
        } else {
          triangleCount += Math.floor(pos.count / 3)
        }
      }
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) materialSet.add(m)
      }
    }
  })

  const rawBox = new THREE.Box3().setFromObject(root)
  const rawSize = new THREE.Vector3()
  if (!rawBox.isEmpty()) {
    rawBox.getSize(rawSize)
  }

  return {
    format: ext.replace('.', '').toUpperCase(),
    vertexCount,
    triangleCount,
    meshCount,
    materialCount: materialSet.size,
    animationCount: animations.length,
    animationNames: animations.length > 0 ? animations.map((a, idx) => a.name || `Clip ${idx + 1}`) : undefined,
    boundsX: Number.isFinite(rawSize.x) ? Number(rawSize.x.toFixed(2)) : undefined,
    boundsY: Number.isFinite(rawSize.y) ? Number(rawSize.y.toFixed(2)) : undefined,
    boundsZ: Number.isFinite(rawSize.z) ? Number(rawSize.z.toFixed(2)) : undefined
  }
}

/**
 * Normalizes any loaded 3D model so it sits centered on y = 0 with max dimension = 3.0 units.
 */
function normalizeModelGroup(object: THREE.Object3D): { root: THREE.Group; radius: number; centerY: number } {
  const root = new THREE.Group()
  root.add(object)
  root.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(object)
  if (!box.isEmpty()) {
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    const maxDim = Math.max(size.x, size.y, size.z)
    const scale = maxDim > 1e-6 ? 3.0 / maxDim : 1

    object.scale.multiplyScalar(scale)
    object.updateMatrixWorld(true)

    const scaledBox = new THREE.Box3().setFromObject(object)
    const scaledCenter = new THREE.Vector3()
    scaledBox.getCenter(scaledCenter)

    // Center X and Z around origin; place bottom cleanly on y = 0
    object.position.x -= scaledCenter.x
    object.position.z -= scaledCenter.z
    object.position.y -= scaledBox.min.y
    object.updateMatrixWorld(true)
  }

  const finalBox = new THREE.Box3().setFromObject(root)
  const sphere = new THREE.Sphere()
  finalBox.getBoundingSphere(sphere)
  const finalSize = new THREE.Vector3()
  finalBox.getSize(finalSize)

  return {
    root,
    radius: Math.max(sphere.radius || 1.5, 0.5),
    centerY: Math.max(finalSize.y * 0.5, 0.25)
  }
}

function ensureReadableMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry && !mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals()
    }
    if (!mesh.material) {
      mesh.material = createStudioDefaultMaterial(Boolean(mesh.geometry?.attributes?.color))
    } else {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        m.side = THREE.DoubleSide
      }
    }
  })
}

async function tryLoadObjMtl(
  assetId: number,
  objText: string,
  fileName: string
): Promise<MTLLoader.MaterialCreator | null> {
  const baseUrl = `xiyun-media://asset-${assetId}/`
  const mtlMatch = /^\s*mtllib\s+(.+)$/im.exec(objText.slice(0, 16384))
  const candidates: string[] = []
  if (mtlMatch && mtlMatch[1]) {
    candidates.push(mtlMatch[1].trim())
  }
  const stem = fileName.replace(/\.obj$/i, '')
  if (stem && !candidates.includes(`${stem}.mtl`)) {
    candidates.push(`${stem}.mtl`)
  }

  for (const mtlName of candidates) {
    try {
      const mtlUrl = `${baseUrl}${encodeURIComponent(mtlName)}`
      const checkRes = await fetch(mtlUrl)
      if (!checkRes.ok) continue
      const mtlText = await checkRes.text()
      const mtlLoader = new MTLLoader()
      mtlLoader.setResourcePath(baseUrl)
      const materials = mtlLoader.parse(mtlText, baseUrl)
      materials.preload()
      return materials
    } catch {
      // Ignore missing or unreadable MTL
    }
  }
  return null
}

export async function loadThreeModel(
  assetId: number,
  fileName: string,
  ext: string
): Promise<LoadedModelResult> {
  const lowerExt = ext.toLowerCase()
  const modelUrl = getModelFileMediaUrl(assetId, fileName)
  const resourceBase = `xiyun-media://asset-${assetId}/`

  let loadedObject: THREE.Object3D
  let animations: THREE.AnimationClip[] = []

  if (lowerExt === '.obj') {
    const res = await fetch(modelUrl)
    if (!res.ok) throw new Error(`无法读取 OBJ 文件 (HTTP ${res.status})`)
    const objText = await res.text()
    const objLoader = new OBJLoader()
    const materials = await tryLoadObjMtl(assetId, objText, fileName)
    if (materials) {
      objLoader.setMaterials(materials)
    }
    loadedObject = objLoader.parse(objText)
  } else if (lowerExt === '.fbx') {
    const fbxLoader = new FBXLoader()
    fbxLoader.setResourcePath(resourceBase)
    const fbx = await fbxLoader.loadAsync(modelUrl)
    loadedObject = fbx
    animations = Array.isArray(fbx.animations) ? fbx.animations : []
  } else if (lowerExt === '.glb' || lowerExt === '.gltf') {
    const gltfLoader = new GLTFLoader()
    gltfLoader.setResourcePath(resourceBase)
    const gltf = await gltfLoader.loadAsync(modelUrl)
    loadedObject = gltf.scene
    animations = Array.isArray(gltf.animations) ? gltf.animations : []
  } else if (lowerExt === '.stl') {
    const stlLoader = new STLLoader()
    const geom = await stlLoader.loadAsync(modelUrl)
    geom.computeVertexNormals()
    loadedObject = new THREE.Mesh(geom, createStudioDefaultMaterial(Boolean(geom.attributes.color)))
  } else if (lowerExt === '.ply') {
    const plyLoader = new PLYLoader()
    const geom = await plyLoader.loadAsync(modelUrl)
    geom.computeVertexNormals()
    loadedObject = new THREE.Mesh(geom, createStudioDefaultMaterial(Boolean(geom.attributes.color)))
  } else {
    throw new Error(`暂不支持的 3D 模型格式：${ext}`)
  }

  ensureReadableMaterials(loadedObject)
  const stats = extractModelStats(loadedObject, animations, lowerExt)
  const { root, radius, centerY } = normalizeModelGroup(loadedObject)

  return { root, animations, stats, radius, centerY }
}

export function createStudioLights(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0xf8fafc, 0x334155, 1.05)
  hemi.position.set(0, 12, 0)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xffffff, 1.65)
  key.position.set(6, 10, 7)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0x93c5fd, 0.7)
  fill.position.set(-7, 5, -5)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xe0f2fe, 0.55)
  rim.position.set(0, 4, -9)
  scene.add(rim)
}

/**
 * Background sequential 3D thumbnail renderer using a single shared offscreen WebGLRenderer.
 * Renders missing 3D model thumbnails and persists them via IPC into `<thumbCacheDir>/models/<id>.webp`.
 */
function waitIdleSlot(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback
    if (typeof ric === 'function') {
      ric(() => setTimeout(resolve, 60), { timeout: 350 })
    } else {
      setTimeout(resolve, 110)
    }
  })
}

class ModelThumbQueue {
  private queue: MissingModelThumbItem[] = []
  private seenIds = new Set<number>()
  private failedIds = new Set<number>()
  private running = false
  private batchTotal = 0
  private batchCompleted = 0
  private renderer: THREE.WebGLRenderer | null = null
  private idleDisposeTimer: ReturnType<typeof setTimeout> | null = null
  private progressListeners = new Set<(p: ThumbProgress) => void>()

  onProgress(listener: (p: ThumbProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  private emitProgress(): void {
    const pending = this.queue.length + (this.running ? 1 : 0)
    const isActive = this.running || this.queue.length > 0
    const payload: ThumbProgress = isActive
      ? {
          running: true,
          completed: this.batchCompleted,
          total: Math.max(this.batchTotal, this.batchCompleted + pending),
          pending
        }
      : { running: false, completed: 0, total: 0, pending: 0 }
    if (!isActive) {
      this.batchTotal = 0
      this.batchCompleted = 0
    }
    for (const cb of this.progressListeners) cb(payload)
  }

  async enqueueMissingFromDb(): Promise<void> {
    try {
      const items = await window.api.assets.getMissingModelThumbs()
      this.enqueueMany(items)
    } catch {
      // ignore
    }
  }

  enqueueMany(items: MissingModelThumbItem[]): void {
    let added = false
    for (const item of items) {
      if (this.seenIds.has(item.id) || this.failedIds.has(item.id)) continue
      this.seenIds.add(item.id)
      this.queue.push(item)
      this.batchTotal++
      added = true
    }
    if (added) {
      this.emitProgress()
      if (!this.running) {
        this.pump().catch(() => undefined)
      }
    }
  }

  resetFailed(): void {
    this.failedIds.clear()
    this.seenIds.clear()
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (this.idleDisposeTimer) {
      clearTimeout(this.idleDisposeTimer)
      this.idleDisposeTimer = null
    }
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power'
      })
      this.renderer.setSize(480, 360, false)
      this.renderer.setPixelRatio(1)
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.08
    }
    return this.renderer
  }

  private scheduleDispose(): void {
    if (this.idleDisposeTimer) clearTimeout(this.idleDisposeTimer)
    this.idleDisposeTimer = setTimeout(() => {
      if (this.renderer && !this.running) {
        this.renderer.dispose()
        this.renderer = null
      }
      this.idleDisposeTimer = null
    }, 15000)
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    this.emitProgress()

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!
        try {
          await this.renderSingle(item)
        } catch {
          this.failedIds.add(item.id)
        } finally {
          this.seenIds.delete(item.id)
          this.batchCompleted++
          this.emitProgress()
        }
        // Low-priority idle yield so foreground 4K scrolling & preview stay silky smooth
        await waitIdleSlot()
      }
    } finally {
      this.running = false
      this.emitProgress()
      this.scheduleDispose()
    }
  }

  private async renderSingle(item: MissingModelThumbItem): Promise<void> {
    const renderer = this.ensureRenderer()
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1b202b)
    createStudioLights(scene)

    // Subtle studio floor grid
    const grid = new THREE.GridHelper(6, 12, 0x3b4860, 0x262e3d)
    grid.position.y = -0.002
    scene.add(grid)

    const loaded = await loadThreeModel(item.id, item.fileName, item.ext)
    try {
      scene.add(loaded.root)

      const camera = new THREE.PerspectiveCamera(40, 480 / 360, 0.05, 200)
      const dist = Math.max(loaded.radius * 2.55, 2.2)
      const azimuth = (38 * Math.PI) / 180
      const elevation = (24 * Math.PI) / 180
      camera.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * dist,
        loaded.centerY + Math.sin(elevation) * dist,
        Math.cos(azimuth) * Math.cos(elevation) * dist
      )
      camera.lookAt(0, loaded.centerY, 0)

      renderer.render(scene, camera)
      const dataUrl = renderer.domElement.toDataURL('image/png')
      await window.api.assets.saveRenderedThumb(item.id, dataUrl, loaded.stats)
    } finally {
      scene.remove(loaded.root)
      disposeThreeObject(loaded.root)
      grid.geometry.dispose()
      if (Array.isArray(grid.material)) {
        grid.material.forEach((m) => m.dispose())
      } else {
        grid.material.dispose()
      }
    }
  }
}

export const modelThumbQueue = new ModelThumbQueue()
