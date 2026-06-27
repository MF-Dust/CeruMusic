import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAudioOutputStore = defineStore('audioOutput', () => {
  const currentDeviceId = ref('default')
  const devices = ref<any[]>([
    { deviceId: 'default', label: '默认音频设备' }
  ])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const primaryDeviceId = ref('default')
  const secondaryDeviceId = ref('default')
  const activeABChannel = ref('A')
  const deviceStats = ref<any>(null)

  const sortedDevices = computed(() => devices.value)

  const setDeviceId = async (id: string) => {
    currentDeviceId.value = id
  }

  const setDevice = async (id: string) => {
    currentDeviceId.value = id
  }

  const playTestSound = async (deviceId: string) => {
    console.log('playTestSound:', deviceId)
  }

  const toggleAB = () => {
    activeABChannel.value = activeABChannel.value === 'A' ? 'B' : 'A'
    currentDeviceId.value = activeABChannel.value === 'A' ? primaryDeviceId.value : secondaryDeviceId.value
  }

  const scanDevices = async () => {
    console.log('scanDevices')
  }

  const init = async () => {
    console.log('init audioOutput')
  }

  return {
    currentDeviceId,
    devices,
    isLoading,
    error,
    primaryDeviceId,
    secondaryDeviceId,
    activeABChannel,
    deviceStats,
    sortedDevices,
    setDeviceId,
    setDevice,
    playTestSound,
    toggleAB,
    scanDevices,
    init
  }
})

