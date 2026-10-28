export type GltfResourceFile = Pick<File, 'name'> & Partial<Pick<File, 'webkitRelativePath'>>

export function normalizeGltfResourcePath(path: string) {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // Keep the original URI so malformed encoding produces a useful missing-resource error.
  }
  const withoutQuery = decoded.split(/[?#]/, 1)[0].replaceAll('\\', '/')
  const segments: string[] = []
  for (const segment of withoutQuery.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

export function findGltfResourcePath(requestedPath: string, candidatePaths: string[]) {
  const requested = normalizeGltfResourcePath(requestedPath)
  const candidates = candidatePaths.map(normalizeGltfResourcePath)
  const exact = candidates.find((candidate) => candidate === requested)
  if (exact) return exact

  const requestedName = requested.split('/').at(-1)?.toLocaleLowerCase()
  if (!requestedName) return undefined
  const matchingNames = candidates.filter((candidate) => candidate.split('/').at(-1)?.toLocaleLowerCase() === requestedName)
  return matchingNames.length === 1 ? matchingNames[0] : undefined
}

export function getGltfFilePath(file: GltfResourceFile) {
  return normalizeGltfResourcePath(file.webkitRelativePath || file.name)
}
