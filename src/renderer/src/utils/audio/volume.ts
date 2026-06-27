export function getVolume(): number {
  return 100
}

export function setVolume(vol: number) {
  console.log('setVolume:', vol)
}

export async function transitionVolume(
  audioElement: HTMLAudioElement,
  targetVolume: number,
  _isUp?: boolean,
  _force?: boolean
) {
  if (audioElement) {
    audioElement.volume = Number(targetVolume.toFixed(2))
  }
}

