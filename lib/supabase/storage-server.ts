import { createClient } from './server'

const BUCKET = 'product-images'

/**
 * Downloads an external image from a URL and saves it directly to Supabase Storage
 * Returns the permanent public Supabase Storage URL
 */
export async function ingestExternalImage(storeId: string, externalUrl: string): Promise<string> {
  const supabase = createClient()

  // If already hosted on our supabase storage bucket, return as is
  if (externalUrl.includes(`/${BUCKET}/`)) {
    return externalUrl
  }

  try {
    const res = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BazarkoSyncEngine/1.0',
      },
      signal: AbortSignal.timeout(12000), // 12 seconds timeout
    })

    if (!res.ok) {
      console.warn(`Failed to fetch external image from ${externalUrl}: ${res.statusText}`)
      return externalUrl // fallback to original if unreachable
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('gif') ? 'gif'
      : 'jpg'

    const buffer = await res.arrayBuffer()
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const path = `${storeId}/${filename}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(buffer), {
        contentType,
        upsert: true,
      })

    if (uploadError) {
      console.error(`Storage upload error for ${path}:`, uploadError)
      return externalUrl
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return data.publicUrl
  } catch (err) {
    console.error(`Error ingesting external image from ${externalUrl}:`, err)
    return externalUrl
  }
}
