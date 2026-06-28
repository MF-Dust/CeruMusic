import musicSearch from './musicSearch'
import songList from './songList'

const kw = {
  musicSearch,
  tipSearch: { search: () => Promise.resolve([]) },
  leaderboard: { getBoards: () => Promise.resolve([]) },
  songList,
  hotSearch: { getList: () => Promise.resolve([]) },
  comment: { getComments: () => Promise.resolve([]) },
  singer: { getSongs: () => Promise.resolve([]) },
  getLyric: () => Promise.resolve(''),
  getPic: () => Promise.resolve(''),
  getMusicDetailPageUrl: () => ''
}

export default kw
