export function waitForAudioReady(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    if (!audio) {
      resolve()
      return
    }
    if (audio.readyState >= 2) {
      resolve()
      return
    }
    const onCanPlay = () => {
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => {
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
      resolve()
    }
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)
  })
}

export async function getCandidateSongs(song: any, userInfo: any): Promise<any[]> {
  console.log('getCandidateSongs:', song, userInfo)
  return []
}
