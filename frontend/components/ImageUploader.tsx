'use client'

import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { fileToCompressedBase64 } from '@/lib/imageUtils'
import Button from '@/components/ui/Button'

interface ImageUploaderProps {
  onUpload: (base64: string, contentType: string) => Promise<void>
  isUploading: boolean
}

export default function ImageUploader({ onUpload, isUploading }: ImageUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setPreviewUrl(URL.createObjectURL(file))

    try {
      const { base64, contentType } = await fileToCompressedBase64(file)
      await onUpload(base64, contentType)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong processing the image')
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <Button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className="w-full"
      >
        <Camera className="w-4 h-4" />
        {isUploading ? 'Scanning shelf…' : 'Take or Upload Bookshelf Photo'}
      </Button>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Bookshelf preview"
          className="rounded-card w-full object-cover max-h-80 border border-border"
        />
      )}

      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  )
}
