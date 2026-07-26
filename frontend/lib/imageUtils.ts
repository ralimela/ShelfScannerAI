const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

export interface CompressedImage {
  base64: string
  contentType: string
}

export function fileToCompressedBase64(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not load image'))
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
        const width = Math.round(img.width * scale)
        const height = Math.round(img.height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas not supported'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)

        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        const base64 = dataUrl.split(',')[1]
        resolve({ base64, contentType: 'image/jpeg' })
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
