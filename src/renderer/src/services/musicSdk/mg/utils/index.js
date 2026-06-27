import { httpFetch } from '../../../request'

export function createHttpFetch(url, options = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.music.migu.cn/',
    ...(options.headers || {})
  }
  
  return httpFetch(url, {
    ...options,
    headers
  })
}
