import { httpFetch } from '../../request'

function normalizeList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => String(item?.searchWord || item?.keyword || item?.name || item || '').trim())
    .filter(Boolean)
}

export default {
  async getList() {
    const requestObj = httpFetch('https://music.163.com/weapi/search/hot', {
      method: 'post',
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36'
      },
      body: {
        offset: 0,
        total: true,
        limit: 10
      }
    })
    const { body, statusCode } = await requestObj.promise
    if (statusCode !== 200 || !body) throw new Error('获取热搜词失败')

    const raw = body.data?.list || body.result?.hots || body.result?.hotsSearch || []
    return {
      source: 'wy',
      list: normalizeList(raw)
    }
  }
}
