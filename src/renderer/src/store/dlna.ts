import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useDlnaStore = defineStore('dlna', () => {
  const devices = ref<any[]>([])
  const currentDevice = ref<any>(null)
  const isSearching = ref(false)

  const unsupported = () => {
    console.warn('DLNA is not available in the Tauri runtime yet')
  }

  const startSearch = async () => {
    devices.value = []
    isSearching.value = false
    unsupported()
  }

  const stopSearch = async () => {
    isSearching.value = false
  }

  const play = async (_url: string, _title: string) => unsupported()
  const pause = async () => unsupported()
  const resume = async () => unsupported()
  const stop = async () => unsupported()
  const seek = async (_seconds: number) => unsupported()
  const setVolume = async (_volume: number) => unsupported()
  const getPosition = async () => 0

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
