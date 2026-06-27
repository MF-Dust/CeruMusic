import axios, { AxiosRequestConfig, AxiosInstance } from 'axios'
import type { Socket } from 'socket.io-client'
import GlobaConfig from '@common/api/config.json'

// 常量定义
const REQUEST_TIMEOUT = 30000
const ERROR_MESSAGES = {
  LOGIN_REMOVED: '账号登录功能已移除',
  REQUEST_FAILED: 'Request failed'
}

// 全局实例缓存
const axiosInstances: Map<string, AxiosInstance> = new Map()

export class Request {
  private resource: string
  private instance: AxiosInstance

  constructor(resource: string = '') {
    this.resource = resource
    this.instance = this.getOrCreateAxiosInstance(resource)
  }

  // 私有方法：获取或创建 Axios 实例
  private getOrCreateAxiosInstance(resource: string): AxiosInstance {
    let instance = axiosInstances.get(resource)
    if (!instance) {
      instance = axios.create({
        baseURL: resource,
        timeout: REQUEST_TIMEOUT
      })
      axiosInstances.set(resource, instance)
    }
    return instance
  }

  // 私有方法：处理响应错误
  private async handleResponseError(error: any): Promise<never> {
    const status = error?.response?.status
    const message = error.response?.data?.message || error.message || ERROR_MESSAGES.REQUEST_FAILED

    // Allow 304 to pass through if caught by axios (though axios usually treats 304 as success if body is empty, sometimes it might be configured otherwise)
    // Actually, if we want to handle 304 manually in the caller, we should rethrow it or return it.
    // But Request class is designed to return T.
    // Let's just rethrow 304 so caller can catch it.
    if (status === 304) {
      throw error
    }

    if (status === 401) {
      throw new Error(ERROR_MESSAGES.LOGIN_REMOVED)
    }

    console.error('Request Error:', error)
    throw new Error(message)
  }

  // 核心请求方法
  async request<T = any>(config: AxiosRequestConfig, returnRaw = false): Promise<T | any> {
    try {
      const finalConfig: AxiosRequestConfig = {
        ...config,
        headers: {
          ...config.headers
        }
      }
      /* dev 切换:从 config.json 的 baseUrl 列表里查 url 等于 this.resource 的条目,
       * 启用 dev 时用 developmentUrl 覆盖 baseURL。与 SocketRequest.resolveBaseURL 同款数据驱动。 */
      const isDev = process.env.NODE_ENV === 'development' && Boolean(GlobaConfig.enableDev)
      if (isDev) {
        const list = (GlobaConfig as { baseUrl?: Array<{ url: string; developmentUrl?: string }> })
          .baseUrl
        const entry = list?.find((e) => e.url === this.resource)
        if (entry?.developmentUrl) {
          finalConfig.baseURL = entry.developmentUrl
        }
      }
      // 设置默认 Content-Type (非 FormData 时)
      if (
        (!finalConfig.headers || !finalConfig.headers['Content-Type']) &&
        !(finalConfig.data instanceof FormData)
      ) {
        finalConfig.headers = finalConfig.headers || {}
        finalConfig.headers['Content-Type'] = 'application/json'
      }

      const response = await this.instance(finalConfig)
      return returnRaw ? response : response.data
    } catch (error: any) {
      return this.handleResponseError(error)
    }
  }

  // 便捷方法：GET
  async get<T = any>(url: string, config?: AxiosRequestConfig, returnRaw = false) {
    return this.request<T>({ ...config, method: 'GET', url }, returnRaw)
  }

  // 便捷方法：POST
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: 'POST', url, data })
  }

  // 便捷方法：PUT
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: 'PUT', url, data })
  }

  // 便捷方法：PATCH
  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: 'PATCH', url, data })
  }

  // 便捷方法：DELETE
  async delete<T = any>(url: string, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: 'DELETE', url })
  }

  // 文件上传方法
  async uploadFile<T = any>(
    url: string,
    file: File,
    fieldName: string = 'file',
    config?: AxiosRequestConfig
  ) {
    const formData = new FormData()
    formData.append(fieldName, file)

    return this.request<T>({
      ...config,
      method: 'PUT',
      url,
      data: formData
    })
  }
}

export const unwrap = async <T>(promise: Promise<any>): Promise<T> => {
  const res = await promise
  if (res && typeof res === 'object' && 'data' in res && 'code' in res) {
    return (res as any).data
  }
  return res
}

/* ============================================================
 *  SocketRequest —— Socket.IO 连接占位封装
 * ============================================================
 *
 * 登录功能移除后不再建立带账号 token 的 Socket.IO 连接。
 * 业务层只需处理 connect() 抛出的错误即可关闭一起听入口。
 */

export interface SocketConnectOptions {
  transports?: string[]
  reconnection?: boolean
  reconnectionAttempts?: number
  reconnectionDelay?: number
  reconnectionDelayMax?: number
  /** 额外注入的 query 参数(例如 nickname) */
  query?: Record<string, string>
}

export class SocketRequest {
  /** namespace 例如 '/lt'。空串表示根命名空间。 */
  private namespace: string
  /** 后端 API resource。登录移除后仅保留构造参数兼容。 */
  private resource: string
  private socket: Socket | null = null

  /**
   * @param namespace Socket.IO namespace,需以 '/' 开头(如 '/lt')。空串则连根。
   * @param resource 后端 API resource。
   */
  constructor(namespace: string, resource: string) {
    this.namespace = namespace.startsWith('/') ? namespace : `/${namespace}`
    if (this.namespace === '/') this.namespace = ''
    this.resource = resource
  }

  /** 当前 socket 实例,未连接则 null */
  get instance(): Socket | null {
    return this.socket
  }

  /**
   * 登录功能已移除，依赖账号鉴权的一起听 socket 不再建立。
   */
  async connect(_options: SocketConnectOptions = {}): Promise<Socket> {
    throw new Error(ERROR_MESSAGES.LOGIN_REMOVED)
  }

  /** 主动断开 + 清理监听 */
  disconnect(): void {
    if (!this.socket) return
    try {
      this.socket.removeAllListeners()
      this.socket.disconnect()
    } catch {}
    this.socket = null
  }
}
