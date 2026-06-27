import { httpFetch } from '../../../request'
import { eapi } from './crypto'

export function eapiRequest(url, data) {
  const eapiData = eapi(url, data)
  const requestObj = httpFetch('https://interface3.music.163.com/eapi/', {
    method: 'post',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.124 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    form: {
      params: eapiData.params
    }
  })
  return requestObj
}
