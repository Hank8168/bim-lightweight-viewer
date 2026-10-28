import assert from 'node:assert/strict'
import test from 'node:test'
import { findGltfResourcePath, getGltfFilePath, normalizeGltfResourcePath } from '../src/gltf/resources.ts'

test('normalizes relative paths, separators and URL encoding', () => {
  assert.equal(normalizeGltfResourcePath('./models/../textures/wood%20grain.png'), 'textures/wood grain.png')
  assert.equal(getGltfFilePath({ name: 'tree.bin', webkitRelativePath: 'asset/tree/tree.bin' }), 'asset/tree/tree.bin')
})

test('resolves an exact external resource path', () => {
  assert.equal(findGltfResourcePath('asset/textures/leaf.png', ['asset/tree.gltf', 'asset/textures/leaf.png']), 'asset/textures/leaf.png')
})

test('allows a unique basename when the file picker omits directory paths', () => {
  assert.equal(findGltfResourcePath('textures/leaf.png', ['tree.gltf', 'leaf.png']), 'leaf.png')
})

test('does not guess between duplicate resource basenames', () => {
  assert.equal(findGltfResourcePath('textures/leaf.png', ['a/leaf.png', 'b/leaf.png']), undefined)
})
