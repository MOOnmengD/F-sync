const MAX_LONG_SIDE = 1536
const QUALITY = 0.75
const MAX_ORIGINAL_SIZE = 5 * 1024 * 1024 // 5MB

export interface CompressedImage {
  dataUrl: string
  width: number
  height: number
  originalSize: number
  compressedSize: number
}

export function compressImage(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ORIGINAL_SIZE) {
      reject(new Error(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请选择小于 5MB 的图片`))
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const { width, height } = calcDimensions(img.naturalWidth, img.naturalHeight)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)

        const dataUrl = canvas.toDataURL('image/webp', QUALITY)
        const compressedSize = Math.round(dataUrl.length * 0.75) // base64 overhead ~33%

        resolve({
          dataUrl,
          width,
          height,
          originalSize: file.size,
          compressedSize
        })
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

function calcDimensions(w: number, h: number): { width: number; height: number } {
  const longSide = Math.max(w, h)
  if (longSide <= MAX_LONG_SIDE) return { width: w, height: h }

  const ratio = MAX_LONG_SIDE / longSide
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio)
  }
}
