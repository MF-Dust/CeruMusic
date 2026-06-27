import hotSearch from './hotSearch'
import musicSearch from './musicSearch'

const tx = {
  hotSearch,
  musicSearch,
  tipSearch: { search: () => Promise.resolve([]) },
  leaderboard: { getBoards: () => Promise.resolve([]) },
  songList: {
    getTags: () => Promise.resolve({ hotTag: [], tags: [] }),
    getList: () => Promise.resolve({ list: [], total: 0 })
  },
  comment: { getComments: () => Promise.resolve([]) },
  singer: { getSongs: () => Promise.resolve([]) },
  getLyric: () => Promise.resolve(''),
  getPic: () => Promise.resolve(''),
  getMusicDetailPageUrl: () => ''
}

export default tx
