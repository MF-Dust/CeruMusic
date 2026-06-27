import songList from './songList'

const mg = {
  songList,
  tipSearch: { search: () => Promise.resolve([]) },
  leaderboard: { getBoards: () => Promise.resolve([]) },
  musicSearch: { search: () => Promise.resolve({ list: [], total: 0 }) },
  hotSearch: { getList: () => Promise.resolve([]) },
  comment: { getComments: () => Promise.resolve([]) },
  singer: { getSongs: () => Promise.resolve([]) },
  getLyric: () => Promise.resolve(''),
  getPic: () => Promise.resolve(''),
  getMusicDetailPageUrl: () => ''
}

export default mg
