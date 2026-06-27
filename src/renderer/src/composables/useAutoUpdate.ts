import { ref } from 'vue'
export function useAutoUpdate() {
  return {
    checking: ref(false),
    updateAvailable: ref(false),
    downloadProgress: ref(0),
    downloaded: ref(false),
    error: ref(''),
    checkForUpdates: async () => {},
    quitAndInstall: async () => {}
  }
}
