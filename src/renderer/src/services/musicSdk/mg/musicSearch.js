import CryptoJS from 'crypto-js'
import { sizeFormate, formatPlayTime } from '../../index'
import { formatSingerName } from '../utils'
import { createHttpFetch } from './utils'

export function createSignature(timestamp, keyword) {
  const deviceId = '00000000000000000000000000000000'
  const appId = '20421003'
  const key = '6c429ef99709244'
  const sign = CryptoJS.MD5(keyword + appId + deviceId + timestamp + key).toString()
  return {
    deviceId,
    sign
  }
}

const SEARCH_SWITCH = JSON.stringify({
  song: 1,
  album: 0,
  singer: 0,
  tagSong: 0,
  mvSong: 0,
  bestShow: 0,
  songlist: 0,
  lyricSong: 0
})

const pickImg = (imgItems) => {
  return imgItems?.find((i) => i.imgSizeType === '0102')?.img
    || imgItems?.find((i) => i.imgSizeType === '0103')?.img
    || imgItems?.[0]?.img
    || ''
}

const parseTypes = (formats) => {
  const types = []
  const _types = {}
  const typeMap = { PQ: '128k', HQ: '320k', SQ: 'flac', ZQ: 'flac24bit' }
  formats?.forEach((fmt) => {
    const type = typeMap[fmt.formatType]
    const size = sizeFormate(fmt.size ?? fmt.androidSize ?? 0)
    if (type && size && size !== '0 B') {
      types.push({ type, size })
      _types[type] = { size }
    }
  })
  return { types, _types }
}

const handleSearchResult = (rawList) => {
  const ids = new Set()
  const list = []

  rawList.forEach((item) => {
    if (!item.id || ids.has(item.id)) return
    ids.add(item.id)

    const { types, _types } = parseTypes(item.newRateFormats || item.rateFormats)
    const img = pickImg(item.imgItems)

    list.push({
      singer: formatSingerName(item.singers, 'name'),
      name: item.name || '',
      albumName: item.albums?.[0]?.name || '',
      albumId: item.albums?.[0]?.id || '',
      songmid: item.id,
      copyrightId: item.copyrightId,
      source: 'mg',
      interval: item.duration ? formatPlayTime(parseInt(item.duration) || 0) : null,
      img,
      lrc: null,
      lrcUrl: item.lyricUrl,
      mrcUrl: item.mrcurl,
      trcUrl: item.trcUrl,
      otherSource: null,
      types,
      _types,
      typeUrl: {}
    })
  })
  return list
}

const musicSearch = {
  createSignature,
  limit: 20,
  total: 0,
  page: 0,
  allPage: 1,

  search(str, page = 1, limit) {
    if (limit == null) limit = this.limit
    const url =
      `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do` +
      `?ua=Android_migu&version=5.0.1` +
      `&text=${encodeURIComponent(str)}` +
      `&pageNo=${page}&pageSize=${limit}` +
      `&searchSwitch=${encodeURIComponent(SEARCH_SWITCH)}`

    return createHttpFetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
        channel: '0146921'
      }
    }).then((body) => {
      if (body?.code !== '000000' || !body.songResultData) {
        return { list: [], allPage: 1, limit, total: 0, source: 'mg' }
      }

      const rawList = body.songResultData.result || []
      const list = handleSearchResult(rawList)
      const total = parseInt(body.songResultData.totalCount) || 0

      return {
        list,
        allPage: Math.max(1, Math.ceil(total / limit)),
        limit,
        total,
        source: 'mg'
      }
    })
  }
}

export default musicSearch
