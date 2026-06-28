let cachedCanvas: HTMLCanvasElement | null = null
let cachedCtx: CanvasRenderingContext2D | null = null

/**
 * 获取共享的 Canvas 和 2D 绘图上下文。
 * 使用 willReadFrequently: true 优化 getImageData 性能并降低 GPU/VRAM 开销。
 * @param size Canvas 尺寸（宽和高）
 */
export function getSharedCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null
  if (!cachedCanvas) {
    cachedCanvas = document.createElement('canvas')
    cachedCtx = cachedCanvas.getContext('2d', { willReadFrequently: true })
  }
  if (!cachedCtx) return null
  if (cachedCanvas.width !== size || cachedCanvas.height !== size) {
    cachedCanvas.width = size
    cachedCanvas.height = size
  }
  return { canvas: cachedCanvas, ctx: cachedCtx }
}
