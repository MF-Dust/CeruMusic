import { httpFetch } from '../../request'
import { formatPlayCount, formatPlayTime, sizeFormate } from '../../index'

const headers = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  Referer: 'https://m.kugou.com/'
}

const normalizeImg = (url, size = 400) =>
  String(url || '')
    .replace('{size}', size)
    .replace(/^http:\/\//, 'https://')

const parseJson = (body) => {
  if (!body) return null
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {}
  const match =
    /var\s+data\s*=\s*(\[[\s\S]*?\]);/.exec(body) ||
    /var\s+specialData\s*=\s*(\{[\s\S]*?\});/.exec(body) ||
    /var\s+specialInfo\s*=\s*(\{[\s\S]*?\});/.exec(body)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return Function(`"use strict";return (${match[1]})`)()
  }
}

const splitFilename = (filename = '') => {
  const [singer, ...nameParts] = String(filename).split(' - ')
  if (!nameParts.length) return { singer: '', name: singer }
  return { singer, name: nameParts.join(' - ') }
}

const songImg = (item) =>
  normalizeImg(
    item.trans_param?.union_cover ||
      item.union_cover ||
      item.img ||
      item.image ||
      (item.album_id ? `https://imgess.kugou.com/uploadpic/sofcover/${item.album_id}/400.jpg` : '')
  )

const mapSong = (item) => {
  const hash = item.hash || item.FileHash || ''
  const songmid = String(item.audio_id || item.ID || hash)
  if (!songmid && !hash) return null

  const types = []
  const _types = {}
  const addType = (type, sizeRaw) => {
    const size = sizeRaw ? sizeFormate(Number(sizeRaw)) : ''
    types.push({ type, size })
    _types[type] = { size }
  }

  if (hash || item.filesize || item.FileSize) addType('128k', item.filesize || item.FileSize)
  if (item['320hash'] || item.HQFileHash || item['320filesize'] || item.HQFileSize) {
    addType('320k', item['320filesize'] || item.HQFileSize)
  }
  if (item.sqhash || item.SQFileHash || item.sqfilesize || item.SQFileSize) {
    addType('flac', item.sqfilesize || item.SQFileSize)
  }

  const parsed = splitFilename(item.filename || item.FileName || item.SongName || '')
  return {
    singer: item.SingerName || item.singername || parsed.singer || '',
    name: item.SongName || item.songname || parsed.name || '',
    albumName: item.remark || item.album_name || '',
    albumId: String(item.album_id || item.AlbumID || ''),
    source: 'kg',
    interval: formatPlayTime(Number(item.duration || item.Duration) || 0),
    songmid,
    hash,
    img: songImg(item),
    lrc: null,
    types,
    _types,
    typeUrl: {}
  }
}

const hotTags = [
  { id: '', name: '热门', source: 'kg' },
  { id: '经典', name: '经典', source: 'kg' },
  { id: '国语', name: '国语', source: 'kg' },
  { id: '怀旧', name: '怀旧', source: 'kg' }
]

const tags = [
  {
    name: '酷狗',
    list: [
      { id: '经典', name: '经典', source: 'kg' },
      { id: '国语', name: '国语', source: 'kg' },
      { id: '怀旧', name: '怀旧', source: 'kg' },
      { id: '精选', name: '精选', source: 'kg' },
      { id: '粤语', name: '粤语', source: 'kg' },
      { id: '网络', name: '网络', source: 'kg' }
    ]
  }
]

export default {
  _requestObj_list: null,
  limit_list: 30,
  limit_song: 10,
  sortList: [{ name: '热门', id: 'hot' }],

  filterList(rawData = []) {
    return rawData.map((item) => ({
      play_count: item.play_count_text || formatPlayCount(item.playcount || 0),
      id: String(item.specialid),
      author: item.username || item.nickname || '',
      name: item.specialname || '',
      time: item.publishtime || '',
      img: normalizeImg(item.imgurl || ''),
      total: Number(item.songcount) || 0,
      desc: item.intro || '',
      source: 'kg'
    }))
  },

  getList(sortId, tagId, page = 1, limit = this.limit_list, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    if (this._requestObj_list) this._requestObj_list.cancelHttp()
    this._requestObj_list = httpFetch('https://m.kugou.com/plist/index&json=true', {
      method: 'get',
      headers
    })
    return this._requestObj_list.promise.then(({ body }) => {
      const data = parseJson(body)
      const all = data?.plist?.list?.info || []
      const filtered = tagId
        ? all.filter((item) =>
            `${item.specialname || ''} ${item.intro || ''} ${(item.tags || [])
              .map((tag) => tag.tagname || tag)
              .join(' ')}`.includes(tagId)
          )
        : all
      const start = (page - 1) * limit
      return {
        list: this.filterList(filtered.slice(start, start + limit)),
        total: Number(data?.plist?.list?.total) || filtered.length,
        page,
        limit,
        source: 'kg'
      }
    })
  },

  getListDetail(id, page = 1, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    id = String(id).replace(/^.+\/plist\/list\/(\d+).*$/, '$1')
    const request = httpFetch(`https://m.kugou.com/plist/list/${id}?json=true&page=${page}`, {
      method: 'get',
      headers
    })
    return request.promise.then(({ body }) => {
      const data = parseJson(body)
      const info = data?.info?.list || data?.specialInfo || data?.specialData || {}
      const rawSongs = data?.list?.list?.info || data?.songs || data?.data || []
      if (!Array.isArray(rawSongs)) return this.getListDetail(id, page, ++tryNum)

      return {
        list: rawSongs.map(mapSong).filter(Boolean),
        page,
        limit: this.limit_song,
        total: Number(data?.list?.list?.total || info.songcount) || rawSongs.length,
        source: 'kg',
        info: {
          play_count: info.play_count_text || formatPlayCount(info.playcount || 0),
          name: info.specialname || '',
          img: normalizeImg(info.imgurl || ''),
          desc: info.intro || '',
          author: info.nickname || info.username || ''
        }
      }
    })
  },

  getTags() {
    return Promise.resolve({ hotTag: hotTags, tags, source: 'kg' })
  },

  getDetailPageUrl(id) {
    return `https://m.kugou.com/plist/list/${id}`
  },

  search(text, page, limit = 20) {
    return this.getList('hot', '', page, this.limit_list).then((res) => {
      const keyword = String(text || '').toLowerCase()
      const list = res.list
        .filter((item) => `${item.name} ${item.desc}`.toLowerCase().includes(keyword))
        .slice(0, limit)
      return {
        ...res,
        limit,
        list: list.length ? list : res.list.slice(0, limit)
      }
    })
  }
}
