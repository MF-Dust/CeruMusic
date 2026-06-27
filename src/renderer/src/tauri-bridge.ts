// @ts-nocheck
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
// @ts-ignore
import musicSdk from '../../main/utils/musicSdk/index'
import CryptoJS from 'crypto-js'

// Helper to generate UUID-like IDs
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Browser Buffer Polyfill for JS Plugins
class BrowserBuffer extends Uint8Array {
  static from(data: any, encoding?: string): BrowserBuffer {
    if (typeof data === 'string') {
      if (encoding === 'hex') {
        const bytes = []
        for (let c = 0; c < data.length; c += 2) {
          bytes.push(parseInt(data.substring(c, 2), 16))
        }
        return new BrowserBuffer(bytes)
      } else if (encoding === 'base64') {
        const binary = atob(data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        return new BrowserBuffer(bytes)
      } else {
        const encoder = new TextEncoder()
        return new BrowserBuffer(encoder.encode(data))
      }
    } else if (data instanceof Uint8Array) {
      return new BrowserBuffer(data)
    } else if (data instanceof ArrayBuffer) {
      return new BrowserBuffer(new Uint8Array(data))
    } else if (Array.isArray(data)) {
      return new BrowserBuffer(data)
    }
    return new BrowserBuffer()
  }

  toString(encoding?: string): string {
    if (encoding === 'hex') {
      return Array.from(this)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } else if (encoding === 'base64') {
      let binary = ''
      for (let i = 0; i < this.byteLength; i++) {
        binary += String.fromCharCode(this[i])
      }
      return btoa(binary)
    } else {
      const decoder = new TextDecoder()
      return decoder.decode(this)
    }
  }
}

// Cache of loaded plugin exports
const loadedPluginExports: Record<string, any> = {}

// Execute plugin JS code in a browser sandbox
function loadPluginSandbox(pluginId: string, code: string) {
  try {
    const moduleObj = { exports: {} as any }
    const exportsObj = moduleObj.exports

    const cerumusic = {
      env: 'webview',
      version: '1.0.4',
      request: async (url: string, options: any, callback?: any) => {
        try {
          const tauriOptions = {
            method: options?.method || 'GET',
            headers: options?.headers || {},
            body: options?.data || options?.body || options?.form || null,
            timeout: options?.timeout || 15000
          }
          const res: any = await invoke('tauri_request', { url, options: tauriOptions })
          const result = {
            body: res.body,
            statusCode: res.statusCode,
            headers: res.headers
          }
          if (callback) {
            callback(null, result)
            return
          }
          return result
        } catch (err) {
          if (callback) {
            callback(err, null)
            return
          }
          throw err
        }
      },
      NoticeCenter: (type: string, data: any) => {
        console.log('Plugin Notice:', type, data)
      },
      stopRequests: (reason: string) => {
        console.warn('Plugin Stop Requests:', reason)
      },
      utils: {
        buffer: {
          from: (data: any, encoding?: string) => BrowserBuffer.from(data, encoding),
          bufToString: (buf: any, encoding?: string) => {
            if (buf instanceof BrowserBuffer || buf instanceof Uint8Array) {
              const b = buf instanceof BrowserBuffer ? buf : new BrowserBuffer(buf)
              return b.toString(encoding)
            }
            return String(buf)
          }
        },
        crypto: {
          md5: (str: string) => CryptoJS.MD5(str).toString(),
          randomBytes: (size: number) => {
            const arr = new Uint8Array(size)
            window.crypto.getRandomValues(arr)
            return BrowserBuffer.from(arr)
          },
          aesEncrypt: (data: any, mode: string, key: any, iv?: any) => {
            const cryptoJsMode = mode === 'aes-128-ecb' ? CryptoJS.mode.ECB : CryptoJS.mode.CBC
            const cryptoJsPadding = CryptoJS.pad.Pkcs7
            
            const keyStr = typeof key === 'string' ? key : BrowserBuffer.from(key).toString()
            const keyParsed = CryptoJS.enc.Utf8.parse(keyStr)
            
            const ivStr = iv ? (typeof iv === 'string' ? iv : BrowserBuffer.from(iv).toString()) : ''
            const ivParsed = iv ? CryptoJS.enc.Utf8.parse(ivStr) : undefined

            const dataStr = typeof data === 'string' ? data : BrowserBuffer.from(data).toString()

            const encrypted = CryptoJS.AES.encrypt(dataStr, keyParsed, {
              iv: ivParsed,
              mode: cryptoJsMode,
              padding: cryptoJsPadding
            })

            const hexStr = CryptoJS.enc.Hex.stringify(encrypted.ciphertext)
            return BrowserBuffer.from(hexStr, 'hex')
          },
          rsaEncrypt: (data: string, key: string) => {
            console.warn('RSA encryption is not fully implemented in web environment')
            return btoa(data)
          }
        }
      }
    }

    const sandboxParams = {
      module: moduleObj,
      exports: exportsObj,
      cerumusic,
      Buffer: BrowserBuffer,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      JSON,
      Math,
      Date,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Promise,
      require: () => {
        throw new Error('require() is not available in plugin sandbox')
      }
    }

    const keys = Object.keys(sandboxParams)
    const values = Object.values(sandboxParams)
    
    // Create isolated runner function
    const runner = new Function(...keys, `${code}\n;return module.exports;`)
    const pluginExports = runner(...values)
    
    if (pluginExports && typeof pluginExports === 'object') {
      loadedPluginExports[pluginId] = pluginExports
      return pluginExports
    }
  } catch (error) {
    console.error('Failed to load plugin sandbox:', error)
  }
  return null
}

const api = {
  minimize: () => invoke('window_minimize'),
  maximize: () => invoke('window_maximize'),
  close: () => invoke('window_close'),
  setMiniMode: (isMini: boolean) => {
    console.log('Tauri setMiniMode:', isMini)
  },
  show: () => invoke('window_show'),
  toggleFullscreen: () => {
    console.log('Tauri toggleFullscreen')
  },
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    return () => {}
  },
  onMusicCtrl: (callback: (event: any, ...args: any[]) => void) => {
    return () => {}
  },
  powerSaveBlocker: {
    start: async () => 1,
    stop: async () => true
  },
  settings: {
    syncCloseToTray: (value: boolean) => {
      invoke('set_config', { key: 'closeToTray', value })
    },
    getCloseToTray: () => invoke('get_config', { key: 'closeToTray', default: true })
  },
  musicCache: {
    getInfo: async () => ({}),
    clear: async () => {},
    getSize: async () => '0 B'
  },
  file: {
    readFile: (path: string) => invoke('read_file', { path })
  },
  download: {
    getTasks: () => invoke('download_get_tasks'),
    pauseTask: (taskId: string) => invoke('download_pause_task', { id: taskId }),
    resumeTask: (taskId: string) => invoke('download_resume_task', { id: taskId }),
    cancelTask: (taskId: string) => invoke('download_cancel_task', { id: taskId }),
    deleteTask: (taskId: string) => invoke('download_cancel_task', { id: taskId }),
    pauseAllTasks: async () => {},
    resumeAllTasks: async () => {},
    retryTask: async (taskId: string) => invoke('download_resume_task', { id: taskId }),
    setMaxConcurrent: async (max: number) => {
      invoke('set_config', { key: 'download.maxConcurrent', value: max })
    },
    getMaxConcurrent: () => invoke('get_config', { key: 'download.maxConcurrent', default: 3 }),
    clearTasks: async () => {},
    validateFiles: async () => [],
    openFileLocation: async () => {},
    onTaskAdded: (callback: (event: any, task: any) => void) => {
      const unlisten = listen('download-status-changed', (event) => callback(null, event.payload))
      return () => {
        unlisten.then((f) => f())
      }
    },
    onTaskProgress: (callback: (event: any, task: any) => void) => {
      const unlisten = listen('download-progress', (event) => callback(null, event.payload))
      return () => {
        unlisten.then((f) => f())
      }
    },
    onTaskStatusChanged: (callback: (event: any, task: any) => void) => {
      const unlisten = listen('download-status-changed', (event) => callback(null, event.payload))
      return () => {
        unlisten.then((f) => f())
      }
    },
    onTaskCompleted: (callback: (event: any, task: any) => void) => {
      const unlisten = listen('download-status-changed', (event) => callback(null, event.payload))
      return () => {
        unlisten.then((f) => f())
      }
    },
    onTaskError: (callback: (event: any, task: any) => void) => {
      const unlisten = listen('download-error', (event) => callback(null, event.payload))
      return () => {
        unlisten.then((f) => f())
      }
    },
    onTaskDeleted: (callback: (event: any, taskId: string) => void) => {
      return () => {}
    },
    onTasksReset: (callback: (event: any, tasks: any[]) => void) => {
      return () => {}
    }
  },
  songList: {
    create: async (name: string, description = '', source = 'local', meta = {}) => {
      const id = uuidv4().replace(/-/g, '')
      const now = new Date().toISOString()
      const playlist = {
        id,
        name: name.trim(),
        description: description.trim(),
        coverImgUrl: 'default-cover',
        source,
        meta,
        createTime: now,
        updateTime: now
      }
      await invoke('db_playlist_create', { playlist })
      return { success: true, data: playlist }
    },
    getAll: async () => {
      const data = await invoke('db_playlist_get_all')
      return { success: true, data }
    },
    getById: async (hashId: string) => {
      const data = await invoke('db_playlist_get_by_id', { id: hashId })
      return { success: true, data }
    },
    delete: async (hashId: string) => {
      await invoke('db_playlist_delete', { id: hashId })
      return { success: true }
    },
    batchDelete: async (hashIds: string[]) => {
      for (const id of hashIds) {
        await invoke('db_playlist_delete', { id })
      }
      return { success: true }
    },
    edit: async (hashId: string, updates: any) => {
      const playlistRes: any = await invoke('db_playlist_get_by_id', { id: hashId })
      if (playlistRes) {
        const merged = { ...playlistRes, ...updates, updateTime: new Date().toISOString() }
        await invoke('db_playlist_delete', { id: hashId })
        await invoke('db_playlist_create', { playlist: merged })
      }
      return { success: true }
    },
    updateCover: async (hashId: string, coverImgUrl: string) => {
      return { success: true }
    },
    search: async (keyword: string, source?: string) => {
      return { success: true, data: [] }
    },
    getStatistics: async () => ({ success: true, data: {} }),
    exists: async (hashId: string) => {
      const data = await invoke('db_playlist_get_by_id', { id: hashId })
      return { success: true, data: data !== null }
    },
    addSongs: async (hashId: string, songs: any[]) => {
      const added = await invoke('db_playlist_songs_add', { playlistId: hashId, songs })
      return { success: true, data: added }
    },
    removeSong: async (hashId: string, songmid: string | number) => {
      await invoke('db_playlist_song_remove', { playlistId: hashId, songmid: String(songmid) })
      return { success: true }
    },
    removeSongs: async (hashId: string, songmids: (string | number)[]) => {
      for (const mid of songmids) {
        await invoke('db_playlist_song_remove', { playlistId: hashId, songmid: String(mid) })
      }
      return { success: true }
    },
    clearSongs: async (hashId: string) => {
      return { success: true }
    },
    getSongs: async (hashId: string) => {
      const data = await invoke('db_playlist_songs_get', { playlistId: hashId })
      return { success: true, data }
    },
    getSongCount: async (hashId: string) => {
      const songs: any = await invoke('db_playlist_songs_get', { playlistId: hashId })
      return { success: true, data: songs.length }
    },
    hasSong: async (hashId: string, songmid: string | number) => {
      const songs: any = await invoke('db_playlist_songs_get', { playlistId: hashId })
      const exists = songs.some((s: any) => String(s.songmid) === String(songmid))
      return { success: true, data: exists }
    },
    getSong: async (hashId: string, songmid: string | number) => {
      const songs: any = await invoke('db_playlist_songs_get', { playlistId: hashId })
      const song = songs.find((s: any) => String(s.songmid) === String(songmid))
      return { success: true, data: song }
    },
    searchSongs: async (hashId: string, keyword: string) => {
      return { success: true, data: [] }
    },
    getSongStatistics: async (hashId: string) => ({ success: true, data: {} }),
    validateIntegrity: async (hashId: string) => ({ success: true }),
    repairData: async (hashId: string) => ({ success: true }),
    forceSave: async (hashId: string) => ({ success: true }),
    reorderSongs: async (hashId: string, songmids: (string | number)[]) => ({ success: true }),
    moveSong: async (hashId: string, songmid: string | number, toIndex: number) => ({
      success: true
    }),
    getFavoritesId: async () => {
      const id = await invoke('get_config', { key: 'favoritesHashId', default: '' })
      return { success: true, data: id || null }
    },
    setFavoritesId: async (id: string) => {
      const ok = await invoke('set_config', { key: 'favoritesHashId', value: id })
      return { success: ok }
    }
  },
  getUserConfig: () => invoke('get_config', { key: 'userConfig', default: {} }),
  hotkeys: {
    get: async () => ({}),
    set: async () => true
  },
  autoUpdater: {
    checkForUpdates: async () => {},
    downloadUpdate: async () => {},
    quitAndInstall: async () => {},
    getDownloadedPath: async () => '',
    onCheckingForUpdate: () => {},
    onUpdateAvailable: () => {},
    onUpdateNotAvailable: () => {},
    onDownloadProgress: () => {},
    onUpdateDownloaded: () => {},
    onError: () => {},
    onDownloadStarted: () => {},
    onDifferentialFallback: () => {},
    removeAllListeners: () => {}
  },
  ping: () => {},
  pingService: {
    start: () => {},
    stop: () => {}
  },
  directorySettings: {
    getDirectories: async () => ({
      downloadDir: 'downloads',
      cacheDir: 'cache'
    }),
    selectCacheDir: async () => '',
    selectDownloadDir: async () => '',
    saveDirectories: async () => true,
    resetDirectories: async () => true,
    openDirectory: async () => {},
    getDirectorySize: async () => '0 B'
  },
  localMusic: {
    selectDirs: async () => [],
    scan: async (dirs: string[]) => {
      await invoke('scan_directories', { dirs })
      return []
    },
    writeTags: async () => true,
    getDirs: () => invoke('db_get_dirs'),
    setDirs: (dirs: string[]) => invoke('db_set_dirs', { dirs }),
    getList: () => invoke('db_tracks_get_all'),
    getUrl: (id: string | number) => `file://${id}`,
    getUrlById: (id: string | number) => `file://${id}`,
    clearIndex: () => invoke('db_tracks_clear'),
    getCoverBase64: async () => '',
    getCoversBase64: async () => ({}),
    getTags: async () => null,
    getLyric: async () => '',
    onScanProgress: (callback: (processed: number, total: number) => void) => {
      const unlisten = listen('scan-progress', (event: any) =>
        callback(event.payload.scanned, event.payload.total)
      )
      return () => {
        unlisten.then((f) => f())
      }
    },
    onScanFinished: (callback: (resList: any[]) => void) => {
      const unlisten = listen('scan-completed', () => callback([]))
      return () => {
        unlisten.then((f) => f())
      }
    },
    removeScanProgress: () => {},
    removeScanFinished: () => {},
    batchMatch: async () => ({}),
    onBatchMatchProgress: () => () => {},
    onBatchMatchFinished: () => () => {},
    removeBatchMatchListeners: () => {}
  },
  pluginNotice: {
    onPluginNotice: () => () => {},
    onPluginThrottle: () => () => {},
    onPluginDisabled: () => () => {}
  },
  systemAudio: {
    prepareCapture: async () => '',
    getDefaultScreenSourceId: async () => ''
  },
  share: {
    getPluginCodeAndMd5: async () => ({ error: 'Not supported' }),
    onShareOpen: () => () => {},
    onPlaylistShareOpen: () => () => {},
    getPending: async () => [],
    getPendingPlaylistShares: async () => []
  },
  listenTogether: {
    onShareOpen: () => () => {},
    getPendingCodes: async () => []
  },
  clipboard: {
    readText: async () => ''
  },
  thumbar: {
    setState: () => {},
    setCover: () => {},
    onToggleLike: () => () => {}
  },
  app: {
    setTitle: () => {},
    setProgress: () => {}
  },
  music: {
    requestSdk: async (apiName: string, args: any) => {
      // Intercept plugin call
      if (apiName === 'getMusicUrl' && args?.pluginId) {
        const usePlugin = loadedPluginExports[args.pluginId]
        if (usePlugin && typeof usePlugin.musicUrl === 'function') {
          const songinfo = { ...args.songInfo, id: args.songInfo.songmid || args.songInfo.hash }
          const url = await usePlugin.musicUrl(args.songInfo.source || 'wy', songinfo, args.quality)
          return url
        }
      }
      
      const path = apiName.split('.')
      let fn: any = musicSdk
      for (const p of path) {
        if (fn) fn = fn[p]
      }
      if (typeof fn === 'function') {
        return await fn(args)
      }
      throw new Error(`SDK method ${apiName} not found`)
    },
    invoke: async (channel: string, ...args: any[]) => {
      console.log('music.invoke:', channel, args)
    }
  },
  plugins: {
    selectAndAddPlugin: async (type: 'lx' | 'cr') => {
      return { canceled: true }
    },
    downloadAndAddPlugin: async (url: string, type: 'lx' | 'cr', targetPluginId?: string) => {
      return { error: 'Not implemented' }
    },
    addPlugin: async (pluginCode: string, pluginName: string, targetPluginId?: string) => {
      const id = targetPluginId || uuidv4().replace(/-/g, '')
      await invoke('plugin_save', { id, code: pluginCode, name: pluginName })
      loadPluginSandbox(id, pluginCode)
      return { success: true }
    },
    getPluginById: async (id: string) => {
      const list: any = await invoke('plugin_load_all')
      const plugin = list.find((p: any) => p.id === id)
      return plugin
    },
    loadAllPlugins: async () => {
      const list: any = await invoke('plugin_load_all')
      // Compile each plugin into sandbox and store in exports
      for (const p of list) {
        loadPluginSandbox(p.id, p.code)
      }
      return list.map((p: any) => ({
        pluginId: p.id,
        name: p.name,
        // serialize fake info for compatibility
        pluginInfo: {
          name: p.name,
          version: '1.0.0',
          author: 'Unknown',
          description: 'Loaded via Tauri'
        }
      }))
    },
    uninstallPlugin: async (pluginId: string) => {
      await invoke('plugin_delete', { id: pluginId })
      delete loadedPluginExports[pluginId]
      return { success: true }
    },
    getPluginLog: async () => '',
    getPluginType: async () => ({ data: 'music-source' }),
    getConfigSchema: async () => ({ data: [] }),
    getConfig: (pluginId: string) => invoke('plugin_get_config', { id: pluginId }),
    saveConfig: (pluginId: string, config: any) =>
      invoke('plugin_save_config', { id: pluginId, config }),
    testConnection: async () => ({ success: true }),
    getPlaylists: async () => ({ data: [] }),
    getPlaylistSongs: async () => ({ data: [] }),
    importToLocal: async () => ({ success: true }),
    getServiceLyric: async () => ({ data: '' }),
    onDeepLinkAdd: () => () => {}
  },
  ai: {
    ask: async () => '',
    askStream: async () => '',
    onStreamChunk: () => {},
    onStreamEnd: () => {},
    onStreamError: () => {},
    removeStreamListeners: () => {}
  },
  registry: {
    cleanAUMID: async () => {}
  },
  dlna: {
    startScan: () => {},
    stopScan: () => {},
    getDevices: async () => [],
    setDevice: async () => {},
    play: async () => {},
    pause: async () => {},
    stop: async () => {},
    seek: async () => {},
    setVolume: async () => {},
    getPosition: async () => 0,
    getVolume: async () => 100,
    onDeviceFound: () => () => {},
    onPlayStateChanged: () => () => {},
    onPositionChanged: () => () => {}
  }
}

// Assign to global window object
// @ts-ignore
window.api = api
// @ts-ignore
window.electron = {
  ipcRenderer: {
    send: () => {},
    invoke: () => {},
    on: () => {},
    once: () => {},
    removeListener: () => {},
    removeAllListeners: () => {}
  }
}
