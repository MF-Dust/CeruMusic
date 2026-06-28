import { formatPlayTime, sizeFormate } from '../../index'
import { httpFetch } from '../../request'

const decodeHtmlEntities = (str) => {
  if (!str) return ''
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

export default {
  limit: 30,
  total: 0,
  page: 0,
  allPage: 1,

  handleResult(rawList) {
    const list = []
    rawList.forEach((item) => {
      if (!item.FileHash && !item.ID) return

      const types = []
      const _types = {}

      // 128k — always present via FileHash
      if (item.FileHash && item.FileSize) {
        const size = sizeFormate(item.FileSize)
        types.push({ type: '128k', size })
        _types['128k'] = { size }
      }
      // 320k
      if (item.HQFileHash && item.HQFileSize) {
        const size = sizeFormate(item.HQFileSize)
        types.push({ type: '320k', size })
        _types['320k'] = { size }
      }
      // flac
      if (item.SQFileHash && item.SQFileSize) {
        const size = sizeFormate(item.SQFileSize)
        types.push({ type: 'flac', size })
        _types.flac = { size }
      }

      const duration = item.Duration ? Number(item.Duration) : 0
      const albumId = item.AlbumID ? String(item.AlbumID) : ''
      const img = albumId && albumId !== '0'
        ? `https://imgess.kugou.com/uploadpic/sofcover/${albumId}/150.jpg`
        : ''

      list.push({
        singer: item.SingerName || '',
        name: decodeHtmlEntities(item.SongName || item.FileName || ''),
        albumName: '',
        albumId,
        source: 'kg',
        interval: formatPlayTime(duration),
        songmid: String(item.ID),
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
    const url =
      `https://songsearch.kugou.com/song_search_v2` +
      `?keyword=${keyword}&page=${page}&pagesize=${limit}` +
      `&bitrate=0&isfuzzy=0&inputtype=0&platform=WebFilter` +
      `&userid=0&iscorrection=1&privilege_filter=0&appid=1014`

    const request = httpFetch(url, { method: 'get' })
    return request.promise.then(({ body }) => {
      // response may be JSONP-wrapped or plain JSON
      let data = body
      if (typeof data === 'string') {
        try {
          const jsonpMatch = data.match(/^\w+\(([\s\S]+)\)$/)
          data = JSON.parse(jsonpMatch ? jsonpMatch[1] : data)
        } catch {
          return { list: [], allPage: 1, limit, total: 0, source: 'kg' }
        }
      }

      const rawList = data?.data?.lists || []
      const list = this.handleResult(rawList)
      const total = data?.data?.total || 0

      return {
        list,
        allPage: Math.max(1, Math.ceil(total / limit)),
        limit,
        total,
        source: 'kg'
      }
    })
  }
}
