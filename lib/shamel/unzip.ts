import { unzipSync } from 'fflate'

export interface ExtractedFile {
  name: string
  cleanName: string // lowercase basename without directory
  data: Uint8Array
  size: number
  depth: number
  path: string
}

/**
 * Extracts a ZIP file in memory into a map of clean filenames to Uint8Array.
 * Always prefers root-level files over nested subfolders (e.g. ignores nested ma3rwdalmnar/* if ma3rwdaljdede/* exists at root).
 */
export function extractShamelZip(buffer: ArrayBuffer | Uint8Array): Map<string, ExtractedFile> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const unzipped = unzipSync(bytes)
  const fileMap = new Map<string, ExtractedFile>()

  for (const [path, data] of Object.entries(unzipped)) {
    // Ignore folders, macOS metadata, and hidden files
    if (path.endsWith('/') || path.includes('__MACOSX') || path.startsWith('.')) {
      continue
    }

    const segments = path.split(/[\/\\]/).filter(Boolean)
    const basename = segments[segments.length - 1]
    if (!basename || basename.startsWith('.')) continue

    const cleanName = basename.toLowerCase().trim()
    const depth = segments.length

    // If file already seen, only overwrite if current file is shallower (closer to root)
    if (fileMap.has(cleanName)) {
      const existing = fileMap.get(cleanName)!
      if (depth >= existing.depth) {
        // Skip nested subfolder duplicate!
        continue
      }
    }

    fileMap.set(cleanName, {
      name: basename,
      cleanName,
      data,
      size: data.byteLength,
      depth,
      path,
    })
  }

  return fileMap
}
