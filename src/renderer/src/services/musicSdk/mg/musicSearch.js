import CryptoJS from 'crypto-js'

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

const musicSearch = {
  createSignature,
  search(text, page, limit = 20) {
    return Promise.resolve({ list: [], total: 0 })
  }
}

export default musicSearch
