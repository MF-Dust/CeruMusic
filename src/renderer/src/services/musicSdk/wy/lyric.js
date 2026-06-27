export default function getLyric(_songmid) {
  return {
    promise: Promise.resolve({
      lyric: '',
      tlyric: ''
    })
  }
}
