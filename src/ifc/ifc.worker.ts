import { IfcAPI } from 'web-ifc'
import wasmUrl from 'web-ifc/web-ifc.wasm?url'
import type { FlatMesh } from 'web-ifc'
import type { IfcMeshPart, IfcWorkerRequest } from './messages'

const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<IfcWorkerRequest>) => void) | null
}

workerScope.onmessage = async (event) => {
  if (event.data.type !== 'load') return

  const api = new IfcAPI()
  let modelId: number | undefined

  try {
    await api.Init(() => wasmUrl, true)
    modelId = api.OpenModel(new Uint8Array(event.data.buffer), {
      COORDINATE_TO_ORIGIN: true,
    })
    if (modelId < 0) throw new Error('IFC 解析器無法開啟這個檔案。請確認檔案完整且格式有效。')

    const schema = api.GetModelSchema(modelId)
    let elementCount = 0

    api.StreamAllMeshes(modelId, (flatMesh: FlatMesh, completed: number, total: number) => {
      const parts: IfcMeshPart[] = []
      const transferables: Transferable[] = []

      try {
        for (let index = 0; index < flatMesh.geometries.size(); index += 1) {
          const placed = flatMesh.geometries.get(index)
          const geometry = api.GetGeometry(modelId!, placed.geometryExpressID)
          try {
            const source = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
            // web-ifc 0.0.78 packs each vertex as position.xyz followed by normal.xyz.
            if (source.length === 0 || source.length % 6 !== 0) {
              throw new Error(`IFC 元件 #${flatMesh.expressID} 的頂點資料格式無效（${source.length} 個數值）。`)
            }
            const vertexCount = source.length / 6
            const positions = new Float32Array(vertexCount * 3)
            const normals = new Float32Array(vertexCount * 3)
            for (let vertex = 0; vertex < vertexCount; vertex += 1) {
              const sourceOffset = vertex * 6
              const targetOffset = vertex * 3
              positions[targetOffset] = source[sourceOffset]
              positions[targetOffset + 1] = source[sourceOffset + 1]
              positions[targetOffset + 2] = source[sourceOffset + 2]
              normals[targetOffset] = source[sourceOffset + 3]
              normals[targetOffset + 1] = source[sourceOffset + 4]
              normals[targetOffset + 2] = source[sourceOffset + 5]
            }
            if (positions.some((value) => !Number.isFinite(value))) {
              throw new Error(`IFC 元件 #${flatMesh.expressID} 含有無效的頂點座標。`)
            }
            const indices = new Uint32Array(
              api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize()),
            )
            if (indices.length === 0 || indices.length % 3 !== 0) {
              throw new Error(`IFC 元件 #${flatMesh.expressID} 的索引資料不是有效的三角形網格。`)
            }
            for (const vertexIndex of indices) {
              if (vertexIndex >= vertexCount) {
                throw new Error(`IFC 元件 #${flatMesh.expressID} 的索引超出頂點範圍。`)
              }
            }
            const matrix = [...placed.flatTransformation]
            if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
              throw new Error(`IFC 元件 #${flatMesh.expressID} 的座標變換矩陣無效。`)
            }
            const color: [number, number, number, number] = [
              placed.color.x, placed.color.y, placed.color.z, placed.color.w,
            ]
            if (color.some((value) => !Number.isFinite(value))) {
              throw new Error(`IFC 元件 #${flatMesh.expressID} 的材質顏色資料無效。`)
            }
            const part: IfcMeshPart = { positions, normals, indices, matrix, color }
            parts.push(part)
            transferables.push(positions.buffer, normals.buffer, indices.buffer)
          } finally {
            geometry.delete()
          }
        }

        const line = api.GetLine(modelId!, flatMesh.expressID)
        const nameValue = line?.Name?.value ?? line?.Name
        const guidValue = api.GetGuidFromExpressId(modelId!, flatMesh.expressID)
        const ifcType = api.GetNameFromTypeCode(api.GetLineType(modelId!, flatMesh.expressID))
        const displayName = typeof nameValue === 'string' ? nameValue : `IFC 元件 #${flatMesh.expressID}`
        const attributes: Record<string, string> = {}
        for (const key of ['Name', 'Description', 'ObjectType', 'Tag', 'GlobalId']) {
          const value = line?.[key]?.value ?? line?.[key]
          if (value !== undefined && value !== null && String(value).trim()) {
            attributes[key] = String(value)
          }
        }

        workerScope.postMessage({
          type: 'element',
          expressId: flatMesh.expressID,
          guid: String(guidValue ?? flatMesh.expressID),
          name: displayName,
          ifcType,
          attributes,
          parts,
        }, transferables)
        elementCount += 1
        if (completed % 10 === 0 || completed === total) {
          workerScope.postMessage({ type: 'progress', completed, total })
        }
      } catch (error) {
        throw new Error(
          `解析 IFC 元件 #${flatMesh.expressID} 失敗：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
    })

    workerScope.postMessage({ type: 'complete', schema, elementCount })
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'IFC 模型載入時發生未知錯誤。',
    })
  } finally {
    if (modelId !== undefined && modelId >= 0 && api.IsModelOpen(modelId)) {
      api.CloseModel(modelId)
    }
  }
}
