type ControlName = 'toggle' | 'playPrev' | 'playNext' | 'seekDelta'

const emitControl = (name: ControlName, val?: any) => {
  window.dispatchEvent(
    new CustomEvent('global-music-control', {
      detail: { name, val }
    })
  )
}

export function installGlobalMusicControls() {
  if (!('mediaSession' in navigator)) return
  const mediaSession = navigator.mediaSession
  mediaSession.setActionHandler('play', () => emitControl('toggle'))
  mediaSession.setActionHandler('pause', () => emitControl('toggle'))
  mediaSession.setActionHandler('previoustrack', () => emitControl('playPrev'))
  mediaSession.setActionHandler('nexttrack', () => emitControl('playNext'))
  mediaSession.setActionHandler('seekbackward', () => emitControl('seekDelta', -5))
  mediaSession.setActionHandler('seekforward', () => emitControl('seekDelta', 5))
}

export function uninstallGlobalMusicControls() {
  if (!('mediaSession' in navigator)) return
  const mediaSession = navigator.mediaSession
  for (const action of [
    'play',
    'pause',
    'previoustrack',
    'nexttrack',
    'seekbackward',
    'seekforward'
  ] as MediaSessionAction[]) {
    try {
      mediaSession.setActionHandler(action, null)
    } catch {}
  }
}
