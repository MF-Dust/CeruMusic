import { formatPlayTime, sizeFormate } from '../../index'
import { formatSingerName } from '../utils'
import { signRequest } from './utils'
import { httpFetch } from '../../request'

export default {
  limit: 50,
  total: 0,
  page: 0,
  allPage: 1,
  successCode: 0,
  musicSearch(str, page, limit, retryNum = 0) {
    if (retryNum > 5) return Promise.reject(new Error('搜索失败'))
    const searchRequest = signRequest({
      comm: {
        ct: '11',
        cv: '14090508',
        v: '14090508',
        tmeAppID: 'qqmusic',
        phonetype: 'EBG-AN10',
        deviceScore: '553.47',
        devicelevel: '50',
        newdevicelevel: '20',
        rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
        os_ver: '12',
        OpenUDID: '0',
        OpenUDID2: '0',
        QIMEI36: '0',
        udid: '0',
        chid: '0',
        aid: '0',
        oaid: '0',
        taid: '0',
        tid: '0',
        wid: '0',
        uid: '0',
        sid: '0',
        modeSwitch: '6',
        teenMode: '0',
        ui_mode: '2',
        nettype: '1020',
        v4ip: ''
      },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          search_type: 0,
          searchid: this.getSearchId(),
          query: str,
          page_num: page,
          num_per_page: limit,
          highlight: 0,
          nqc_flag: 0,
          multi_zhida: 0,
          cat: 2,
          grp: 1,
          sin: 0,
          sem: 0
        }
      }
    })
    return searchRequest.promise.then(({ body }) => {
      const reqData = body?.req?.data
      const reqSuccess =
        body?.req?.code === this.successCode || (reqData && reqData.code === this.successCode)
      if (body.code !== this.successCode || !reqSuccess)
        return this.musicSearch(str, page, limit, ++retryNum)
      return reqData || body.req.data
    })
  },
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  },
  getSearchId() {
    const e = this.randomInt(1, 20)
    const t = Number(e * Number('18014398509481984').toFixed())
    const n = this.randomInt(0, 4194304) * 4294967296
    const a = Date.now()
    const r = Math.round(a * 1000) % (24 * 60 * 60 * 1000)
    return String(t + n + r)
  },
  handleResult(rawList) {
    const list = []
    rawList.forEach((item) => {
      if (!item.file?.media_mid) return

      let types = []
      let _types = {}
      const file = item.file
      if (file.size_128mp3 !== 0) {
        let size = sizeFormate(file.size_128mp3)
        types.push({ type: '128k', size })
        _types['128k'] = {
          size
        }
      }
      if (file.size_320mp3 !== 0) {
        let size = sizeFormate(file.size_320mp3)
        types.push({ type: '320k', size })
        _types['320k'] = {
          size
        }
      }
      if (file.size_flac !== 0) {
        let size = sizeFormate(file.size_flac)
        types.push({ type: 'flac', size })
        _types.flac = {
          size
        }
      }
      if (file.size_hires !== 0) {
        let size = sizeFormate(file.size_hires)
        types.push({ type: 'hires', size })
        _types.hires = {
          size
        }
      }
      if (file.size_new[1] !== 0) {
        let size = sizeFormate(file.size_new[1])
        types.push({ type: 'atmos', size })
        _types.atmos = {
          size
        }
      }
      if (file.size_new[2] !== 0) {
        let size = sizeFormate(file.size_new[2])
        types.push({ type: 'atmos_plus', size })
        _types.atmos_plus = {
          size
        }
      }
      if (file.size_new[0] !== 0) {
        let size = sizeFormate(file.size_new[0])
        types.push({ type: 'master', size })
        _types.master = {
          size
        }
      }

      let albumId = ''
      let albumName = ''
      if (item.album) {
        albumName = item.album.name
        albumId = item.album.mid
      }
      list.push({
        singer: formatSingerName(item.singer, 'name'),
        name: item.name + (item.title_extra ?? ''),
        albumName,
        albumId,
        source: 'tx',
        interval: formatPlayTime(item.interval),
        songId: item.id,
        albumMid: item.album?.mid ?? '',
        strMediaMid: item.file.media_mid,
        songmid: item.mid,
        img:
          albumId === '' || albumId === '空'
            ? item.singer?.length
              ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
              : ''
            : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
        types,
        _types,
        typeUrl: {}
      })
    })
    return list
  },
  searchByLuoyue(str, page, limit) {
    const request = httpFetch(
      `https://api.vkeys.cn/music/tencent/search/song?keyword=${encodeURIComponent(str)}&page=${page}&limit=${limit}`,
      { method: 'get' }
    )
    return request.promise.then(({ body }) => {
      if (body?.code !== this.successCode || !Array.isArray(body?.data?.list)) {
        throw new Error(body?.message || '落月API搜索失败')
      }
      const list = body.data.list.map((item) => {
        const albumMid = item.albumMID || ''
        const cover = item.albumImage || item.cover || ''
        return {
          singer: item.singer || formatSingerName(item.singerList || [], 'name'),
          name: item.title + (item.subtitle ? ` (${item.subtitle})` : ''),
          albumName: item.album || '',
          albumId: albumMid,
          source: 'tx',
          interval: formatPlayTime(Number(item.interval) || 0),
          songId: item.songID,
          albumMid,
          strMediaMid: item.mediaMid || item.songMID,
          songmid: item.songMID,
          img: cover,
          types: [],
          _types: {},
          typeUrl: {}
        }
      })
      const total = Number(body.data.meta?.total) || list.length
      return {
        list,
        allPage: Math.max(1, Math.ceil(total / limit)),
        limit,
        total,
        source: 'tx'
      }
    })
  },
  search(str, page = 1, limit) {
    if (limit == null) limit = this.limit
    return this.musicSearch(str, page, limit).then((result) => {
      const data = result.body ? result : result.data || result
      const list = this.handleResult(data.body?.item_song || data.item_song || [])
      const meta = data.meta || data.body?.meta || {}
      if (!list.length) return this.searchByLuoyue(str, page, limit)

      this.total = meta.estimate_sum || list.length
      this.page = page
      this.allPage = Math.ceil(this.total / limit)

      return Promise.resolve({
        list,
        allPage: this.allPage,
        limit,
        total: this.total,
        source: 'tx'
      })
    }).catch(() => this.searchByLuoyue(str, page, limit))
  }
}
