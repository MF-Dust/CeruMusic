import type PlayList from '@common/types/playList'

export async function importPlaylistFromFile(file: File): Promise<PlayList[]> {
  console.log('importPlaylistFromFile:', file)
  return []
}

export function validateImportedPlaylist(imported: any): imported is PlayList[] {
  return Array.isArray(imported)
}

export async function exportPlaylistToFile(...args: any[]) {
  console.log('exportPlaylistToFile:', args)
}

export async function importPlaylistFromPath(path: string): Promise<PlayList[]> {
  console.log('importPlaylistFromPath:', path)
  return []
}

