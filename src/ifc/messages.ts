export type IfcMeshPart = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  matrix: number[]
  color: [number, number, number, number]
}

export type IfcWorkerRequest = {
  type: 'load'
  fileName: string
  buffer: ArrayBuffer
}

export type IfcWorkerResponse =
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'element'
      expressId: number
      guid: string
      name: string
      ifcType: string
      attributes: Record<string, string>
      parts: IfcMeshPart[]
    }
  | { type: 'complete'; schema: string; elementCount: number }
  | { type: 'error'; message: string }

