import musicSearch from './musicSearch'

const kw = {
  musicSearch,
  tipSearch: { search: () => Promise.resolve([]) },
  leaderboard: { getBoards: () => Promise.resolve([]) },
  songList: {
    getTags: () => Promise.resolve({ hotTag: [], tags: [] }),
    getList: () => Promise.resolve({ list: [], total: 0 })
  },
  hotSearch: { getList: () => Promise.resolve([]) },
  comment: { getComments: () => Promise.resolve([]) },
  singer: { getSongs: () => Promise.resolve([]) },
  getLyric: () => Promise.resolve(''),
  getPic: () => Promise.resolve(''),
  getMusicDetailPageUrl: () => ''
}

export default kw
