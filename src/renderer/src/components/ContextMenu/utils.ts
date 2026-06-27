export function showContextMenu(_event: MouseEvent, items: any[]) {
  console.log('ContextMenu:', items)
}

export function createMenuItem(id: string, label: string, options?: any) {
  return { id, label, ...options }
}

export function createSeparator() {
  return { type: 'separator' }
}

export function calculateMenuPosition(event: MouseEvent, width?: number, height?: number) {
  let x = event.clientX
  let y = event.clientY
  const menuWidth = width || 200
  const menuHeight = height || 300
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10
  }
  return { x, y }
}
