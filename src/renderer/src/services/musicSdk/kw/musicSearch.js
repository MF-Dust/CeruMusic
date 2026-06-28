import { formatPlayTime, sizeFormate } from '../../index'
import { httpFetch } from '../../request'

const decodeHtmlEntities = (str) => {
  if (!str) return ''
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

const parseTypesFromMinfo = (minfo) => {
  const types = []
  const _types = {}
  if (!minfo) return { types, _types }

  // MINFO format: "level:p,bitrate:128,format:mp3,size:5Mb;level:h,bitrate:320,..."
  const entries = minfo.split(';')
  for (const entry of entries) {
    const fields = {}
    entry.split(',').forEach((kv) => {
      const [k, v] = kv.split(':')
      if (k && v) fields[k.trim()] = v.trim()
    })
    const level = fields.level
    const sizeRaw = fields.size
    if (!level) continue

    const parsedSize = sizeRaw ? sizeRaw.replace(/[^\d.]/g, '') : ''
    const size = parsedSize ? sizeFormate(Number(parsedSize) * 1024 * 1024) : ''

    switch (level) {
      case 'p':
        types.push({ type: '128k', size })
        _types['128k'] = { size }
        break
      case 'h':
        types.push({ type: '320k', size })
        _types['320k'] = { size }
        break
      case 'z':
        types.push({ type: 'flac', size })
        _types.flac = { size }
        break
      case 'z24':
        types.push({ type: 'hires', size })
        _types.hires = { size }
        break
    }
  }
  return { types, _types }
}

export default {
  limit: 30,
  total: 0,
  page: 0,
  allPage: 1,

  handleResult(rawList) {
    const list = []
    rawList.forEach((item) => {
      const musicRid = item.MUSICRID || ''
      if (!musicRid) return

      const songmid = musicRid.replace(/^MUSIC_/, '')
      const duration = item.DURATION ? parseInt(item.DURATION, 10) : 0
      const albumId = item.ALBUMID || ''
      const img =
        albumId && albumId !== '0'
          ? `https://img1.kugou.com/album/${albumId}/150.jpg`
          : ''

      const { types, _types } = parseTypesFromMinfo(item.N_MINFO || item.MINFO || '')

      list.push({
        singer: decodeHtmlEntities(item.ARTIST || ''),
        name: decodeHtmlEntities(item.SONGNAME || item.NAME || ''),
        albumName: decodeHtmlEntities(item.ALBUM || ''),
        albumId: albumId || '',
        source: 'kw',
        interval: formatPlayTime(duration),
        songmid,
        img,
        lrc: null,
        types,
        _types,
        typeUrl: {}
      })
    })
    return list
  },

  search(str, page = 1, limit) {
    if (limit == null) limit = this.limit
    const keyword = encodeURIComponent(str)
    const pn = page - 1 // KuWo uses 0-based page index
    const url =
      `https://search.kuwo.cn/r.s` +
      `?all=${keyword}&ft=music&itemset=web_2013&client=kt` +
      `&pn=${pn}&rn=${limit}&rformat=json&encoding=utf8`

    const request = httpFetch(url, { method: 'get' })
    return request.promise.then(({ body }) => {
      let data = body
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return { list: [], allPage: 1, limit, total: 0, source: 'kw' }
        }
      }

      const rawList = data?.abslist || []
      const list = this.handleResult(rawList)
      const total = data?.TOTAL ? parseInt(data.TOTAL, 10) : 0

      return {
        list,
        allPage: Math.max(1, Math.ceil(total / limit)),
        limit,
        total,
        source: 'kw'
      }
    })
  }
}
