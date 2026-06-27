export function formatSingerName(singers: any, nameKey = 'name'): string {
  if (!singers) return ''
  if (Array.isArray(singers)) {
    return singers
      .map((s) => (typeof s === 'object' ? s[nameKey] : s))
      .filter(Boolean)
      .join('、')
  }
  if (typeof singers === 'object') return singers[nameKey] || ''
  return String(singers)
}

export function dnsLookup(hostname: string, options: any, callback?: any) {
  const cb = typeof options === 'function' ? options : callback
  if (cb) {
    cb(null, hostname, 4)
  }
}
