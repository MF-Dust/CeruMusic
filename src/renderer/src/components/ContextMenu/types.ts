export interface MenuItem {
  label: string
  callback?: () => void
  type?: 'separator' | 'item'
  children?: MenuItem[]
}

export interface ContextMenuPosition {
  x: number
  y: number
}

export interface ContextMenuItem {
  id?: string
  label?: string
  icon?: any
  onClick?: (item: ContextMenuItem, event: MouseEvent) => void
  disabled?: boolean
  separator?: boolean
  type?: string
  children?: ContextMenuItem[]
  className?: string
}

export interface ContextMenuProps {
  visible: boolean
  position: ContextMenuPosition
  items: ContextMenuItem[]
  className?: string
  width?: number
  maxHeight?: number
  zIndex?: number
}

export interface EdgeDetectionConfig {
  threshold: number
  enabled: boolean
}

export interface AnimationConfig {
  duration: number
  easing: string
  enabled: boolean
}

export interface ScrollConfig {
  scrollbarWidth: number
  scrollSpeed: number
  showScrollbar: boolean
}

