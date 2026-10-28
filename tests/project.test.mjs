import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProjectDocument, resolveProjectResources } from '../src/project/project.ts'

const digest = '0'.repeat(64)
const resource = { path: 'model.ifc', fileName: 'model.ifc', size: 12, sha256: digest }
const valid = {
  format: 'bim-lightweight-viewer-project',
  version: 1,
  projectName: 'Example',
  ifc: { resource, schema: 'IFC4', elements: [{ expressId: 7, guid: 'guid-7', transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } }] },
  models: [{ id: 'model-1', name: 'Tree', fileName: 'tree.glb', format: 'GLB', mainResourcePath: 'tree.glb', resources: [{ ...resource, path: 'tree.glb', fileName: 'tree.glb' }], transform: { position: [0, 0, 0], rotation: [0, 1, 0], scale: [2, 2, 2] } }],
}

test('validates and accepts a complete project document', () => {
  assert.deepEqual(parseProjectDocument(JSON.stringify(valid)), valid)
})

test('rejects malformed JSON, wrong version and invalid transforms', () => {
  assert.throws(() => parseProjectDocument('{'), /不是有效的 JSON/)
  assert.throws(() => parseProjectDocument(JSON.stringify({ ...valid, version: 9 })), /版本不支援/)
  assert.throws(() => parseProjectDocument(JSON.stringify({ ...valid, models: [{ ...valid.models[0], transform: { position: [NaN, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] })), /無效的 GLB／GLTF/)
})

test('rejects a model when its primary geometry resource is missing', () => {
  assert.throws(() => parseProjectDocument(JSON.stringify({ ...valid, models: [{ ...valid.models[0], resources: [] }] })), /無效的 GLB／GLTF/)
})

test('requires the selected original model bytes to match the saved hash', async () => {
  const bytes = new TextEncoder().encode('IFC fixture!')
  const file = new File([bytes], 'model.ifc')
  const actualHash = await crypto.subtle.digest('SHA-256', bytes)
  const sha256 = Array.from(new Uint8Array(actualHash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const document = parseProjectDocument(JSON.stringify({ ...valid, ifc: { ...valid.ifc, resource: { ...resource, size: file.size, sha256 } }, models: [] }))
  const match = await resolveProjectResources(document, [file])
  assert.equal(match.missing.length, 0)
  assert.equal(match.resolved.get(document.ifc.resource), file)
  const mismatch = await resolveProjectResources(document, [new File(['different data'], 'model.ifc')])
  assert.equal(mismatch.missing.length, 1)
})
