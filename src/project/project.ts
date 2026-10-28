import { getGltfFilePath, normalizeGltfResourcePath, type GltfResourceFile } from '../gltf/resources.ts'

export type TransformSnapshot = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export type ProjectResource = {
  path: string
  fileName: string
  size: number
  sha256: string
}

export type IfcElementTransform = {
  expressId: number
  guid: string
  transform: TransformSnapshot
}

export type ProjectModel = {
  id: string
  name: string
  fileName: string
  format: 'GLB' | 'GLTF'
  mainResourcePath: string
  resources: ProjectResource[]
  transform: TransformSnapshot
}

export type ProjectDocument = {
  format: 'bim-lightweight-viewer-project'
  version: 1
  projectName: string
  ifc: null | {
    resource: ProjectResource
    schema: string
    elements: IfcElementTransform[]
  }
  models: ProjectModel[]
}

export type FileWithPath = File & Partial<Pick<GltfResourceFile, 'webkitRelativePath'>>

const MAX_PROJECT_JSON_BYTES = 50 * 1024 * 1024
const HASH_PATTERN = /^[a-f0-9]{64}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown, maxLength = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9
}

function isTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isNumber)
}

function isTransform(value: unknown): value is TransformSnapshot {
  return isRecord(value) && isTriple(value.position) && isTriple(value.rotation) && isTriple(value.scale)
}

function isResource(value: unknown): value is ProjectResource {
  return isRecord(value) && isString(value.path) && isString(value.fileName) &&
    typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0 &&
    typeof value.sha256 === 'string' && HASH_PATTERN.test(value.sha256)
}

export function parseProjectDocument(text: string): ProjectDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_JSON_BYTES) {
    throw new Error('專案 JSON 超過 50 MB，已停止載入。')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('專案檔不是有效的 JSON。')
  }
  if (!isRecord(value) || value.format !== 'bim-lightweight-viewer-project' || value.version !== 1 ||
    !isString(value.projectName, 256) || !Array.isArray(value.models)) {
    throw new Error('專案格式或版本不支援，請選擇 BIM Lightweight Viewer 專案檔。')
  }
  if (value.ifc !== null) {
    if (!isRecord(value.ifc) || !isResource(value.ifc.resource) || !isString(value.ifc.schema, 256) || !Array.isArray(value.ifc.elements)) {
      throw new Error('專案中的 IFC 資訊不完整或格式錯誤。')
    }
    for (const element of value.ifc.elements) {
      if (!isRecord(element) || !Number.isSafeInteger(element.expressId) || Number(element.expressId) < 0 ||
        typeof element.guid !== 'string' || element.guid.length > 256 || !isTransform(element.transform)) {
        throw new Error('專案包含無效的 IFC 元件變換資料。')
      }
    }
  }
  for (const model of value.models) {
    if (!isRecord(model) || !isString(model.id, 256) || !isString(model.name, 1024) || !isString(model.fileName, 1024) ||
      (model.format !== 'GLB' && model.format !== 'GLTF') || !isString(model.mainResourcePath, 4096) ||
      !Array.isArray(model.resources) || model.resources.length === 0 || !model.resources.every(isResource) ||
      !isTransform(model.transform)) {
      throw new Error('專案包含無效的 GLB／GLTF 模型或變換資料。')
    }
    if (!model.resources.some((resource) => resource.path === model.mainResourcePath && resource.fileName === model.fileName)) {
      throw new Error(`專案模型「${model.fileName}」缺少主模型資源。`)
    }
  }
  return value as unknown as ProjectDocument
}

const digestCache = new WeakMap<File, Promise<string>>()

export function sha256File(file: File) {
  let digest = digestCache.get(file)
  if (!digest) {
    digest = file.arrayBuffer().then(async (buffer) => {
      const hash = await crypto.subtle.digest('SHA-256', buffer)
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
    })
    digestCache.set(file, digest)
  }
  return digest
}

export async function describeProjectResource(file: FileWithPath): Promise<ProjectResource> {
  return {
    path: getGltfFilePath(file),
    fileName: file.name,
    size: file.size,
    sha256: await sha256File(file),
  }
}

export async function resolveProjectResources(document: ProjectDocument, files: FileWithPath[]) {
  const resources = [
    ...(document.ifc ? [document.ifc.resource] : []),
    ...document.models.flatMap((model) => model.resources),
  ]
  const resolved = new Map<ProjectResource, FileWithPath>()
  const missing: string[] = []
  for (const resource of resources) {
    const matches: FileWithPath[] = []
    for (const file of files) {
      if (file.size !== resource.size) continue
      if ((await sha256File(file)).toLowerCase() === resource.sha256.toLowerCase()) matches.push(file)
    }
    const expectedPath = normalizeGltfResourcePath(resource.path)
    const exactPath = matches.find((file) => getGltfFilePath(file) === expectedPath)
    if (exactPath || matches.length) {
      resolved.set(resource, exactPath ?? matches[0])
    } else {
      missing.push(`${resource.path} (${resource.size.toLocaleString()} bytes)`)
    }
  }
  return { resolved, missing }
}
