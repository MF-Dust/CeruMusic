// @ts-nocheck
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
// @ts-ignore
import musicSdk from './services/musicSdk/index'
import CryptoJS from 'crypto-js'
import { sizeFormate } from './services'

// Helper to generate UUID-like IDs using native Web Crypto API
function uuidv4() {
  return crypto.randomUUID()
}

// Browser Buffer Polyfill for JS Plugins
class BrowserBuffer extends Uint8Array {
  static from(data: any, encoding?: string): BrowserBuffer {
    if (typeof data === 'string') {
      if (encoding === 'hex') {
        const bytes = []
        for (let c = 0; c < data.length; c += 2) {
          bytes.push(parseInt(data.substring(c, c + 2), 16))
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

type PluginType = 'music-source' | 'service'

const loadedPluginExports: Record<string, any> = {}
const loadedPluginMetadata: Record<string, any> = {}
const loadedPluginCodes: Record<string, string> = {}

function safeJson(value: any) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatLogArg(value: any): string {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  return safeJson(value)
}

function appendPluginLog(pluginId: string, level: string, args: any[]) {
  const entry = {
    t: Date.now(),
    l: level,
    m: args.map(formatLogArg).join(' '),
  }
  invoke('plugin_append_log', { id: pluginId, entry }).catch(() => {})
}

function createPluginConsole(pluginId: string) {
  const make =
    (level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'group' | 'groupEnd') =>
    (...args: any[]) => {
      appendPluginLog(pluginId, level, args)
      const target = console[level] || console.log
      target.apply(console, args)
    }
  return {
    log: make('log'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    group: make('group'),
    groupEnd: make('groupEnd'),
  }
}

function createCerumusicApi(pluginId: string, pluginConsole: any) {
  const request = async (url: string, options?: any, callback?: any) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    try {
      const tauriOptions = {
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.data ?? options?.body ?? options?.form ?? null,
        timeout: options?.timeout || 15000,
      }
      const res: any = await invoke('tauri_request', {
        url,
        options: tauriOptions,
      })
      const result = {
        body: res.body,
        statusCode: res.statusCode,
        headers: res.headers,
      }
      if (callback) {
        callback(null, result)
        return
      }
      return result
    } catch (err) {
      pluginConsole.error('request failed', err)
      if (callback) {
        callback(err, null)
        return
      }
      throw err
    }
  }

  return {
    env: 'webview',
    version: '1.14.1',
    request,
    NoticeCenter: (type: string, data: any) => {
      pluginConsole.info('NoticeCenter', type, data)
    },
    stopRequests: (reason: string) => {
      pluginConsole.warn('stopRequests', reason)
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
        },
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
            padding: cryptoJsPadding,
          })

          const hexStr = CryptoJS.enc.Hex.stringify(encrypted.ciphertext)
          return BrowserBuffer.from(hexStr, 'hex')
        },
        rsaEncrypt: (data: string) => {
          pluginConsole.warn('RSA encryption is not fully implemented in webview sandbox')
          return btoa(data)
        },
      },
    },
  }
}

function parsePluginInfoFromComments(code: string) {
  const pick = (key: string) => {
    const match = code.match(new RegExp(`@${key}\\s+([^\\n\\r*]+)`))
    return match?.[1]?.trim()
  }
  const name = pick('name')
  const version = pick('version')
  const author = pick('author')
  const description = pick('description')
  if (!name && !version && !author && !description) return null
  return { name, version, author, description }
}

function normalizePluginInfo(info: any, fallbackName = 'Plugin') {
  return {
    name: info?.name || fallbackName || 'Plugin',
    version: info?.version || '1.0.0',
    author: info?.author || 'Unknown',
    description: info?.description || '',
  }
}

function normalizeSources(rawSources: any) {
  if (!rawSources) return {}
  if (Array.isArray(rawSources)) {
    return rawSources.reduce((acc: any, source: any, index: number) => {
      const key =
        source?.id ||
        source?.source ||
        source?.key ||
        source?.name ||
        source?.type ||
        `source${index}`
      acc[key] = {
        ...source,
        name: source?.name || key,
        type: source?.type || 'music',
        qualitys: source?.qualitys || source?.qualities || source?.quality || [],
      }
      return acc
    }, {})
  }
  if (typeof rawSources === 'object') {
    return Object.entries(rawSources).reduce((acc: any, [key, source]: any[]) => {
      acc[key] = {
        ...(source || {}),
        name: source?.name || key,
        type: source?.type || 'music',
        qualitys: source?.qualitys || source?.qualities || source?.quality || [],
      }
      return acc
    }, {})
  }
  return {}
}

function detectPluginType(pluginExports: any, metadata: any): PluginType {
  const declared =
    pluginExports?.pluginType ||
    metadata?.pluginType ||
    pluginExports?.pluginInfo?.pluginType ||
    (pluginExports?.pluginInfo?.type === 'service' ? 'service' : '') ||
    pluginExports?.pluginInfo?.serviceType
  if (declared === 'service') return 'service'
  if (
    typeof pluginExports?.getPlaylists === 'function' ||
    typeof pluginExports?.getPlaylistSongs === 'function' ||
    typeof pluginExports?.testConnection === 'function'
  ) {
    return 'service'
  }
  return 'music-source'
}

function extractRuntimeMetadata(
  pluginId: string,
  pluginExports: any,
  code = '',
  rawMetadata: any = {},
) {
  const commentInfo = parsePluginInfoFromComments(code)
  const pluginInfo = normalizePluginInfo(
    pluginExports?.pluginInfo || rawMetadata?.pluginInfo || commentInfo,
    rawMetadata?.pluginName || pluginId,
  )
  const supportedSources = normalizeSources(
    pluginExports?.supportedSources || pluginExports?.sources || rawMetadata?.supportedSources,
  )
  const pluginType = detectPluginType(pluginExports, rawMetadata)
  return {
    pluginId,
    pluginName: rawMetadata?.pluginName || pluginInfo.name,
    pluginInfo,
    supportedSources,
    pluginType,
    configSchema: pluginExports?.configSchema || rawMetadata?.configSchema || [],
  }
}

function buildLxExports(lxState: any, cerumusic: any, code: string) {
  const requestHandler = lxState.handlers[lxState.EVENT_NAMES.request]
  if (typeof requestHandler !== 'function') return null
  const pluginInfo = normalizePluginInfo(
    lxState.pluginInfo || parsePluginInfoFromComments(code),
    'LX Plugin',
  )
  const callAction = (action: string, source: string, musicInfo: any, quality?: string) => {
    return requestHandler({
      source,
      action,
      info: {
        musicInfo,
        type: quality,
        quality,
      },
    })
  }
  return {
    pluginInfo,
    pluginType: 'music-source',
    sources: lxState.sources || {},
    cerumusic,
    musicUrl: (source: string, musicInfo: any, quality: string) =>
      callAction('musicUrl', source, musicInfo, quality),
    getPic: (source: string, musicInfo: any) => callAction('pic', source, musicInfo),
    getLyric: (source: string, musicInfo: any) => callAction('lyric', source, musicInfo),
  }
}

function loadPluginSandbox(
  pluginId: string,
  code: string,
  importType: 'lx' | 'cr' = 'cr',
  rawMetadata = {},
) {
  const pluginConsole = createPluginConsole(pluginId)
  try {
    const moduleObj = { exports: {} as any }
    const exportsObj = moduleObj.exports
    const cerumusic = createCerumusicApi(pluginId, pluginConsole)
    const lxState: any = {
      EVENT_NAMES: {
        inited: 'inited',
        request: 'request',
        updateAlert: 'updateAlert',
      },
      handlers: {},
      sources: null,
      pluginInfo: null,
    }

    const lx = {
      EVENT_NAMES: lxState.EVENT_NAMES,
      on: (eventName: string, handler: any) => {
        lxState.handlers[eventName] = handler
      },
      send: (eventName: string, data: any) => {
        if (eventName === lxState.EVENT_NAMES.inited) {
          lxState.sources = data?.sources || {}
          lxState.pluginInfo = data?.pluginInfo || lxState.pluginInfo
        } else if (eventName === lxState.EVENT_NAMES.updateAlert) {
          cerumusic.NoticeCenter('update', data)
        }
      },
      request: cerumusic.request,
      utils: cerumusic.utils,
    }

    const on = lx.on
    const send = lx.send
    const sandboxGlobal: any = {
      lx,
      cerumusic,
      Buffer: BrowserBuffer,
      console: pluginConsole,
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
    }
    sandboxGlobal.globalThis = sandboxGlobal
    sandboxGlobal.self = sandboxGlobal
    sandboxGlobal.window = sandboxGlobal

    const sandboxParams = {
      module: moduleObj,
      exports: exportsObj,
      cerumusic,
      lx,
      on,
      send,
      request: cerumusic.request,
      Buffer: BrowserBuffer,
      console: pluginConsole,
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
      globalThis: sandboxGlobal,
      self: sandboxGlobal,
      window: sandboxGlobal,
      process: { env: {} },
      require: () => {
        throw new Error('require() is not available in plugin sandbox')
      },
    }

    const keys = Object.keys(sandboxParams)
    const values = Object.values(sandboxParams)
    const runner = new Function(...keys, `${code}\n;return module.exports;`)
    let pluginExports = runner(...values)

    if (
      (!pluginExports || Object.keys(pluginExports).length === 0) &&
      (importType === 'lx' || lxState.handlers[lxState.EVENT_NAMES.request])
    ) {
      pluginExports = buildLxExports(lxState, cerumusic, code)
    }

    if (pluginExports && typeof pluginExports === 'object') {
      pluginExports.cerumusic = cerumusic
      loadedPluginExports[pluginId] = pluginExports
      loadedPluginCodes[pluginId] = code
      loadedPluginMetadata[pluginId] = extractRuntimeMetadata(
        pluginId,
        pluginExports,
        code,
        rawMetadata,
      )
      return pluginExports
    }
  } catch (error) {
    appendPluginLog(pluginId, 'error', ['Failed to load plugin sandbox:', error])
    console.error('Failed to load plugin sandbox:', error)
  }
  return null
}

async function persistRuntimeMetadata(pluginId: string) {
  const metadata = loadedPluginMetadata[pluginId]
  if (!metadata) return
  await invoke('plugin_save_metadata', { id: pluginId, metadata }).catch((err) => {
    console.warn('Failed to save plugin metadata:', err)
  })
}

function validatePlugin(pluginId: string) {
  const pluginExports = loadedPluginExports[pluginId]
  const metadata = loadedPluginMetadata[pluginId]
  if (!pluginExports || !metadata?.pluginInfo?.name) {
    return '插件信息不完整，必须导出 pluginInfo'
  }
  if (metadata.pluginType === 'service') {
    if (
      typeof pluginExports.getPlaylists !== 'function' &&
      typeof pluginExports.getPlaylistSongs !== 'function'
    ) {
      return '服务插件必须导出 getPlaylists 或 getPlaylistSongs'
    }
  } else if (typeof pluginExports.musicUrl !== 'function') {
    return '音源插件必须导出 musicUrl'
  }
  return ''
}

async function finalizePluginInstall(raw: any, importType: 'lx' | 'cr') {
  if (!raw || raw.error) return raw || { error: '插件安装失败' }
  const pluginId = raw.pluginId || raw.id
  const code = raw.code
  if (!pluginId || !code) return { error: '插件安装结果缺少插件代码' }

  const pluginExports = loadPluginSandbox(pluginId, code, importType, raw.metadata || {})
  if (!pluginExports) {
    await invoke('plugin_delete', { id: pluginId }).catch(() => {})
    return { error: '插件加载失败，请检查插件语法或格式' }
  }

  const validationError = validatePlugin(pluginId)
  if (validationError) {
    await invoke('plugin_delete', { id: pluginId }).catch(() => {})
    delete loadedPluginExports[pluginId]
    delete loadedPluginMetadata[pluginId]
    delete loadedPluginCodes[pluginId]
    return { error: validationError }
  }

  await persistRuntimeMetadata(pluginId)
  const metadata = loadedPluginMetadata[pluginId]
  return {
    success: true,
    pluginId,
    pluginInfo: metadata.pluginInfo,
    supportedSources: metadata.supportedSources,
    pluginType: metadata.pluginType,
  }
}

async function ensurePluginRuntime(pluginId: string) {
  if (loadedPluginExports[pluginId]) return loadedPluginExports[pluginId]
  const list: any = await invoke('plugin_load_all')
  const raw = list.find((p: any) => (p.pluginId || p.id) === pluginId)
  if (!raw) return null
  return loadPluginSandbox(pluginId, raw.code, raw.metadata?.importType || 'cr', raw.metadata || {})
}

async function getPluginConfigValue(pluginId: string) {
  const config = await invoke('plugin_get_config', { id: pluginId })
  return config && typeof config === 'object' ? config : {}
}

function unwrapData(result: any) {
  if (result && typeof result === 'object' && 'data' in result) return result.data
  return result
}

function normalizeServicePlaylists(result: any) {
  const list = unwrapData(result)
  if (!Array.isArray(list)) return []
  return list.map((pl: any, index: number) => ({
    id: String(pl.id ?? pl.playlistId ?? pl.hashId ?? index),
    name: pl.name || pl.title || `Playlist ${index + 1}`,
    songCount: Number(pl.songCount ?? pl.count ?? pl.trackCount ?? pl.songs?.length ?? 0),
    coverImg: pl.coverImg || pl.cover || pl.coverImgUrl || pl.picUrl || '',
    description: pl.description || pl.desc || '',
  }))
}

function normalizeServiceSongs(result: any, pluginId: string) {
  const raw = unwrapData(result)
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.songs) ? raw.songs : []
  const total = Number(raw?.total ?? list.length)
  const songs = list.map((song: any, index: number) => {
    const url = song.url || song.playUrl || song.musicUrl || ''
    const qualityKeys = Object.keys(song.typeUrl || {})
    const types = song.types || qualityKeys || (url ? ['128k'] : [])
    const songmid = String(song.songmid ?? song.id ?? song.hash ?? `${pluginId}-${index}`)
    return {
      songmid,
      hash: song.hash || songmid,
      singer: song.singer || song.artist || song.artistName || '',
      name: song.name || song.title || `Track ${index + 1}`,
      albumName: song.albumName || song.album || '',
      albumId: song.albumId || song.album_id || '',
      source: song.source || `service:${pluginId}`,
      interval: song.interval || song.durationText || '',
      img: song.img || song.cover || song.coverImg || song.picUrl || '',
      lrc: song.lrc ?? song.lyric ?? null,
      types,
      _types: song._types || {},
      typeUrl: song.typeUrl || (url ? { [types[0] || '128k']: url } : undefined),
      url,
      _servicePluginId: pluginId,
      _serviceRaw: song,
    }
  })
  return { songs, total }
}

function getServiceSongArray(result: any) {
  const data = unwrapData(result)
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.songs)) return data.songs
  return []
}

function pluginCallContext(pluginExports: any) {
  return { ...pluginExports, cerumusic: pluginExports?.cerumusic }
}

function callPluginMethod(pluginExports: any, method: any, args: any[]) {
  return method.apply(pluginCallContext(pluginExports), args)
}

function normalizeMaybePromiseResult(result: any) {
  return result?.promise ? result.promise : result
}

function pickLyricPayload(result: any) {
  if (typeof result === 'string') return { lyric: result }
  return result || { lyric: '' }
}

function normalizeMusicUrlResult(result: any) {
  if (typeof result === 'string') return result
  if (result?.url) return result.url
  return result
}

function getSelectedPluginId() {
  try {
    const info = JSON.parse(localStorage.getItem('userInfo') || '{}')
    return info?.pluginId || ''
  } catch {
    return ''
  }
}

function pluginSupportsSource(pluginId: string, source: string) {
  const supportedSources = loadedPluginMetadata[pluginId]?.supportedSources || {}
  const keys = Object.keys(supportedSources)
  return keys.length === 0 || !!supportedSources[source]
}

const PLUGIN_NO_MATCH = Symbol('PLUGIN_NO_MATCH')

async function tryPluginMusicSdk(apiName: string, args: any) {
  const methodMap: Record<string, string> = {
    getMusicUrl: 'musicUrl',
    getPic: 'getPic',
    getLyric: 'getLyric',
  }
  const methodName = methodMap[apiName]
  if (!methodName) return PLUGIN_NO_MATCH

  const pluginId = args?.pluginId || getSelectedPluginId()
  if (!pluginId) return PLUGIN_NO_MATCH

  const pluginExports = await ensurePluginRuntime(pluginId)
  const metadata = loadedPluginMetadata[pluginId]
  if (!pluginExports || metadata?.pluginType === 'service') return PLUGIN_NO_MATCH

  const source = args?.source || args?.songInfo?.source || 'wy'
  if (!pluginSupportsSource(pluginId, source)) return PLUGIN_NO_MATCH

  const method = pluginExports[methodName]
  if (typeof method !== 'function') return PLUGIN_NO_MATCH

  const songInfo = {
    ...(args?.songInfo || {}),
    id: args?.songInfo?.id ?? args?.songInfo?.songmid ?? args?.songInfo?.hash,
  }

  try {
    let result: any
    if (methodName === 'musicUrl') {
      result = await callPluginMethod(pluginExports, method, [source, songInfo, args?.quality])
      return normalizeMusicUrlResult(await normalizeMaybePromiseResult(result))
    }
    result = await callPluginMethod(pluginExports, method, [source, songInfo])
    return await normalizeMaybePromiseResult(result)
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

async function runBuiltinMusicSdk(apiName: string, args: any = {}) {
  const source = args?.source || args?.songInfo?.source || 'wy'
  const Api = source === 'all' ? musicSdk.aggregate : musicSdk[source]

  if (source === 'all' && musicSdk.aggregate) {
    const Agg = musicSdk.aggregate
    switch (apiName) {
      case 'search':
        return await Agg.search(args.keyword, args.page || 1, args.limit || 30)
      case 'tipSearch':
        return await Agg.tipSearch(args.keyword)
      case 'searchPlaylist':
        return await Agg.searchPlaylist(args.keyword, args.page || 1, args.limit || 30)
      case 'getPlaylistTags':
        return await Agg.getPlaylistTags()
      case 'getCategoryPlaylists':
        return await Agg.getCategoryPlaylists(args)
      case 'getLeaderboards':
        return await Agg.getLeaderboards()
      default:
        throw new Error(`SDK method ${apiName} is not supported in aggregate mode`)
    }
  }

  if (Api) {
    switch (apiName) {
      case 'search':
        return await Api.musicSearch.search(args.keyword, args.page || 1, args.limit || 30)
      case 'tipSearch':
        return Api.tipSearch?.search ? await Api.tipSearch.search(args.keyword) : []
      case 'getMusicUrl':
        if (typeof Api.getMusicUrl === 'function') {
          return await Api.getMusicUrl(args.songInfo, args.quality)
        }
        break
      case 'getPic':
        return await Api.getPic(args.songInfo)
      case 'getLyric': {
        const res = await Api.getLyric(args.songInfo)
        const lyricResult = res?.promise ? await res.promise : res
        if (args.useFormat !== null && args.useFormat !== undefined && lyricResult) {
          const preferWordByWord = args.useFormat === 'word-by-word'
          const cr = lyricResult.crlyric || lyricResult.cr_lyric || null
          const std = lyricResult.lyric || lyricResult.lrc || null
          return preferWordByWord ? cr || std : std || cr
        }
        return lyricResult
      }
      case 'getHotSonglist':
        return await Api.songList.getList(Api.songList.sortList[0].id, '', 1)
      case 'getPlaylistTags':
        return await Api.songList.getTags()
      case 'getCategoryPlaylists': {
        const sortId = args.sortId || Api.songList.sortList?.[0]?.id || ''
        const tagId = args.tagId || ''
        const page = args.page || 1
        const limit = args.limit || Api.songList.limit_list
        const res =
          source === 'wy'
            ? await Api.songList.getList(sortId, tagId, page, limit)
            : await Api.songList.getList(sortId, tagId, page)
        return {
          category: { id: tagId || 'hot', name: tagId || '热门' },
          ...res,
        }
      }
      case 'getPlaylistDetail':
        if (source === 'kg' && /https?:\/\//.test(args.id)) {
          return await Api.songList.getUserListDetail(args.id, args.page)
        }
        return await Api.songList.getListDetail(args.id, args.page)
      case 'parsePlaylistId':
        return await Api.songList.handleParseId(args.url)
      case 'getPlaylistDetailById':
        return await Api.songList.getListDetail(args.id, args.page || 1)
      case 'searchPlaylist':
        return await Api.songList.search(args.keyword, args.page || 1, args.limit || 30)
      case 'getLeaderboards':
        return Api.leaderboard?.getBoards ? (await Api.leaderboard.getBoards()).list : []
      case 'getLeaderboardDetail':
        return Api.leaderboard?.getList ? await Api.leaderboard.getList(args.id, args.page) : []
      case 'getHotComment':
        return await Api.comment.getHotComment(args.songInfo, args.page || 1, args.limit || 100)
      case 'getComment':
        return await Api.comment.getComment(args.songInfo, args.page || 1, args.limit || 20)
      case 'recognize':
        return Api.recognize ? await Api.recognize.recognize(args.fp, args.duration) : []
      case 'getAlbumList':
        return Api.singer
          ? await Api.singer.getAlbumList(args.songInfo.albumId, args.page || 1, args.limit || 10)
          : []
    }
  }

  const path = apiName.split('.')
  let fn: any = musicSdk
  for (const p of path) {
    if (fn) fn = fn[p]
  }
  if (typeof fn === 'function') return await fn(args)
  throw new Error(`SDK method ${apiName} not found`)
}

function subscribe(event: string, handler: (payload: any) => void) {
  const unlisten = listen(event, (e) => handler(e.payload))
  return () => {
    unlisten.then((f) => f())
  }
}

const api = {
  minimize: () => invoke('window_minimize'),
  maximize: () => invoke('window_maximize'),
  close: () => invoke('window_close'),
  setMiniMode: (isMini: boolean) => {
    invoke('window_set_mini_mode', { isMini })
  },
  show: () => invoke('window_show'),
  toggleFullscreen: () => {
    console.log('Tauri toggleFullscreen')
  },
  onFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
    return () => {}
  },
  onMusicCtrl: (callback: (event: any, ...args: any[]) => void) => {
    const unlistens: Promise<() => void>[] = []
    const playEvents = ['play', 'pause', 'toggle', 'playPrev', 'playNext', 'volumeDelta', 'seekDelta', 'setPlayMode']
    for (const eventName of playEvents) {
      const u = listen(eventName, (event) => {
        callback({ name: eventName, payload: event.payload })
      })
      unlistens.push(u)
    }
    return () => {
      for (const u of unlistens) {
        u.then(f => f())
      }
    }
  },
  powerSaveBlocker: {
    start: async () => 1,
    stop: async () => true,
  },
  settings: {
    syncCloseToTray: (value: boolean) => {
      invoke('set_config', { key: 'closeToTray', value })
    },
    getCloseToTray: () => invoke('get_config', { key: 'closeToTray', default: true }),
  },
  musicCache: {
    getInfo: async () => ({}),
    clear: async () => {
      await invoke('clear_cache')
    },
    getSize: async () => {
      const bytes: any = await invoke('get_cache_size')
      return sizeFormate(bytes)
    },
  },
  file: {
    readFile: (path: string) => invoke('read_file', { path }),
  },
  download: {
    getTasks: () => invoke('download_get_tasks'),
    pauseTask: (taskId: string) => invoke('download_pause_task', { id: taskId }),
    resumeTask: (taskId: string) => invoke('download_resume_task', { id: taskId }),
    cancelTask: (taskId: string) => invoke('download_cancel_task', { id: taskId }),
    deleteTask: (taskId: string, deleteFile = false) => invoke('download_delete_task', { id: taskId, deleteFile }),
    pauseAllTasks: async () => {
      await invoke('download_pause_all')
    },
    resumeAllTasks: async () => {
      await invoke('download_resume_all')
    },
    retryTask: async (taskId: string) => invoke('download_resume_task', { id: taskId }),
    setMaxConcurrent: async (max: number) => {
      invoke('set_config', { key: 'download.maxConcurrent', value: max })
    },
    getMaxConcurrent: () => invoke('get_config', { key: 'download.maxConcurrent', default: 3 }),
    clearTasks: async (typeStr: string) => {
      await invoke('download_clear_tasks', { typeStr })
    },
    validateFiles: async () => {
      return await invoke('download_validate_files')
    },
    openFileLocation: async (path: string) => {
      await invoke('download_open_file_location', { path })
    },
    onTaskAdded: (callback: (event: any, task: any) => void) =>
      subscribe('download-task-added', (p) => callback(null, p)),
    onTaskProgress: (callback: (event: any, task: any) => void) =>
      subscribe('download-task-progress', (p) => callback(null, p)),
    onTaskStatusChanged: (callback: (event: any, task: any) => void) =>
      subscribe('download-task-status-changed', (p) => callback(null, p)),
    onTaskCompleted: (callback: (event: any, task: any) => void) =>
      subscribe('download-task-completed', (p) => callback(null, p)),
    onTaskError: (callback: (event: any, task: any) => void) =>
      subscribe('download-task-error', (p) => callback(null, p)),
    onTaskDeleted: (callback: (event: any, taskId: string) => void) =>
      subscribe('download-deleted', (p) => callback(null, p)),
    onTasksReset: (callback: (event: any, tasks: any[]) => void) =>
      subscribe('download-tasks-reset', (p) => callback(null, p)),
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
        updateTime: now,
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
      const playlistRes: any = await invoke('db_playlist_get_by_id', {
        id: hashId,
      })
      if (playlistRes) {
        const merged = {
          ...playlistRes,
          ...updates,
          updateTime: new Date().toISOString(),
        }
        await invoke('db_playlist_delete', { id: hashId })
        await invoke('db_playlist_create', { playlist: merged })
      }
      return { success: true }
    },
    updateCover: async (hashId: string, coverImgUrl: string) => {
      await invoke('db_playlist_update_cover', { playlistId: hashId, coverPath: coverImgUrl })
      return { success: true }
    },
    search: async (keyword: string, source?: string) => {
      const list: any[] = await invoke('db_playlist_search', { query: keyword })
      return { success: true, data: list }
    },
    getStatistics: async () => {
      const data = await invoke('db_playlist_get_statistics')
      return { success: true, data }
    },
    exists: async (hashId: string) => {
      const data = await invoke('db_playlist_get_by_id', { id: hashId })
      return { success: true, data: data !== null }
    },
    addSongs: async (hashId: string, songs: any[]) => {
      const added = await invoke('db_playlist_songs_add', {
        playlistId: hashId,
        songs,
      })
      return { success: true, data: added }
    },
    removeSong: async (hashId: string, songmid: string | number) => {
      await invoke('db_playlist_song_remove', {
        playlistId: hashId,
        songmid: String(songmid),
      })
      return { success: true }
    },
    removeSongs: async (hashId: string, songmids: (string | number)[]) => {
      for (const mid of songmids) {
        await invoke('db_playlist_song_remove', {
          playlistId: hashId,
          songmid: String(mid),
        })
      }
      return { success: true }
    },
    clearSongs: async (hashId: string) => {
      await invoke('db_playlist_clear_songs', { playlistId: hashId })
      return { success: true }
    },
    getSongs: async (hashId: string) => {
      const data = await invoke('db_playlist_songs_get', {
        playlistId: hashId,
      })
      return { success: true, data }
    },
    getSongCount: async (hashId: string) => {
      const songs: any = await invoke('db_playlist_songs_get', {
        playlistId: hashId,
      })
      return { success: true, data: songs.length }
    },
    hasSong: async (hashId: string, songmid: string | number) => {
      const songs: any = await invoke('db_playlist_songs_get', {
        playlistId: hashId,
      })
      const exists = songs.some((s: any) => String(s.songmid) === String(songmid))
      return { success: true, data: exists }
    },
    getSong: async (hashId: string, songmid: string | number) => {
      const songs: any = await invoke('db_playlist_songs_get', {
        playlistId: hashId,
      })
      const song = songs.find((s: any) => String(s.songmid) === String(songmid))
      return { success: true, data: song }
    },
    searchSongs: async (hashId: string, keyword: string) => {
      const data = await invoke('db_playlist_search_songs', { playlistId: hashId, query: keyword })
      return { success: true, data }
    },
    getSongStatistics: async (hashId: string) => {
      const data = await invoke('db_playlist_get_song_statistics', { playlistId: hashId })
      return { success: true, data }
    },
    validateIntegrity: async (hashId: string) => ({ success: true }),
    repairData: async (hashId: string) => ({ success: true }),
    forceSave: async (hashId: string) => ({ success: true }),
    reorderSongs: async (hashId: string, songmids: (string | number)[]) => {
      const list = songmids.map(mid => String(mid))
      await invoke('db_playlist_reorder_songs', { playlistId: hashId, songIds: list })
      return { success: true }
    },
    moveSong: async (hashId: string, songmid: string | number, toIndex: number) => {
      await invoke('db_playlist_move_song', { playlistId: hashId, songmid: String(songmid), toIndex })
      return { success: true }
    },
    getFavoritesId: async () => {
      const id = await invoke('get_config', {
        key: 'favoritesHashId',
        default: '',
      })
      return { success: true, data: id || null }
    },
    setFavoritesId: async (id: string) => {
      const ok = await invoke('set_config', {
        key: 'favoritesHashId',
        value: id,
      })
      return { success: ok }
    },
  },
  getUserConfig: () => invoke('get_config', { key: 'userConfig', default: {} }),
  hotkeys: {
    get: async () => ({}),
    set: async () => true,
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
    removeAllListeners: () => {},
  },
  ping: () => {},
  pingService: {
    start: () => {},
    stop: () => {},
  },
  directorySettings: {
    getDirectories: async () => {
      const downloadDir = await invoke('get_config', { key: 'download.dir', default: 'downloads' })
      const cacheDir = await invoke('get_config', { key: 'cache.dir', default: 'cache' })
      return { downloadDir, cacheDir }
    },
    selectCacheDir: async () => {
      const selected = await open({ directory: true, multiple: false })
      return selected || ''
    },
    selectDownloadDir: async () => {
      const selected = await open({ directory: true, multiple: false })
      return selected || ''
    },
    saveDirectories: async (dirs: any) => {
      if (dirs.downloadDir) await invoke('set_config', { key: 'download.dir', value: dirs.downloadDir })
      if (dirs.cacheDir) await invoke('set_config', { key: 'cache.dir', value: dirs.cacheDir })
      return true
    },
    resetDirectories: async () => {
      await invoke('set_config', { key: 'download.dir', value: 'downloads' })
      await invoke('set_config', { key: 'cache.dir', value: 'cache' })
      return true
    },
    openDirectory: async (path: string) => {
      await invoke('open_folder', { path })
    },
    getDirectorySize: async (path: string) => {
      const bytes: any = await invoke('get_folder_size', { path })
      return sizeFormate(bytes)
    },
  },
  localMusic: {
    selectDirs: async () => {
      const selected = await open({ directory: true, multiple: true })
      if (!selected) return []
      return Array.isArray(selected) ? selected : [selected]
    },
    scan: async (dirs: string[]) => {
      return await invoke('local_music_scan', { dirs })
    },
    writeTags: (filePath: string, songInfo: any, tagWriteOptions: any) =>
      invoke('local_music_write_tags', { filePath, songInfo, tagWriteOptions }),
    getDirs: () => invoke('local_music_get_dirs'),
    setDirs: (dirs: string[]) => invoke('local_music_set_dirs', { dirs }),
    getList: () => invoke('local_music_get_list'),
    getUrl: (id: string | number) => invoke('local_music_get_url', { id: String(id) }),
    getUrlById: (id: string | number) => invoke('local_music_get_url', { id: String(id) }),
    clearIndex: () => invoke('local_music_clear_index'),
    getCoverBase64: (songmid: string) => invoke('local_music_get_cover', { songmid }),
    getCoversBase64: (trackIds: string[]) => invoke('local_music_get_covers', { trackIds }),
    getTags: (songmid: string, includeLyrics = false) =>
      invoke('local_music_get_tags', { songmid, includeLyrics }),
    getLyric: (songmid: string) => invoke('local_music_get_lyric', { songmid }),
    onScanProgress: (callback: (processed: number, total: number) => void) => {
      const unlisten = listen('local-music:scan-progress', (event: any) =>
        callback(event.payload.processed, event.payload.total),
      )
      return () => {
        unlisten.then((f) => f())
      }
    },
    onScanFinished: (callback: (resList: any[]) => void) => {
      const unlisten = listen('local-music:scan-finished', (event: any) =>
        callback(Array.isArray(event.payload) ? event.payload : []),
      )
      return () => {
        unlisten.then((f) => f())
      }
    },
    removeScanProgress: () => {},
    removeScanFinished: () => {},
    batchMatch: async () => ({
      success: false,
      code: 'UNSUPPORTED_TAURI_PHASE_1',
      message: '批量识别匹配暂未迁移到 Tauri',
    }),
    onBatchMatchProgress: () => () => {},
    onBatchMatchFinished: () => () => {},
    removeBatchMatchListeners: () => {},
  },
  pluginNotice: {
    onPluginNotice: (callback: (data: any) => void) => subscribe('plugin-notice', (p) => callback(p)),
    onPluginThrottle: (callback: (data: any) => void) => subscribe('plugin-throttle', (p) => callback(p)),
    onPluginDisabled: (callback: (data: any) => void) => subscribe('plugin-disabled', (p) => callback(p)),
  },
  systemAudio: {
    prepareCapture: async () => '',
    getDefaultScreenSourceId: async () => '',
  },
  share: {
    getPluginCodeAndMd5: async () => ({ error: 'Not supported' }),
    onShareOpen: (callback: (payload: { id: string }) => void) => subscribe('share-open', (p) => callback(p)),
    onPlaylistShareOpen: (callback: (payload: { id: string }) => void) =>
      subscribe('playlist-share-open', (p) => callback(p)),
    getPending: async () => invoke('get_pending_share_ids'),
    getPendingPlaylistShares: async () => invoke('get_pending_playlist_share_ids'),
  },
  listenTogether: {
    onShareOpen: (callback: (payload: { code: string }) => void) =>
      subscribe('lt-share-open', (p) => callback(p)),
    getPendingCodes: async () => invoke('get_pending_lt_codes'),
  },
  clipboard: {
    readText: async () => {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return ''
      }
    },
  },
  thumbar: {
    setState: () => {},
    setCover: () => {},
    onToggleLike: () => () => {},
  },
  app: {
    getVersion: () => invoke('get_app_version'),
    setTitle: (title: string) => invoke('window_set_title', { title }),
    setProgress: () => {},
  },
  desktopLyric: {
    getOption: () => invoke('get_desktop_lyric_option'),
    setOption: (option: any, callback = false) => invoke('set_desktop_lyric_option', { option, callback }),
    getLockState: () => invoke('get_lyric_lock_state'),
    getOpenState: () => invoke('get_lyric_open_state'),
    getWindowBounds: () => invoke('get_window_bounds'),
    saveWindowBounds: (bounds: any) => invoke('save_window_bounds', { bounds }),
    setBounds: (x: number, y: number, w: number, h: number) => invoke('lyric_window_set_bounds', { x, y, w, h }),
    setHeight: (height: number) => invoke('lyric_window_set_height', { height }),
    setLock: (isLock: boolean) => invoke('lyric_window_set_lock', { isLock }),
    close: () => invoke('lyric_window_close'),
    ready: () => invoke('lyric_window_ready'),
    sendToMain: (name: string, ...args: any[]) => invoke('lyric_window_send_to_main', { name, args }),
  },
  music: {
    requestSdk: async (apiName: string, args: any) => {
      const pluginResult = await tryPluginMusicSdk(apiName, args)
      if (pluginResult !== PLUGIN_NO_MATCH) return pluginResult
      return await runBuiltinMusicSdk(apiName, args)
    },
    invoke: async (channel: string, ...args: any[]) => {
      console.log('music.invoke:', channel, args)
    },
  },
  plugins: {
    selectAndAddPlugin: async (type: 'lx' | 'cr') => {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: 'Plugin', extensions: ['js', 'zip'] },
          { name: 'JavaScript', extensions: ['js'] },
          { name: 'Zip', extensions: ['zip'] },
        ],
      })
      if (!selected) return { canceled: true }
      const path = Array.isArray(selected) ? selected[0] : selected
      const raw = await invoke('plugin_select_and_add', {
        pluginType: type,
        path,
      })
      return await finalizePluginInstall(raw, type)
    },
    downloadAndAddPlugin: async (url: string, type: 'lx' | 'cr', targetPluginId?: string) => {
      const raw = await invoke('plugin_download_and_add', {
        url,
        pluginType: type,
        targetPluginId,
      })
      return await finalizePluginInstall(raw, type)
    },
    addPlugin: async (pluginCode: string, pluginName: string, targetPluginId?: string) => {
      const id = targetPluginId || uuidv4().replace(/-/g, '')
      await invoke('plugin_save', {
        id,
        code: pluginCode,
        name: pluginName,
        metadata: { importType: 'cr' },
      })
      return await finalizePluginInstall(
        {
          success: true,
          pluginId: id,
          code: pluginCode,
          metadata: { pluginName, importType: 'cr' },
        },
        'cr',
      )
    },
    getPluginById: async (id: string) => {
      const list: any = await invoke('plugin_load_all')
      const plugin = list.find((p: any) => (p.pluginId || p.id) === id)
      return plugin
    },
    loadAllPlugins: async () => {
      const list: any = await invoke('plugin_load_all')
      const result = []
      for (const p of list) {
        const pluginId = p.pluginId || p.id
        const pluginExports = loadPluginSandbox(
          pluginId,
          p.code,
          p.metadata?.importType || 'cr',
          p.metadata || {},
        )
        if (!pluginExports) continue
        await persistRuntimeMetadata(pluginId)
        const metadata = loadedPluginMetadata[pluginId]
        result.push({
          pluginId,
          pluginName: metadata.pluginName || p.name || pluginId,
          pluginInfo: metadata.pluginInfo,
          supportedSources: metadata.supportedSources,
          pluginType: metadata.pluginType,
          disabled: !!metadata.disabled,
        })
      }
      return result
    },
    uninstallPlugin: async (pluginId: string) => {
      await invoke('plugin_delete', { id: pluginId })
      delete loadedPluginExports[pluginId]
      delete loadedPluginMetadata[pluginId]
      delete loadedPluginCodes[pluginId]
      return { success: true }
    },
    getPluginLog: async (pluginId: string) => await invoke('plugin_get_log', { id: pluginId }),
    getPluginType: async (pluginId: string) => {
      await ensurePluginRuntime(pluginId)
      return {
        data: loadedPluginMetadata[pluginId]?.pluginType || 'music-source',
      }
    },
    getConfigSchema: async (pluginId: string) => {
      const pluginExports = await ensurePluginRuntime(pluginId)
      const schema =
        typeof pluginExports?.getConfigSchema === 'function'
          ? await callPluginMethod(pluginExports, pluginExports.getConfigSchema, [])
          : pluginExports?.configSchema || loadedPluginMetadata[pluginId]?.configSchema || []
      return { data: Array.isArray(schema) ? schema : [] }
    },
    getConfig: async (pluginId: string) => {
      const data = await getPluginConfigValue(pluginId)
      return { success: true, data }
    },
    saveConfig: async (pluginId: string, config: any) => {
      await invoke('plugin_save_config', { id: pluginId, config })
      return { success: true }
    },
    testConnection: async (pluginId: string) => {
      const pluginExports = await ensurePluginRuntime(pluginId)
      if (!pluginExports || typeof pluginExports.testConnection !== 'function') {
        return { success: false, message: '插件未实现测试连接' }
      }
      try {
        const config = await getPluginConfigValue(pluginId)
        const result = await callPluginMethod(pluginExports, pluginExports.testConnection, [config])
        if (typeof result === 'boolean')
          return { success: result, message: result ? '连接成功' : '连接失败' }
        return result || { success: true, message: '连接成功' }
      } catch (e: any) {
        return { success: false, message: e?.message || String(e) }
      }
    },
    getPlaylists: async (pluginId: string) => {
      const pluginExports = await ensurePluginRuntime(pluginId)
      if (!pluginExports || typeof pluginExports.getPlaylists !== 'function') {
        return { error: '插件未实现获取歌单' }
      }
      try {
        const config = await getPluginConfigValue(pluginId)
        const result = await callPluginMethod(pluginExports, pluginExports.getPlaylists, [config])
        return { data: normalizeServicePlaylists(result) }
      } catch (e: any) {
        return { error: e?.message || String(e) }
      }
    },
    getPlaylistSongs: async (pluginId: string, playlistId: string) => {
      const pluginExports = await ensurePluginRuntime(pluginId)
      if (!pluginExports || typeof pluginExports.getPlaylistSongs !== 'function') {
        return { error: '插件未实现获取歌单歌曲' }
      }
      try {
        const config = await getPluginConfigValue(pluginId)
        const result = await callPluginMethod(pluginExports, pluginExports.getPlaylistSongs, [
          config,
          playlistId,
        ])
        return { data: normalizeServiceSongs(result, pluginId) }
      } catch (e: any) {
        return { error: e?.message || String(e) }
      }
    },
    importToLocal: async (pluginId: string, playlistId: string, playlistName: string) => {
      const songsRes = await api.plugins.getPlaylistSongs(pluginId, playlistId)
      if (songsRes?.error) return songsRes
      const songs = getServiceSongArray(songsRes)
      if (songs.length === 0) return { error: '歌单为空或获取失败' }
      const playlistRes = await api.songList.create(
        playlistName || 'Imported Playlist',
        '从服务插件导入',
        'local',
        { importedFrom: pluginId, remotePlaylistId: playlistId },
      )
      const localPlaylistId = playlistRes?.data?.id
      if (!localPlaylistId) return { error: '创建本地歌单失败' }
      const addedRes = await api.songList.addSongs(localPlaylistId, songs)
      return {
        success: true,
        data: {
          songListId: localPlaylistId,
          playlistId: localPlaylistId,
          added: addedRes?.data ?? songs.length,
          total: songs.length,
        },
      }
    },
    getServiceLyric: async (pluginId: string, songInfo: any) => {
      const pluginExports = await ensurePluginRuntime(pluginId)
      if (!pluginExports) return { data: { lyric: songInfo?.lrc || '' } }
      const config = await getPluginConfigValue(pluginId)
      try {
        const method = pluginExports.getServiceLyric || pluginExports.getLyric
        if (typeof method !== 'function') return { data: { lyric: songInfo?.lrc || '' } }
        const result = await callPluginMethod(pluginExports, method, [config, songInfo])
        return {
          data: pickLyricPayload(await normalizeMaybePromiseResult(result)),
        }
      } catch (e: any) {
        return {
          error: e?.message || String(e),
          data: { lyric: songInfo?.lrc || '' },
        }
      }
    },
    onDeepLinkAdd: (callback: (payload: any) => void) => subscribe('plugin-notice', (p) => callback(p)),
  },
  ai: {
    ask: async () => '',
    askStream: async () => '',
    onStreamChunk: () => {},
    onStreamEnd: () => {},
    onStreamError: () => {},
    removeStreamListeners: () => {},
  },
  registry: {
    cleanAUMID: async () => {},
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
    onPositionChanged: () => () => {},
  },
}

// Assign to global window object
// @ts-ignore
window.api = api
