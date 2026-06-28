import { httpFetch } from '../../request'

// QQ 音乐歌词接口返回 base64 编码（UTF-8）的 LRC 文本。
const decodeBase64Utf8 = (str) => {
  try {
    return new TextDecoder('utf-8').decode(Uint8Array.from(atob(str), (c) => c.charCodeAt(0)))
  } catch {
    return ''
  }
}

// 兼容 JSONP 包裹（MusicJsonCallback(...)）与纯 JSON。
const parseBody = (body) => {
  if (body && typeof body === 'object') return body
  let text = String(body || '').trim()
  const m = text.match(/^[\w$]+\(([\s\S]*)\);?$/)
  if (m) text = m[1]
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export default function getLyric(songInfo) {
  const songmid = songInfo?.songmid || songInfo?.songId || songInfo?.id || ''
  const requestObj = httpFetch(
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}` +
      `&pcachetime=${Date.now()}&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8` +
      `&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0&format=json`,
    {
      headers: {
        Referer: 'https://y.qq.com/portal/player.html',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
      }
    }
  )
  return {
    promise: requestObj.promise.then(({ body }) => {
      const data = parseBody(body)
      return {
        lyric: decodeBase64Utf8(data?.lyric || ''),
        tlyric: decodeBase64Utf8(data?.trans || '')
      }
    })
  }
}
