import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { IfcMeshPart, IfcWorkerResponse } from '../ifc/messages'

export type IfcElementInfo = {
  expressId: number
  guid: string
  name: string
  ifcType: string
  attributes: Record<string, string>
}

export type IfcLoadResult = { name: string; schema: string; elementCount: number }

export type ViewerCanvasHandle = {
  loadIfc(buffer: ArrayBuffer, fileName: string): void
  selectIfcElement(expressId: number): void
  resetView(): void
}

type ViewerCanvasProps = {
  onProgress: (completed: number, total: number) => void
  onElement: (element: IfcElementInfo) => void
  onComplete: (result: IfcLoadResult) => void
  onError: (message: string) => void
  onSelect: (element: IfcElementInfo | null) => void
}

type IfcElementGroup = THREE.Group & { userData: { ifcElement?: IfcElementInfo } }

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => material.dispose())
    }
  })
}

function makeGeometry(part: IfcMeshPart) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(part.indices, 1))
  geometry.applyMatrix4(new THREE.Matrix4().fromArray(part.matrix))
  geometry.computeBoundingSphere()
  return geometry
}

export const ViewerCanvas = forwardRef<ViewerCanvasHandle, ViewerCanvasProps>(
  function ViewerCanvas({ onProgress, onElement, onComplete, onError, onSelect }, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const apiRef = useRef<{
      scene: THREE.Scene
      camera: THREE.PerspectiveCamera
      controls: OrbitControls
      modelRoot: THREE.Group
      setSelected: (group: IfcElementGroup | null) => void
      elements: Map<number, IfcElementGroup>
      selectElement: (expressId: number) => void
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
        onSelect(null)

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
          const info: IfcElementInfo = {
            expressId: message.expressId,
            guid: message.guid,
            name: message.name,
            ifcType: message.ifcType,
            attributes: message.attributes,
          }
          onElement(info)
          group.name = message.name
          group.userData.ifcElement = info

          for (const part of message.parts) {
            const material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(part.color[0], part.color[1], part.color[2]),
              opacity: part.color[3],
              transparent: part.color[3] < 0.999,
              roughness: 0.85,
              metalness: 0,
              side: THREE.DoubleSide,
            })
            const mesh = new THREE.Mesh(makeGeometry(part), material)
            mesh.castShadow = false
            mesh.receiveShadow = true
            group.add(mesh)
          }
          api.elements.set(message.expressId, group)
          api.modelRoot.add(group)
        }
        worker.onerror = (event) => {
          worker.terminate()
          workerRef.current = null
          api.clearModel()
          onError(event.message || 'IFC 背景解析器發生錯誤。')
        }
        worker.postMessage({ type: 'load', fileName, buffer }, [buffer])
      },
      resetView() {
        apiRef.current?.fitModel()
      },
      selectIfcElement(expressId) {
        apiRef.current?.selectElement(expressId)
      },
    }), [onComplete, onElement, onError, onProgress, onSelect])

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
      const elements = new Map<number, IfcElementGroup>()
      let selectionBox: THREE.BoxHelper | null = null

      const setSelected = (group: IfcElementGroup | null) => {
        if (selectionBox) {
          scene.remove(selectionBox)
          disposeObject(selectionBox)
          selectionBox = null
        }
        if (group) {
          selectionBox = new THREE.BoxHelper(group, '#1684d4')
          selectionBox.material.depthTest = false
          selectionBox.material.transparent = true
          selectionBox.material.opacity = 0.95
          scene.add(selectionBox)
        }
        onSelect(group?.userData.ifcElement ?? null)
      }

      const clearModel = () => {
        setSelected(null)
        elements.clear()
        for (const child of [...modelRoot.children]) {
          modelRoot.remove(child)
          disposeObject(child)
        }
      }

      const fitModel = () => {
        const bounds = new THREE.Box3().setFromObject(modelRoot)
        if (bounds.isEmpty()) return
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        const largestDimension = Math.max(size.x, size.y, size.z, 0.1)
        const distance = largestDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) * 1.35
        camera.position.set(center.x + distance, center.y + distance * 0.72, center.z + distance)
        camera.near = Math.max(distance / 10_000, 0.01)
        camera.far = Math.max(distance * 100, 1_000)
        camera.updateProjectionMatrix()
        controls.target.copy(center)
        controls.update()
        selectionBox?.update()
      }

      const selectElement = (expressId: number) => {
        setSelected(elements.get(expressId) ?? null)
      }
      apiRef.current = {
        scene, camera, controls, modelRoot, setSelected, elements, selectElement, fitModel, clearModel,
      }

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      let pointerStart: { x: number; y: number } | null = null
      const onPointerDown = (event: PointerEvent) => {
        pointerStart = { x: event.clientX, y: event.clientY }
      }
      const onPointerUp = (event: PointerEvent) => {
        if (!pointerStart) return
        const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
        pointerStart = null
        if (moved > 4) return
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        )
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects(modelRoot.children, true)[0]
        if (!hit) {
          setSelected(null)
          return
        }
        let target: THREE.Object3D | null = hit.object
        while (target && !('ifcElement' in target.userData)) target = target.parent
        setSelected((target as IfcElementGroup | null) ?? null)
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
        workerRef.current?.terminate()
        workerRef.current = null
        window.cancelAnimationFrame(frameId)
        resizeObserver.disconnect()
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointerup', onPointerUp)
        controls.dispose()
        disposeObject(scene)
        renderer.dispose()
        renderer.domElement.remove()
        apiRef.current = null
      }
    }, [onSelect])

    return <div className="viewer-canvas" ref={hostRef} aria-label="3D 模型檢視畫布" />
  },
)
