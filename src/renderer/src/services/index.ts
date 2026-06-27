export function decodeName(str: string): string {
  if (!str) return ''
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function formatPlayTime(time: number): string {
  if (isNaN(time)) return '00:00'
  const m = Math.floor(time / 60)
  const s = Math.floor(time % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function sizeFormate(size: number): string {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let s = size
  while (s >= 1024 && i < units.length - 1) {
    s /= 1024
    i++
  }
  return `${s.toFixed(2)} ${units[i]}`
}

export function dateFormat(timestamp: number | string | Date, format = 'yyyy-MM-dd HH:mm:ss'): string {
  const date = new Date(timestamp)
  const o: Record<string, number> = {
    'M+': date.getMonth() + 1,
    'd+': date.getDate(),
    'H+': date.getHours(),
    'm+': date.getMinutes(),
    's+': date.getSeconds(),
    'q+': Math.floor((date.getMonth() + 3) / 3),
    S: date.getMilliseconds()
  }
  let fmt = format
  if (/(y+)/.test(fmt)) {
    fmt = fmt.replace(RegExp.$1, (date.getFullYear() + '').substring(4 - RegExp.$1.length))
  }
  for (const k in o) {
    if (new RegExp('(' + k + ')').test(fmt)) {
      fmt = fmt.replace(
        RegExp.$1,
        RegExp.$1.length === 1 ? String(o[k]) : ('00' + o[k]).substring(String(o[k]).length)
      )
    }
  }
  return fmt
}

export function formatPlayCount(num: number | string): string {
  if (!num) return '0'
  const count = Number(num)
  if (count >= 100000000) {
    return `${(count / 100000000).toFixed(1)}亿`
  }
  if (count >= 10000) {
    return `${(count / 1000).toFixed(1)}万`
  }
  return String(count)
}

export function dateFormat2(timestamp: number | string | Date): string {
  return dateFormat(timestamp, 'yyyy-MM-dd')
}

// ponytail: lightweight promise concurrency limiter to replace p-limit
export function pLimit(concurrency: number) {
  const queue: (() => void)[] = []
  let active = 0

  const next = () => {
    active--
    if (queue.length > 0) {
      queue.shift()!()
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++
        fn().then(resolve, reject).finally(next)
      }

      if (active < concurrency) {
        run()
      } else {
        queue.push(run)
      }
    })
  }
}

