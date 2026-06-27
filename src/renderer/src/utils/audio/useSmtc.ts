export const mediaSessionController = {
  updatePlaybackState: (state: string) => {
    if (!('mediaSession' in navigator)) return
    if (state === 'playing' || state === 'paused' || state === 'none') {
      navigator.mediaSession.playbackState = state
    }
  },
  updateMetadata: (metadata: any) => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
    const artworkUrl = metadata?.artworkUrl || metadata?.artwork || metadata?.cover || ''
    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata?.title || metadata?.name || '',
      artist: metadata?.artist || metadata?.singer || '',
      album: metadata?.album || metadata?.albumName || '',
      artwork: artworkUrl
        ? [
            {
              src: artworkUrl,
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        : []
    })
  }
}

export default mediaSessionController
