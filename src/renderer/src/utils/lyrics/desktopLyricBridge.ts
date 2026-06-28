import { emit, listen } from '@tauri-apps/api/event'
import { ControlAudioStore } from '@renderer/store/ControlAudio'
import { useGlobalPlayStatusStore } from '@renderer/store/GlobalPlayStatus'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { LocalUserDetailStore } from '@renderer/store/LocalUserDetail'

interface LyricWord {
  word: string
}
interface LyricLine {
  startTime: number
  endTime: number
  words: LyricWord[]
  translatedLyric?: string
}

let installed = false
let rafId: number | null = null
let unlistens: (() => void)[] = []

function buildLyricPayload(lines: LyricLine[]) {
  return JSON.parse(JSON.stringify(lines || []))
}

function computeLyricIndex(timeMs: number, lines: LyricLine[]) {
  if (!lines || lines.length === 0) return -1
  const t = timeMs
  const i = lines.findIndex((l) => t >= l.startTime && t < l.endTime)
  if (i !== -1) return i
  for (let j = lines.length - 1; j >= 0; j--) {
    if (t >= lines[j].startTime) return j
  }
  return -1
}

export function installDesktopLyricBridge() {
  if (installed) return
  installed = true

  const controlAudio = ControlAudioStore()
  const globalPlayStatus = useGlobalPlayStatusStore()
  const { player } = storeToRefs(globalPlayStatus)
  const localUserStore = LocalUserDetailStore()
  const { userInfo } = storeToRefs(localUserStore)

  let lastIndex = -1

  // Watch lyrics changes
  const watchLyric = watch(
    () => player.value.lyrics.lines,
    (lines) => {
      lastIndex = -1
      emit('play-lyric-change', buildLyricPayload(lines))
      emit('play-lyric-index', -1)
    },
    { immediate: true }
  )

  // Watch song info changes
  const watchSong = watch(
    () => player.value.songInfo,
    (song) => {
      try {
        const name = (song as any)?.name || ''
        const artist = (song as any)?.singer || ''
        if (name || artist) {
          emit('play-song-change', { name, artist })
        }
      } catch {}
    },
    { immediate: true }
  )

  // Push play state changes
  let lastPlayState: any = undefined
  const checkPlayState = () => {
    if (controlAudio.Audio.isPlay !== lastPlayState) {
      lastPlayState = controlAudio.Audio.isPlay
      emit('play-status-change', lastPlayState)
    }
  }
  const watchPlayState = watch(() => controlAudio.Audio.isPlay, checkPlayState, { immediate: true })

  // Compute current playback ms / lyric index / in-line progress.
  // Shared by the one-shot snapshot and the RAF loop so the math lives in one place.
  const computeState = () => {
    const a = controlAudio.Audio
    let ms = Math.round((a?.currentTime || 0) * 1000)
    if (ms <= 0) {
      const currentSong = player.value.songInfo as any
      const lastId = userInfo.value?.lastPlaySongId
      const songId = currentSong?.songmid
      const restoreMs = Math.round(Number(userInfo.value?.currentTime || 0) * 1000)
      if (lastId && songId && lastId === songId && restoreMs > 0) {
        ms = restoreMs
      }
    }
    const currentLines = (player.value.lyrics?.lines as any[]) || []
    const idx = computeLyricIndex(ms, currentLines as any)
    let progress = 0
    if (idx >= 0 && currentLines[idx]) {
      const line = currentLines[idx] as any
      const dur = Math.max(1, (line.endTime ?? line.startTime + 1) - line.startTime)
      progress = Math.min(1, Math.max(0, (ms - line.startTime) / dur))
    }
    return { ms, idx, progress, currentLines }
  }

  // Push snapshot
  const pushSnapshot = () => {
    try {
      const currentSong = player.value.songInfo as any
      const name = currentSong?.name || ''
      const artist = currentSong?.singer || ''
      if (name || artist) {
        emit('play-song-change', { name, artist })
      }
      const { ms, idx, progress, currentLines } = computeState()
      emit('play-lyric-change', buildLyricPayload(currentLines))
      lastIndex = idx
      emit('play-lyric-index', idx)
      emit('play-lyric-progress', {
        index: idx,
        progress,
        currentMs: ms,
        timestamp: performance.now()
      })
      emit('play-status-change', !!controlAudio.Audio.isPlay)
    } catch {}
  }

  // Push first snapshot
  pushSnapshot()

  // RAF loop. The lyric window interpolates progress with its own clock and only
  // re-syncs when our currentMs drifts >300ms, so throttle the progress emit to
  // ~4/s rather than firing an IPC message every animation frame (~60/s).
  let lyricWindowOpen = false
  let lastProgressEmit = 0
  const loop = () => {
    if (!installed || !lyricWindowOpen) {
      rafId = null
      return
    }

    const { ms, idx, progress } = computeState()
    const now = performance.now()
    if (now - lastProgressEmit >= 250) {
      lastProgressEmit = now
      emit('play-lyric-progress', {
        index: idx,
        progress,
        currentMs: ms,
        timestamp: now
      })
    }

    if (idx !== lastIndex) {
      lastIndex = idx
      emit('play-lyric-index', idx)
    }
    rafId = requestAnimationFrame(loop)
  }

  const startLoop = () => {
    if (rafId !== null) return
    lastProgressEmit = 0
    rafId = requestAnimationFrame(loop)
  }

  const stopLoop = () => {
    if (rafId === null) return
    cancelAnimationFrame(rafId)
    rafId = null
  }

  // Listen to ready/open-change events
  listen('lyric-window-ready', () => {
    lyricWindowOpen = true
    pushSnapshot()
    startLoop()
  }).then((un) => unlistens.push(un))

  listen('desktop-lyric-open-change', (event: any) => {
    lyricWindowOpen = !!event.payload
    if (lyricWindowOpen) {
      pushSnapshot()
      startLoop()
    } else {
      stopLoop()
    }
  }).then((un) => unlistens.push(un))

  // Save watcher cleanup
  unlistens.push(() => {
    watchLyric()
    watchSong()
    watchPlayState()
  })
}

export function uninstallDesktopLyricBridge() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }

  for (const un of unlistens) {
    un()
  }
  unlistens = []

  installed = false
  console.log('Desktop lyric bridge uninstalled')
}

export function isDesktopLyricBridgeInstalled() {
  return installed
}
