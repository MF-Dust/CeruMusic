import { invoke } from '@tauri-apps/api/core'

export const httpFetch = (url, options = { method: 'get' }) => {
  const obj = {
    isCancelled: false,
    cancelHttp: () => {}
  }

  obj.promise = new Promise(async (resolve, reject) => {
    try {
      const headers = options.headers || {}
      
      // Basic body formatting for Rust
      let body = null
      if (options.data !== undefined) {
        body = options.data
      } else if (options.body !== undefined) {
        body = options.body
      } else if (options.form !== undefined) {
        body = options.form
      }

      const tauriOptions = {
        method: options.method || 'GET',
        headers,
        body,
        timeout: options.timeout || 15000
      }

      const res = await invoke('tauri_request', { url, options: tauriOptions })
      
      resolve({
        data: res.body,
        status: res.statusCode,
        headers: res.headers
      })
    } catch (err) {
      reject(err)
    }
  })

  return obj
}

export const cancelHttp = (requestObj) => {
  if (requestObj && requestObj.cancelHttp) {
    requestObj.cancelHttp()
  }
}
