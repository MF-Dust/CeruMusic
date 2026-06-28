import { defineStore } from 'pinia'
import { ref } from 'vue'

// DLNA 投屏设备状态管理。
// 迁移到 Tauri 后，原 window.electron.ipcRenderer.invoke('dlna:*') 改为 window.api.dlna.*。
export const useDlnaStore = defineStore('dlna', () => {
  const devices = ref<any[]>([])
  const currentDevice = ref<any>(null)
  const isSearching = ref(false)

  const startSearch = async () => {
    isSearching.value = true
    try {
      await window.api.dlna.startSearch()
      try {
        devices.value = await window.api.dlna.getDevices()
      } catch (e) {
        console.error('DLNA get devices error', e)
      }
    } catch (e) {
      console.error('DLNA start search error', e)
    } finally {
      isSearching.value = false
    }
  }

  const stopSearch = async () => {
    try {
      await window.api.dlna.stopSearch()
    } catch (e) {
      console.error('DLNA stop search error', e)
    }
    isSearching.value = false
  }

  const play = async (url: string, title: string) => {
    if (!currentDevice.value) return
    try {
      await window.api.dlna.play(url, currentDevice.value.location, title)
    } catch (e) {
      console.error('DLNA play error', e)
    }
  }

  const pause = async () => {
    try {
      await window.api.dlna.pause()
    } catch (e) {
      console.error('DLNA pause error', e)
    }
  }

  const resume = async () => {
    try {
      await window.api.dlna.resume()
    } catch (e) {
      console.error('DLNA resume error', e)
    }
  }

  const stop = async () => {
    try {
      await window.api.dlna.stop()
    } catch (e) {
      console.error('DLNA stop error', e)
    }
  }

  const seek = async (seconds: number) => {
    try {
      await window.api.dlna.seek(seconds)
    } catch (e) {
      console.error('DLNA seek error', e)
    }
  }

  const setVolume = async (volume: number) => {
    try {
      await window.api.dlna.setVolume(volume)
    } catch (e) {
      console.error('DLNA setVolume error', e)
    }
  }

  const getPosition = async (): Promise<number> => {
    try {
      return await window.api.dlna.getPosition()
    } catch (e) {
      console.error('DLNA getPosition error', e)
      return 0
    }
  }

  return {
    devices,
    currentDevice,
    isSearching,
    startSearch,
    stopSearch,
    play,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    getPosition
  }
})
