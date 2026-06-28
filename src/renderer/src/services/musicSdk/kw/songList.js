import { httpFetch } from '../../request'
import { formatPlayCount, formatPlayTime, sizeFormate } from '../../index'
import { parseKuwoJsonLike } from './musicSearch'

const headers = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  Referer: 'https://m.kuwo.cn/'
}

const decodeText = (str) =>
  String(str || '')
    .replace(/\\u002F/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")

const normalizeImg = (url) => decodeText(url).replace(/^http:\/\//, 'https://')

const parseFunctionArguments = (text) => {
  const values = []
  let current = ''
  let inString = false
  let quote = ''
  let escape = false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      current += ch
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      values.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) values.push(current.trim())
  return values
}

const parseValue = (value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (/^"/.test(value) || /^'/.test(value)) {
    try {
      return decodeText(JSON.parse(value.replace(/^'/, '"').replace(/'$/, '"')))
    } catch {
      return decodeText(value.slice(1, -1))
    }
  }
  return value
}

const parseSsrVariables = (html) => {
  const start = html.indexOf('__NUXT__=(function(')
  if (start < 0) return {}
  const paramStart = html.indexOf('(', start) + 1
  const paramEnd = html.indexOf(')', paramStart)
  const callStart = html.lastIndexOf('}(', html.indexOf('</script>', start))
  const callEnd = html.indexOf(');</script>', callStart)
  if (paramStart < 1 || paramEnd < 0 || callStart < 0 || callEnd < 0) return {}

  const params = html
    .slice(paramStart, paramEnd)
    .split(',')
    .map((item) => item.trim())
  const args = parseFunctionArguments(html.slice(callStart + 2, callEnd))
  return Object.fromEntries(params.map((param, index) => [param, parseValue(args[index] || '')]))
}

const getValue = (block, key, vars = {}) => {
  const quoted = new RegExp(`${key}:"((?:\\\\.|[^"\\\\])*)"`).exec(block)
  if (quoted) return decodeText(quoted[1])
  const bare = new RegExp(`${key}:([^,}\\]]+)`).exec(block)
  if (!bare) return ''
  const value = decodeText(bare[1]).replace(/^["']|["']$/g, '')
  return Object.prototype.hasOwnProperty.call(vars, value) ? vars[value] : value
}

const splitObjectBlocks = (text) => {
  const blocks = []
  let start = -1
  let depth = 0
  let inString = false
  let quote = ''
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return blocks
}

const parseEmbeddedMusicList = (html) => {
  const vars = parseSsrVariables(html)
  const listStart = html.indexOf('musicList:[')
  if (listStart < 0) return []
  const arrayStart = html.indexOf('[', listStart)
  const arrayEnd = html.indexOf('],desc:', arrayStart)
  if (arrayStart < 0 || arrayEnd < 0) return []
  return splitObjectBlocks(html.slice(arrayStart + 1, arrayEnd))
    .filter((block) => /musicrid:/.test(block) || /rid:/.test(block))
    .map((block) => ({
      musicrid: getValue(block, 'musicrid', vars),
      rid: getValue(block, 'rid', vars),
      artist: getValue(block, 'artist', vars),
      name: getValue(block, 'name', vars),
      album: getValue(block, 'album', vars),
      albumid: getValue(block, 'albumid', vars),
      duration: Number(getValue(block, 'duration', vars)) || 0,
      pic: getValue(block, 'pic', vars),
      pic120: getValue(block, 'pic120', vars),
      albumpic: getValue(block, 'albumpic', vars),
      hasLossless: /hasLossless:true/.test(block)
    }))
}

const parseMinfoSize = (minfo, level) => {
  const match = new RegExp(`level:${level},[^;]*size:([^,;]+)`, 'i').exec(minfo || '')
  if (!match) return ''
  const sizeText = match[1]
  if (/kb/i.test(sizeText)) return sizeFormate(Number(sizeText.replace(/[^\d.]/g, '')) * 1024)
  if (/mb/i.test(sizeText)) return sizeFormate(Number(sizeText.replace(/[^\d.]/g, '')) * 1024 * 1024)
  return ''
}

const mapSong = (item) => {
  const musicRid = item.musicrid || item.MUSICRID || ''
  const rid = String(item.rid || musicRid.replace(/^MUSIC_/, '') || item.MP3RID || '')
  if (!rid) return null

  const types = []
  const _types = {}
  const minfo = item.N_MINFO || item.MINFO || ''
  const addType = (type, size) => {
    types.push({ type, size })
    _types[type] = { size }
  }
  if (minfo) {
    if (/level:h/.test(minfo)) addType('128k', parseMinfoSize(minfo, 'h'))
    if (/level:p/.test(minfo)) addType('320k', parseMinfoSize(minfo, 'p'))
    if (/level:(ff|z),/.test(minfo)) addType('flac', parseMinfoSize(minfo, 'ff') || parseMinfoSize(minfo, 'z'))
    if (/level:z24/.test(minfo)) addType('hires', parseMinfoSize(minfo, 'z24'))
  } else if (item.hasLossless) {
    addType('128k', '')
    addType('flac', '')
  } else {
    addType('128k', '')
  }

  return {
    singer: decodeText(item.artist || item.ARTIST),
    name: decodeText(item.name || item.SONGNAME || item.NAME),
    albumName: decodeText(item.album || item.ALBUM),
    albumId: String(item.albumid || item.ALBUMID || ''),
    source: 'kw',
    interval: formatPlayTime(Number(item.duration || item.DURATION) || 0),
    songmid: rid,
    img: normalizeImg(item.pic || item.pic120 || item.albumpic || ''),
    lrc: null,
    types,
    _types,
    typeUrl: {}
  }
}

export default {
  _requestObj_list: null,
  limit_list: 30,
  limit_song: 50,
  sortList: [{ name: '最热', id: 'hot' }],
  hotTags: [
    { id: '', name: '热门', source: 'kw' },
    { id: '37', name: '华语', source: 'kw' },
    { id: '155', name: '怀旧', source: 'kw' },
    { id: '1265', name: '经典', source: 'kw' }
  ],
  tags: [
    {
      name: '酷我',
      list: [
        { id: '37', name: '华语', source: 'kw' },
        { id: '38', name: '欧美', source: 'kw' },
        { id: '155', name: '怀旧', source: 'kw' },
        { id: '1265', name: '经典', source: 'kw' },
        { id: '168', name: 'DJ', source: 'kw' },
        { id: '376', name: '开车', source: 'kw' }
      ]
    }
  ],

  filterList(rawData = []) {
    return rawData.map((item) => ({
      play_count: formatPlayCount(item.listencnt || item.playnum || 0),
      id: String(item.id),
      author: item.uname || '',
      name: item.name || item.title || '',
      time: '',
      img: normalizeImg(item.img || item.pic || ''),
      total: Number(item.total) || 0,
      desc: item.desc || item.info || '',
      source: 'kw'
    }))
  },

  getList(sortId, tagId, page = 1, limit = this.limit_list, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    if (this._requestObj_list) this._requestObj_list.cancelHttp()
    const pid = tagId || ''
    this._requestObj_list = httpFetch(
      `https://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?pn=${page}&rn=${limit}&order=${sortId || 'hot'}&pid=${encodeURIComponent(pid)}`,
      { method: 'get', headers: { ...headers, Referer: 'https://www.kuwo.cn/' } }
    )
    return this._requestObj_list.promise.then(({ body }) => {
      if (body?.code !== 200) return this.getList(sortId, tagId, page, limit, ++tryNum)
      return {
        list: this.filterList(body.data?.data || []),
        total: Number(body.data?.total) || 0,
        page,
        limit,
        source: 'kw'
      }
    })
  },

  async getListDetail(rawId, page = 1) {
    const id = String(rawId).replace(/^.+\/playlist_detail\/(\d+).*$/, '$1')
    const url =
      `https://m.kuwo.cn/newh5app/wapi/api/www/playlist/playListInfo` +
      `?pid=${id}&pn=${page}&rn=${this.limit_song}` +
      `&ua=${encodeURIComponent(headers['User-Agent'])}&ip=`
    const request = httpFetch(url, {
      method: 'get',
      headers: { ...headers, Referer: `https://m.kuwo.cn/newh5app/playlist_detail/${id}` }
    })
    const data = await request.promise.then(({ body }) => body).catch(() => null)
    if (data?.code === 200 && data?.data) {
      return {
        list: (data.data.musicList || []).map(mapSong).filter(Boolean),
        page,
        limit: this.limit_song,
        total: Number(data.data.total) || 0,
        source: 'kw',
        info: {
          play_count: formatPlayCount(data.data.listencnt || 0),
          name: data.data.name || '',
          img: normalizeImg(data.data.img500 || data.data.img300 || data.data.img || ''),
          desc: data.data.info || data.data.desc || '',
          author: data.data.userName || data.data.uname || ''
        }
      }
    }

    const htmlRequest = httpFetch(`https://m.kuwo.cn/newh5app/playlist_detail/${id}`, {
      method: 'get',
      headers
    })
    const { body } = await htmlRequest.promise
    const html = typeof body === 'string' ? body : ''
    const rawSongs = parseEmbeddedMusicList(html)
    const total = Number(/pageData:\{pn:[^,]+,rn:\d+,total:(\d+)\}/.exec(html)?.[1]) || rawSongs.length
    const pageSongs = rawSongs.slice((page - 1) * this.limit_song, page * this.limit_song)

    const infoRequest = httpFetch(
      `https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=0&rn=1&encode=utf-8&keyset=pl2012&identity=kuwo&pcmp4=1`,
      { method: 'get', headers: { ...headers, Referer: 'https://www.kuwo.cn/' } }
    )
    const info = await infoRequest.promise.then(({ body }) => parseKuwoJsonLike(body)).catch(() => null)

    return {
      list: pageSongs.map(mapSong).filter(Boolean),
      page,
      limit: this.limit_song,
      total: total || Number(info?.total) || 0,
      source: 'kw',
      info: {
        play_count: formatPlayCount(info?.playnum || 0),
        name: info?.title || '',
        img: normalizeImg(info?.pic || ''),
        desc: info?.info || '',
        author: info?.uname || ''
      }
    }
  },

  getTags() {
    return Promise.resolve({
      hotTag: this.hotTags,
      tags: this.tags,
      source: 'kw'
    })
  },

  getDetailPageUrl(id) {
    return `https://www.kuwo.cn/playlist_detail/${id}`
  },

  search(text, page, limit = 20) {
    return this.getList('hot', '', page, limit).then((res) => {
      const keyword = String(text || '').toLowerCase()
      const list = res.list.filter((item) => `${item.name} ${item.desc}`.toLowerCase().includes(keyword))
      return {
        ...res,
        list: list.length ? list : res.list
      }
    })
  }
}
