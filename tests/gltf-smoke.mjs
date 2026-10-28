import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve('tests/assets/BasePalmTree01.glb')
const buffer = await readFile(path)
assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'downloaded sample should have the GLB magic header')
assert.equal(buffer.readUInt32LE(4), 2, 'downloaded sample should use GLB 2.0')
assert.equal(buffer.readUInt32LE(8), buffer.length, 'GLB declared length should match the downloaded file')

const jsonLength = buffer.readUInt32LE(12)
const jsonType = buffer.readUInt32LE(16)
assert.equal(jsonType, 0x4e4f534a, 'first GLB chunk should contain glTF JSON')
const document = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim())
assert.ok(document.meshes?.length, 'sample should contain mesh geometry')
assert.ok(document.nodes?.length, 'sample should contain scene nodes')
assert.ok(document.buffers?.some((item) => !item.uri), 'GLB geometry buffer should be embedded')
console.log(`GLB smoke passed: ${document.meshes.length} meshes, ${document.nodes.length} nodes, ${buffer.length} bytes.`)
