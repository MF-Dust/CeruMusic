/**
 * 一起听邀请入口。
 *
 * 该功能依赖账号鉴权。登录功能移除后，这里只做口令去重，避免启动或聚焦时
 * 从剪贴板检测到旧邀请后继续弹出登录/加入流程。
 */

import { extractCodeFromShareText } from '@renderer/components/ListenTogether/parts/shareTextHelper'

const dismissedCodes = new Set<string>()
let running = false

export type InviteTriggerSource = 'deeplink' | 'clipboard'

async function readClipboardText(): Promise<string> {
  try {
    const fromApi = await (window as any).api?.clipboard?.readText?.()
    if (typeof fromApi === 'string' && fromApi.length > 0) return fromApi
  } catch {}
  try {
    return (await navigator.clipboard.readText()) || ''
  } catch {
    return ''
  }
}

export async function tryShowListenTogetherInvite(
  source: InviteTriggerSource,
  explicitCode?: string | null
): Promise<void> {
  if (running) return
  running = true
  try {
    const code = explicitCode?.toUpperCase() || extractCodeFromShareText(await readClipboardText())
    if (!code || dismissedCodes.has(code)) return
    dismissedCodes.add(code)
    console.info('[lt-invite] ignored after account login removal:', source, code)
  } finally {
    running = false
  }
}

export function resetListenTogetherInviteDedup(): void {
  dismissedCodes.clear()
}
