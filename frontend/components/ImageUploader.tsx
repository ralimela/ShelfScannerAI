'use client'

import { useRef, useState } from 'react'
import { fileToCompressedBase64 } from '@/lib/imageUtils'

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

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className="w-full rounded-xl bg-black text-white py-3 font-medium disabled:opacity-50"
      >
        {isUploading ? 'Scanning shelf…' : 'Take or Upload Bookshelf Photo'}
      </button>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Bookshelf preview"
          className="rounded-xl w-full object-cover max-h-80"
        />
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}
