import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { IfcAPI } from 'web-ifc'

const fixturePath = resolve('tests/Building-Architecture.ifc')
const bytes = await readFile(fixturePath)
const api = new IfcAPI()
let modelId
let elements = 0
let geometryParts = 0

try {
  await api.Init(undefined, true)
  modelId = api.OpenModel(new Uint8Array(bytes), { COORDINATE_TO_ORIGIN: true })
  assert.ok(modelId >= 0, 'web-ifc should open the IFC fixture')
  assert.equal(api.GetModelSchema(modelId), 'IFC4')

  api.StreamAllMeshes(modelId, (flatMesh) => {
    elements += 1
    assert.equal(typeof flatMesh.delete, 'undefined', 'stream callback does not provide a delete method in web-ifc 0.0.78')
    for (let index = 0; index < flatMesh.geometries.size(); index += 1) {
      const placed = flatMesh.geometries.get(index)
      const geometry = api.GetGeometry(modelId, placed.geometryExpressID)
      try {
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
        const vertexCount = vertices.length / 6
        assert.ok(vertexCount > 0 && Number.isInteger(vertexCount), 'vertex data should contain position/normal tuples')
        assert.ok(indices.length >= 3 && indices.length % 3 === 0, 'index data should contain triangles')
        assert.ok([...indices].every((value) => value < vertexCount), 'indices should reference available vertices')
        assert.equal(placed.flatTransformation.length, 16, 'placement should be a 4x4 matrix')
        assert.ok([...vertices].every(Number.isFinite), 'vertex data should be finite')
        geometryParts += 1
      } finally {
        geometry.delete()
      }
    }
  })

  assert.ok(elements > 0, 'fixture should contain streamed IFC elements')
  assert.ok(geometryParts > 0, 'fixture should contain renderable geometry')
  console.log(`IFC smoke passed: IFC4, ${elements} elements, ${geometryParts} geometry parts.`)
} finally {
  if (modelId !== undefined && modelId >= 0 && api.IsModelOpen(modelId)) api.CloseModel(modelId)
}
