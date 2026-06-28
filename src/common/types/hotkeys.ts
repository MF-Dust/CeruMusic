// 全局快捷键类型定义
// 由设置页 HotkeySection.vue 与 tauri-bridge 的 window.api.hotkeys 共用。

/** 可绑定的快捷键动作 */
export type HotkeyAction =
  | 'toggle' // 播放/暂停
  | 'playPrev' // 上一首
  | 'playNext' // 下一首
  | 'volumeUp' // 音量+
  | 'volumeDown' // 音量-
  | 'seekForward' // 快进
  | 'seekBackward' // 快退

/** 快捷键配置：动作 -> 加速键字符串（如 "CmdOrCtrl+Alt+Right"，空字符串表示未绑定） */
export type HotkeyConfig = Record<HotkeyAction, string>

/** 渲染端提交的配置载荷 */
export interface HotkeyConfigPayload {
  config: HotkeyConfig
}

/** 后端返回的注册状态 */
export interface HotkeyStatus {
  /** 实际注册成功的加速键 */
  registered: string[]
  /** 注册失败/冲突的加速键 */
  conflicts?: string[]
}

/** 动作的中文标签，供设置页展示 */
export const HOTKEY_ACTION_LABELS: Record<HotkeyAction, string> = {
  toggle: '播放 / 暂停',
  playPrev: '上一首',
  playNext: '下一首',
  volumeUp: '音量增大',
  volumeDown: '音量减小',
  seekForward: '快进',
  seekBackward: '快退'
}

/** 默认快捷键配置 */
export const DEFAULT_HOTKEY_CONFIG: HotkeyConfig = {
  toggle: 'CmdOrCtrl+Alt+P',
  playPrev: 'CmdOrCtrl+Alt+Left',
  playNext: 'CmdOrCtrl+Alt+Right',
  volumeUp: 'CmdOrCtrl+Alt+Up',
  volumeDown: 'CmdOrCtrl+Alt+Down',
  seekForward: '',
  seekBackward: ''
}
