import { invoke } from '@tauri-apps/api/core'

const DEFAULT_TIMEOUT = 15000
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'

const defaultHeaders = {
  'User-Agent': DEFAULT_USER_AGENT
}

const isPlainObject = (value) =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof FormData)

const encodeForm = (form) => {
  if (typeof form === 'string') return form
  if (form instanceof URLSearchParams) return form.toString()
  if (!isPlainObject(form)) return form
  return new URLSearchParams(form).toString()
}

const appendQuery = (url, params) => {
  if (!params) return url
  const query =
    typeof params === 'string'
      ? params
      : params instanceof URLSearchParams
        ? params.toString()
        : new URLSearchParams(params).toString()
  if (!query) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

export const httpFetch = (url, options = { method: 'get' }) => {
  const obj = {
    isCancelled: false,
    cancelHttp: () => {
      obj.isCancelled = true
    }
  }

  obj.promise = new Promise(async (resolve, reject) => {
    try {
      const method = (options.method || 'GET').toUpperCase()
      const headers = {
        ...defaultHeaders,
        ...(options.headers || {})
      }

      let requestUrl = url
      let body
      if (options.data !== undefined) {
        body = options.data
      } else if (options.body !== undefined) {
        body = options.body
      } else if (options.form !== undefined) {
        body = encodeForm(options.form)
        headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded'
      }

      if ((method === 'GET' || method === 'DELETE') && body !== undefined) {
        requestUrl = appendQuery(requestUrl, body)
        body = undefined
      }

      const tauriOptions = {
        method,
        headers,
        body: body ?? null,
        timeout: options.timeout || DEFAULT_TIMEOUT
      }

      const res = await invoke('tauri_request', {
        url: requestUrl,
        options: tauriOptions
      })
      if (obj.isCancelled) return reject(new Error('已取消'))

      const bodyData = res.body
      resolve({
        statusCode: res.statusCode,
        status: res.statusCode,
        headers: res.headers || {},
        body: bodyData,
        data: bodyData,
        raw: typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData),
        url: res.url || requestUrl
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
