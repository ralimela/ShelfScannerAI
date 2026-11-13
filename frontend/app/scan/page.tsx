'use client'

import { useEffect, useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import { uploadShelfImage } from '@/lib/api'
import { getOrCreateUserId } from '@/lib/user'
import type { UploadResponse } from '@/lib/types'

export default function ScanPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [result, setResult] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // localStorage isn't available during SSR, so this id must be read client-side in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(getOrCreateUserId())
  }, [])

  const handleUpload = async (base64: string, contentType: string) => {
    if (!userId) return
    setIsUploading(true)
    setError(null)
    setResult(null)
    try {
      const response = await uploadShelfImage(userId, base64, contentType)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-8 p-8">
      <h1 className="text-2xl font-semibold">Scan a Bookshelf</h1>

      <ImageUploader onUpload={handleUpload} isUploading={isUploading} />

      {error && <p className="text-red-600">{error}</p>}

      {result && (
        <div className="w-full max-w-md flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            {result.extractedTitles.length} title(s) found in {result.processingTimeMs}ms
          </p>

          {result.message && <p className="text-sm text-gray-600">{result.message}</p>}

          {result.extractedTitles.map((title, i) => (
            <div key={i} className="border rounded-xl p-4">
              <p className="font-medium">{title.title}</p>
              {title.author && <p className="text-sm text-gray-600">{title.author}</p>}
              <div className="flex gap-3 text-xs text-gray-400 mt-1">
                {title.pageCount && <span>{title.pageCount} pages</span>}
                <span>{Math.round(title.confidence * 100)}% confidence</span>
                {!title.matched && <span>no Open Library match</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
