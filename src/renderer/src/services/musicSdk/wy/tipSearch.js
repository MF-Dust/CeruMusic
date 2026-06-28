import { httpFetch } from '../../request'

function normalizeKeyword(keyword) {
  return String(keyword || '').trim()
}

function pickArray(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.songs)) return value.songs
  if (Array.isArray(value?.artists)) return value.artists
  if (Array.isArray(value?.albums)) return value.albums
  if (Array.isArray(value?.playlists)) return value.playlists
  return []
}

function normalizeItem(item) {
  if (!item) return null
  return {
    ...item,
    name: item.name || item.keyword || item.sname || item.alname || item.playlistname || '',
    id: item.id ?? item.ressourceId ?? item.resourceId ?? item.searchWord ?? '',
  }
}

async function requestTipSearch(keyword) {
  const kw = normalizeKeyword(keyword)
  if (!kw) {
    return { order: [], songs: [], artists: [], albums: [], playlists: [] }
  }

  const requestObj = httpFetch('https://music.163.com/api/search/suggest/web', {
    method: 'get',
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36'
    },
    form: {
      s: kw
    }
  })
  const { body, statusCode } = await requestObj.promise
  if (statusCode !== 200 || !body || body.code !== 200) return null
  return body.result || body.data || body
}

export default {
  async search(keyword) {
    const result = await requestTipSearch(keyword).catch(() => null)
    if (!result) {
      return { order: [], songs: [], artists: [], albums: [], playlists: [] }
    }

    const songs = pickArray(result.songs).map(normalizeItem).filter(Boolean)
    const artists = pickArray(result.artists).map(normalizeItem).filter(Boolean)
    const albums = pickArray(result.albums).map(normalizeItem).filter(Boolean)
    const playlists = pickArray(result.playlists).map(normalizeItem).filter(Boolean)

    const order = []
    if (songs.length) order.push('songs')
    if (artists.length) order.push('artists')
    if (albums.length) order.push('albums')
    if (playlists.length) order.push('playlists')

    return {
      order,
      songs,
      artists,
      albums,
      playlists
    }
  }
}
