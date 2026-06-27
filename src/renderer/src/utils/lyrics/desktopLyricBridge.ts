let installed = false

export function installDesktopLyricBridge() {
  installed = true
}

export function uninstallDesktopLyricBridge() {
  installed = false
}

export function isDesktopLyricBridgeInstalled() {
  return installed
}
