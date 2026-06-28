<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  DEFAULT_HOTKEY_CONFIG,
  HOTKEY_ACTION_LABELS,
  type HotkeyAction,
  type HotkeyConfig
} from '@common/types/hotkeys'

const actions = Object.keys(HOTKEY_ACTION_LABELS) as HotkeyAction[]

const config = reactive<HotkeyConfig>({ ...DEFAULT_HOTKEY_CONFIG })
const registered = ref<string[]>([])
const conflicts = ref<string[]>([])
const capturingAction = ref<HotkeyAction | null>(null)
const loading = ref(false)

const applyStatus = (status: any) => {
  registered.value = Array.isArray(status?.registered) ? status.registered : []
  conflicts.value = Array.isArray(status?.conflicts) ? status.conflicts : []
}

const loadConfig = async () => {
  loading.value = true
  try {
    const res: any = await window.api.hotkeys.get()
    if (res?.data && typeof res.data === 'object') {
      for (const action of actions) {
        config[action] = res.data[action] ?? DEFAULT_HOTKEY_CONFIG[action]
      }
    }
    applyStatus(res?.status)
  } catch (err) {
    console.error('加载快捷键配置失败:', err)
  } finally {
    loading.value = false
  }
}

const saveConfig = async () => {
  try {
    const res: any = await window.api.hotkeys.set({ config: { ...config } })
    applyStatus(res?.status)
    if (conflicts.value.length) {
      MessagePlugin.warning(`部分快捷键注册失败（可能与系统/其它程序冲突）：${conflicts.value.join('、')}`)
    }
  } catch (err) {
    console.error('保存快捷键配置失败:', err)
    MessagePlugin.error('保存快捷键失败')
  }
}

// 将 KeyboardEvent 转换为 Tauri 加速键字符串（如 "CmdOrCtrl+Alt+P"）
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight'
])

const codeToKey = (e: KeyboardEvent): string | null => {
  const code = e.code
  if (!code || MODIFIER_CODES.has(code)) return null
  if (code.startsWith('Key')) return code.slice(3) // KeyP -> P
  if (code.startsWith('Digit')) return code.slice(5) // Digit5 -> 5
  if (code.startsWith('Numpad')) return code.slice(6) || null
  if (/^F\d{1,2}$/.test(code)) return code // F1..F12
  const map: Record<string, string> = {
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: 'Minus',
    Equal: 'Plus',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Backquote: '`'
  }
  return map[code] || null
}

const onCaptureKeydown = (e: KeyboardEvent) => {
  if (!capturingAction.value) return
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    stopCapture()
    return
  }

  const key = codeToKey(e)
  if (!key) return // 等待非修饰键

  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('CmdOrCtrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')

  const isFunctionKey = /^F\d{1,2}$/.test(key)
  if (mods.length === 0 && !isFunctionKey) {
    MessagePlugin.warning('全局快捷键需要至少包含一个修饰键（Ctrl/Alt/Shift）')
    return
  }

  const accel = [...mods, key].join('+')
  const action = capturingAction.value
  config[action] = accel
  stopCapture()
  void saveConfig()
}

const startCapture = (action: HotkeyAction) => {
  capturingAction.value = action
}

const stopCapture = () => {
  capturingAction.value = null
}

const clearHotkey = (action: HotkeyAction) => {
  config[action] = ''
  void saveConfig()
}

const resetDefaults = () => {
  for (const action of actions) {
    config[action] = DEFAULT_HOTKEY_CONFIG[action]
  }
  void saveConfig()
}

const isConflict = (action: HotkeyAction) => {
  const accel = config[action]
  return !!accel && conflicts.value.includes(accel)
}

onMounted(() => {
  void loadConfig()
  window.addEventListener('keydown', onCaptureKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCaptureKeydown, true)
})
</script>

<template>
  <div class="settings-section">
    <div id="hotkey-settings" class="setting-group">
      <h3>全局快捷键</h3>
      <p>设置系统级快捷键，应用未聚焦时也能控制播放。点击「录制」后按下组合键即可绑定。</p>

      <div v-for="action in actions" :key="action" class="setting-item">
        <div class="item-info">
          <div class="item-title">{{ HOTKEY_ACTION_LABELS[action] }}</div>
          <div v-if="isConflict(action)" class="item-desc conflict">注册失败，可能与系统或其它程序冲突</div>
        </div>
        <div class="hotkey-controls">
          <span
            class="hotkey-display"
            :class="{ capturing: capturingAction === action, empty: !config[action] }"
          >
            {{ capturingAction === action ? '请按下组合键…' : config[action] || '未绑定' }}
          </span>
          <t-button
            size="small"
            :theme="capturingAction === action ? 'primary' : 'default'"
            variant="outline"
            @click="capturingAction === action ? stopCapture() : startCapture(action)"
          >
            {{ capturingAction === action ? '取消' : '录制' }}
          </t-button>
          <t-button
            size="small"
            theme="default"
            variant="text"
            :disabled="!config[action]"
            @click="clearHotkey(action)"
          >
            清除
          </t-button>
        </div>
      </div>

      <div class="hotkey-footer">
        <t-button size="small" theme="default" variant="outline" @click="resetDefaults">
          恢复默认
        </t-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.settings-section {
  animation: fadeInUp 0.4s ease-out;
  animation-fill-mode: both;
}

.setting-group {
  background: var(--settings-group-bg);
  border-radius: 0.75rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  border: 1px solid var(--settings-group-border);
  box-shadow: 0 1px 3px var(--settings-group-shadow);

  h3 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--settings-text-primary);
  }

  > p {
    margin: 0 0 1.5rem;
    color: var(--settings-text-secondary);
    font-size: 0.875rem;
  }
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border: 1px solid var(--settings-feature-border);
  background: var(--settings-feature-bg);
  border-radius: 0.5rem;
  margin-top: 0.75rem;

  .item-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    .item-title {
      font-weight: 600;
      color: var(--settings-text-primary);
      font-size: 0.95rem;
      line-height: 1.2;
    }

    .item-desc {
      color: var(--settings-text-secondary);
      font-size: 0.8rem;
      line-height: 1.2;

      &.conflict {
        color: var(--td-error-color, #d54941);
      }
    }
  }
}

.hotkey-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hotkey-display {
  min-width: 8.5rem;
  text-align: center;
  padding: 0.3rem 0.6rem;
  border-radius: 0.4rem;
  font-size: 0.85rem;
  font-family: 'JetBrains Mono', Consolas, monospace;
  background: var(--settings-tag-option-bg, rgba(127, 127, 127, 0.1));
  border: 1px solid var(--settings-feature-border);
  color: var(--settings-text-primary);

  &.empty {
    color: var(--settings-text-secondary);
  }

  &.capturing {
    border-color: var(--td-brand-color, #2ba55b);
    color: var(--td-brand-color, #2ba55b);
  }
}

.hotkey-footer {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
