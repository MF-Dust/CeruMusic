// 把后端（托盘菜单 / 全局快捷键）发出的 Tauri 播放事件，转发到渲染端的
// `global-music-control` 事件总线（由 globaPlayList.ts 的 onGlobalCtrl 消费）。
//
// 迁移到 Tauri 后，托盘与全局快捷键只能 emit Tauri 事件，而播放控制逻辑监听的是
// window CustomEvent，因此需要这层桥接，否则托盘/快捷键的播放控制不会生效。

let unsub: (() => void) | null = null

export function installTauriMediaBridge(): void {
  if (unsub) return
  const api = (window as any).api
  if (!api?.onMusicCtrl) return
  unsub = api.onMusicCtrl((evt: any) => {
    const name = evt?.name
    if (!name) return
    const val = evt?.payload
    window.dispatchEvent(new CustomEvent('global-music-control', { detail: { name, val } }))
  })
}

export function uninstallTauriMediaBridge(): void {
  if (unsub) {
    try {
      unsub()
    } catch {}
    unsub = null
  }
}
