import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { TransformControls, type TransformControlsMode } from 'three/addons/controls/TransformControls.js'
import type { IfcMeshPart, IfcWorkerResponse } from '../ifc/messages'
import { findGltfResourcePath, getGltfFilePath } from '../gltf/resources'
import type { IfcElementTransform, TransformSnapshot } from '../project/project'
import type { FileWithPath } from '../project/project'

export type IfcElementInfo = {
  expressId: number
  guid: string
  name: string
  ifcType: string
  attributes: Record<string, string>
}

export type IfcLoadResult = { name: string; schema: string; elementCount: number }

export type ImportedModelInfo = {
  id: string
  name: string
  fileName: string
  format: 'GLB' | 'GLTF'
}

export type ViewerSelection =
  | { kind: 'ifc'; element: IfcElementInfo }
  | { kind: 'model'; model: ImportedModelInfo }
  | null

export type ViewerCanvasHandle = {
  loadIfc(buffer: ArrayBuffer, fileName: string): void
  loadGltf(files: FileWithPath[], restore?: { info: ImportedModelInfo; transform: TransformSnapshot }): Promise<ImportedModelInfo>
  selectIfcElement(expressId: number): void
  selectModel(id: string): boolean
  setTransformMode(mode: TransformControlsMode | null): void
  deleteSelectedModel(): void
  clearImportedModels(): void
  clearIfc(): void
  getIfcElementTransforms(): IfcElementTransform[]
  applyIfcElementTransforms(transforms: IfcElementTransform[]): { applied: number; missing: number }
  getImportedModelSnapshots(): Array<{ info: ImportedModelInfo; files: FileWithPath[]; transform: TransformSnapshot }>
  resetView(): void
}

type ViewerCanvasProps = {
  onProgress: (completed: number, total: number) => void
  onElement: (element: IfcElementInfo) => void
  onModelsChange: (models: ImportedModelInfo[]) => void
  onComplete: (result: IfcLoadResult) => void
  onError: (message: string) => void
  onSelect: (selection: ViewerSelection) => void
}

type ImportedModelRoot = THREE.Group & { userData: { importedModel?: ImportedModelInfo } }
type IfcElementGroup = THREE.Group & { userData: { ifcElement?: IfcElementInfo } }

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      geometries.add(child.geometry)
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
      childMaterials.forEach((material) => materials.add(material))
    }
  })
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value)
    }
    material.dispose()
  }
  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) {
    const image = texture.source.data
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
    texture.dispose()
  }
}

function parseGltf(loader: GLTFLoader, data: ArrayBuffer, resourcePath: string) {
  return new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>((resolve, reject) => {
    loader.parse(data, resourcePath, resolve, reject)
  })
}

function makeGeometry(part: IfcMeshPart) {
  const vertexCount = part.positions.length / 3
  if (
    vertexCount < 1 || !Number.isInteger(vertexCount) ||
    part.normals.length !== part.positions.length ||
    part.indices.length < 3 || part.indices.length % 3 !== 0 ||
    part.matrix.length !== 16
  ) {
    throw new Error('IFC 幾何資料長度不一致，無法建立 3D 網格。')
  }
  for (const index of part.indices) {
    if (index >= vertexCount) throw new Error('IFC 幾何索引超出頂點範圍。')
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(part.indices, 1))
  geometry.applyMatrix4(new THREE.Matrix4().fromArray(part.matrix))
  geometry.computeBoundingSphere()
  return geometry
}

export const ViewerCanvas = forwardRef<ViewerCanvasHandle, ViewerCanvasProps>(
  function ViewerCanvas({ onProgress, onElement, onModelsChange, onComplete, onError, onSelect }, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const apiRef = useRef<{
      scene: THREE.Scene
      camera: THREE.PerspectiveCamera
      controls: OrbitControls
      modelRoot: THREE.Group
      assetRoot: THREE.Group
      setSelected: (object: THREE.Object3D | null) => void
      elements: Map<number, IfcElementGroup>
      importedModels: Map<string, { info: ImportedModelInfo; root: ImportedModelRoot; files: FileWithPath[] }>
      selectElement: (expressId: number) => void
      selectModel: (id: string) => boolean
      setTransformMode: (mode: TransformControlsMode | null) => void
      deleteSelectedModel: () => void
      clearImportedModels: () => void
      getIfcElementTransforms: () => IfcElementTransform[]
      applyIfcElementTransforms: (transforms: IfcElementTransform[]) => { applied: number; missing: number }
      getImportedModelSnapshots: () => Array<{ info: ImportedModelInfo; files: FileWithPath[]; transform: TransformSnapshot }>
      loadGltf: (files: FileWithPath[], restore?: { info: ImportedModelInfo; transform: TransformSnapshot }) => Promise<ImportedModelInfo>
      fitModel: () => void
      clearModel: () => void
    } | null>(null)
    const workerRef = useRef<Worker | null>(null)

    useImperativeHandle(ref, () => ({
      loadIfc(buffer, fileName) {
        const api = apiRef.current
        if (!api) {
          onError('3D 場景尚未準備完成，請稍後再試。')
          return
        }
        workerRef.current?.terminate()
        api.clearModel()
        api.setSelected(null)

        const worker = new Worker(new URL('../ifc/ifc.worker.ts', import.meta.url), {
          type: 'module',
        })
        workerRef.current = worker
        worker.onmessage = (event: MessageEvent<IfcWorkerResponse>) => {
          const message = event.data
          if (message.type === 'progress') {
            onProgress(message.completed, message.total)
            return
          }
          if (message.type === 'error') {
            worker.terminate()
            workerRef.current = null
            api.clearModel()
            onError(message.message)
            return
          }
          if (message.type === 'complete') {
            worker.terminate()
            workerRef.current = null
            api.fitModel()
            onComplete({ name: fileName, schema: message.schema, elementCount: message.elementCount })
            return
          }

          const group = new THREE.Group() as IfcElementGroup
          try {
            const info: IfcElementInfo = {
              expressId: message.expressId,
              guid: message.guid,
              name: message.name,
              ifcType: message.ifcType,
              attributes: message.attributes,
            }
            group.name = message.name
            group.userData.ifcElement = info

            for (const part of message.parts) {
              const geometry = makeGeometry(part)
              const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(part.color[0], part.color[1], part.color[2]),
                opacity: part.color[3],
                transparent: part.color[3] < 0.999,
                roughness: 0.85,
                metalness: 0,
                side: THREE.DoubleSide,
              })
              const mesh = new THREE.Mesh(geometry, material)
              mesh.castShadow = false
              mesh.receiveShadow = true
              group.add(mesh)
            }
            onElement(info)
            api.elements.set(message.expressId, group)
            api.modelRoot.add(group)
          } catch (error) {
            disposeObject(group)
            worker.terminate()
            workerRef.current = null
            api.clearModel()
            onError(error instanceof Error ? error.message : 'IFC 幾何資料無法顯示。')
          }
        }
        worker.onerror = (event) => {
          worker.terminate()
          workerRef.current = null
          api.clearModel()
          onError(event.message || 'IFC 背景解析器發生錯誤。')
        }
        worker.onmessageerror = () => {
          worker.terminate()
          workerRef.current = null
          api.clearModel()
          onError('IFC 背景解析器傳回了無法讀取的資料，請重試或檢查檔案。')
        }
        worker.postMessage({ type: 'load', fileName, buffer }, [buffer])
      },
      loadGltf(files, restore) {
        const api = apiRef.current
        if (!api) return Promise.reject(new Error('3D 場景尚未準備完成，請稍後再試。'))
        return api.loadGltf(files, restore)
      },
      resetView() {
        apiRef.current?.fitModel()
      },
      selectIfcElement(expressId) {
        apiRef.current?.selectElement(expressId)
      },
      selectModel(id) {
        return apiRef.current?.selectModel(id) ?? false
      },
      setTransformMode(mode) {
        apiRef.current?.setTransformMode(mode)
      },
      deleteSelectedModel() {
        apiRef.current?.deleteSelectedModel()
      },
      clearImportedModels() {
        apiRef.current?.clearImportedModels()
      },
      clearIfc() {
        const api = apiRef.current
        if (!api) return
        workerRef.current?.terminate()
        workerRef.current = null
        api.clearModel()
        api.setSelected(null)
      },
      getIfcElementTransforms() {
        return apiRef.current?.getIfcElementTransforms() ?? []
      },
      applyIfcElementTransforms(transforms) {
        return apiRef.current?.applyIfcElementTransforms(transforms) ?? { applied: 0, missing: transforms.length }
      },
      getImportedModelSnapshots() {
        return apiRef.current?.getImportedModelSnapshots() ?? []
      },
    }), [onComplete, onElement, onError, onProgress])

    useEffect(() => {
      const host = hostRef.current
      if (!host) return

      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#edf1f4')
      const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1_000_000)
      camera.position.set(26, 22, 30)

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setSize(host.clientWidth, host.clientHeight)
      host.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 0, 0)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.screenSpacePanning = true
      controls.update()

      const transformControls = new TransformControls(camera, renderer.domElement)
      scene.add(transformControls.getHelper())
      transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value
      })

      const grid = new THREE.GridHelper(100, 50, '#aab7c2', '#d2dbe2')
      grid.position.y = -0.015
      scene.add(grid)
      scene.add(new THREE.HemisphereLight('#ffffff', '#aab6c0', 2.1))
      const keyLight = new THREE.DirectionalLight('#ffffff', 2.4)
      keyLight.position.set(20, 35, 15)
      scene.add(keyLight)

      const modelRoot = new THREE.Group()
      modelRoot.name = 'IFC model'
      scene.add(modelRoot)
      const assetRoot = new THREE.Group()
      assetRoot.name = 'Imported GLTF models'
      scene.add(assetRoot)
      const elements = new Map<number, IfcElementGroup>()
      const importedModels = new Map<string, { info: ImportedModelInfo; root: ImportedModelRoot; files: FileWithPath[] }>()
      let selectionBox: THREE.BoxHelper | null = null
      let selectedObject: THREE.Object3D | null = null
      let activeTransformMode: TransformControlsMode | null = null
      let transformPointerActive = false
      let isDisposed = false

      const setSelected = (object: THREE.Object3D | null) => {
        if (selectionBox) {
          scene.remove(selectionBox)
          disposeObject(selectionBox)
          selectionBox = null
        }
        selectedObject = object
        if (object) {
          selectionBox = new THREE.BoxHelper(object, '#1684d4')
          selectionBox.material.depthTest = false
          selectionBox.material.transparent = true
          selectionBox.material.opacity = 0.95
          scene.add(selectionBox)
        }
        const ifcElement = object?.userData.ifcElement as IfcElementInfo | undefined
        const importedModel = object?.userData.importedModel as ImportedModelInfo | undefined
        onSelect(ifcElement ? { kind: 'ifc', element: ifcElement } : importedModel ? { kind: 'model', model: importedModel } : null)
        if ((importedModel || ifcElement) && activeTransformMode && object) {
          transformControls.setMode(activeTransformMode)
          transformControls.attach(object)
        } else {
          transformControls.detach()
        }
      }

      const clearModel = () => {
        if (selectedObject?.userData.ifcElement) setSelected(null)
        elements.clear()
        for (const child of [...modelRoot.children]) {
          modelRoot.remove(child)
          disposeObject(child)
        }
      }

      const fitModel = () => {
        const bounds = new THREE.Box3().setFromObject(modelRoot).union(new THREE.Box3().setFromObject(assetRoot))
        fitBounds(bounds)
      }

      const fitObject = (object: THREE.Object3D) => {
        fitBounds(new THREE.Box3().setFromObject(object))
      }

      const fitBounds = (bounds: THREE.Box3) => {
        if (bounds.isEmpty()) return
        const center = bounds.getCenter(new THREE.Vector3())
        const sphere = bounds.getBoundingSphere(new THREE.Sphere())
        const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5)
        const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(camera.aspect, 0.01))
        const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov)
        const radius = Math.max(sphere.radius, 0.05)
        const distance = radius / Math.sin(limitingHalfFov) * 1.2
        const viewDirection = new THREE.Vector3(1, 0.72, 1).normalize()
        camera.position.copy(center).addScaledVector(viewDirection, distance)
        // A tight depth range preserves depth-buffer precision on building-scale models.
        camera.near = Math.max(distance - radius * 1.5, 0.01)
        camera.far = distance + radius * 2
        camera.updateProjectionMatrix()
        controls.target.copy(center)
        controls.update()
        selectionBox?.update()
      }

      const selectElement = (expressId: number) => {
        const element = elements.get(expressId) ?? null
        setSelected(element)
        if (element) fitObject(element)
      }

      const selectModel = (id: string) => {
        if (!id) {
          setSelected(null)
          return true
        }
        const model = importedModels.get(id)
        if (!model) return false
        setSelected(model.root)
        fitObject(model.root)
        return true
      }

      const setTransformMode = (mode: TransformControlsMode | null) => {
        activeTransformMode = mode
        const isEditableObject = Boolean(selectedObject?.userData.importedModel || selectedObject?.userData.ifcElement)
        if (mode && isEditableObject && selectedObject) {
          transformControls.setMode(mode)
          transformControls.attach(selectedObject)
        } else {
          transformControls.detach()
        }
      }

      const deleteSelectedModel = () => {
        const info = selectedObject?.userData.importedModel as ImportedModelInfo | undefined
        if (!info) return
        const model = importedModels.get(info.id)
        if (!model) return
        transformControls.detach()
        setSelected(null)
        assetRoot.remove(model.root)
        importedModels.delete(info.id)
        disposeObject(model.root)
        onModelsChange([...importedModels.values()].map(({ info: item }) => item))
      }

      const clearImportedModels = () => {
        if (selectedObject?.userData.importedModel) setSelected(null)
        for (const model of importedModels.values()) {
          assetRoot.remove(model.root)
          disposeObject(model.root)
        }
        importedModels.clear()
        onModelsChange([])
      }

      const readTransform = (object: THREE.Object3D): TransformSnapshot => ({
        position: [object.position.x, object.position.y, object.position.z],
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: [object.scale.x, object.scale.y, object.scale.z],
      })

      const getIfcElementTransforms = (): IfcElementTransform[] => [...elements.values()].map((object) => {
        const info = object.userData.ifcElement!
        return { expressId: info.expressId, guid: info.guid, transform: readTransform(object) }
      })

      const applyIfcElementTransforms = (transforms: IfcElementTransform[]) => {
        const byGuid = new Map([...elements.values()].map((object) => [object.userData.ifcElement!.guid, object]))
        let applied = 0
        let missing = 0
        for (const saved of transforms) {
          const object = saved.guid ? byGuid.get(saved.guid) : elements.get(saved.expressId)
          if (!object) {
            missing += 1
            continue
          }
          object.position.fromArray(saved.transform.position)
          object.rotation.set(...saved.transform.rotation)
          object.scale.fromArray(saved.transform.scale)
          object.updateMatrixWorld(true)
          applied += 1
        }
        selectionBox?.update()
        return { applied, missing }
      }

      const getImportedModelSnapshots = () => [...importedModels.values()].map(({ info, root, files }) => ({
        info,
        files,
        transform: readTransform(root),
      }))

      const loadGltf = async (files: FileWithPath[], restore?: { info: ImportedModelInfo; transform: TransformSnapshot }) => {
        const modelFiles = files.filter((file) => /\.(glb|gltf)$/i.test(file.name))
        if (modelFiles.length !== 1) {
          throw new Error(modelFiles.length === 0
            ? '請選取一個 .glb 或 .gltf 模型檔。'
            : '一次請選取一個 .glb 或 .gltf 模型檔；相依檔可和模型一起多選。')
        }
        const mainFile = modelFiles[0]
        const paths = files.map(getGltfFilePath)
        if (new Set(paths).size !== paths.length) throw new Error('選取的 GLTF 資源路徑重複，請改用資料夾匯入。')

        const objectUrls = new Map<string, string>()
        try {
          files.forEach((file, index) => objectUrls.set(paths[index], URL.createObjectURL(file)))
          const manager = new THREE.LoadingManager()
          manager.setURLModifier((requestedUrl) => {
            if (/^(?:data:|blob:|https?:\/\/)/i.test(requestedUrl)) return requestedUrl
            const resourcePath = findGltfResourcePath(requestedUrl, [...objectUrls.keys()])
            const objectUrl = resourcePath ? objectUrls.get(resourcePath) : undefined
            if (!objectUrl) {
              throw new Error(`找不到 GLTF 外部資源「${requestedUrl}」。請同時選取 .bin／貼圖檔，或改用「GLTF 資料夾」匯入。`)
            }
            return objectUrl
          })
          const loader = new GLTFLoader(manager)
          const filePath = getGltfFilePath(mainFile)
          const directory = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : ''
          const gltf = await parseGltf(loader, await mainFile.arrayBuffer(), directory)
          if (isDisposed || !apiRef.current) {
            disposeObject(gltf.scene)
            throw new Error('檢視器已關閉，模型載入已取消。')
          }

          const info: ImportedModelInfo = restore?.info ?? {
            id: crypto.randomUUID(),
            name: mainFile.name.replace(/\.(glb|gltf)$/i, ''),
            fileName: mainFile.name,
            format: mainFile.name.toLowerCase().endsWith('.glb') ? 'GLB' : 'GLTF',
          }
          const root = new THREE.Group() as ImportedModelRoot
          root.name = info.name
          root.userData.importedModel = info
          if (restore) {
            root.position.fromArray(restore.transform.position)
            root.rotation.set(...restore.transform.rotation)
            root.scale.fromArray(restore.transform.scale)
          }
          root.add(gltf.scene)
          assetRoot.add(root)
          importedModels.set(info.id, { info, root, files })
          setSelected(root)
          fitObject(root)
          onModelsChange([...importedModels.values()].map(({ info: item }) => item))
          return info
        } finally {
          for (const url of objectUrls.values()) URL.revokeObjectURL(url)
        }
      }

      const viewerApi = {
        scene, camera, controls, modelRoot, assetRoot, setSelected, elements, importedModels,
        selectElement, selectModel, setTransformMode, deleteSelectedModel, clearImportedModels,
        getIfcElementTransforms, applyIfcElementTransforms, getImportedModelSnapshots,
        loadGltf, fitModel, clearModel,
      }
      apiRef.current = viewerApi

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const onTransformMouseDown = () => { transformPointerActive = true }
      const onTransformMouseUp = () => { window.setTimeout(() => { transformPointerActive = false }, 0) }
      transformControls.addEventListener('mouseDown', onTransformMouseDown)
      transformControls.addEventListener('mouseUp', onTransformMouseUp)
      let pointerStart: { x: number; y: number } | null = null
      const onPointerDown = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(pointer, camera)
        pointerStart = { x: event.clientX, y: event.clientY }
      }
      const onPointerUp = (event: PointerEvent) => {
        if (!pointerStart) return
        if (transformPointerActive || transformControls.axis !== null) {
          pointerStart = null
          return
        }
        const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
        pointerStart = null
        if (moved > 4) return
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        )
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects([...modelRoot.children, ...assetRoot.children], true)[0]
        if (!hit) {
          setSelected(null)
          return
        }
        let target: THREE.Object3D | null = hit.object
        while (target && !('ifcElement' in target.userData) && !('importedModel' in target.userData)) target = target.parent
        setSelected(target)
      }
      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('pointerup', onPointerUp)

      let frameId = 0
      const render = () => {
        frameId = window.requestAnimationFrame(render)
        controls.update()
        selectionBox?.update()
        renderer.render(scene, camera)
      }
      render()

      const resizeObserver = new ResizeObserver(() => {
        const width = host.clientWidth
        const height = host.clientHeight
        if (!width || !height) return
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height)
      })
      resizeObserver.observe(host)

      return () => {
        isDisposed = true
        workerRef.current?.terminate()
        workerRef.current = null
        window.cancelAnimationFrame(frameId)
        resizeObserver.disconnect()
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointerup', onPointerUp)
        transformControls.removeEventListener('mouseDown', onTransformMouseDown)
        transformControls.removeEventListener('mouseUp', onTransformMouseUp)
        transformControls.dispose()
        controls.dispose()
        disposeObject(scene)
        renderer.dispose()
        renderer.domElement.remove()
        apiRef.current = null
      }
    }, [onModelsChange, onSelect])

    return <div className="viewer-canvas" ref={hostRef} aria-label="3D 模型檢視畫布" />
  },
)
