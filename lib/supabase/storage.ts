'use client'

import { createClient } from './client'

const BUCKET = 'product-images'

export async function uploadProductImage(
  storeId: string,
  file: File
): Promise<string> {
  const supabase = createClient()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${storeId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function deleteProductImage(url: string): Promise<void> {
  const supabase = createClient()
  const path = url.split(`/${BUCKET}/`)[1]
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path])
}

// رفع صور المتجر (لوغو وغلاف) — تُخزَّن في نفس bucket بمسار stores/
export async function uploadStoreImage(
  storeId: string,
  type: 'logo' | 'cover',
  file: File
): Promise<string> {
  const supabase = createClient()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `stores/${storeId}/${type}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  // نضيف timestamp لمنع cache القديم
  return `${data.publicUrl}?t=${Date.now()}`
}
