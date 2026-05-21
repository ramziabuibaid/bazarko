const arabicToLatin: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a',
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
  'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z',
  'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
  'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a',
  'ة': 'h', 'ء': '', 'ئ': 'y', 'ؤ': 'w',
}

export function generateSlug(text: string): string {
  let result = text.trim().toLowerCase()

  // تحويل الأحرف العربية
  result = result.split('').map(c => arabicToLatin[c] ?? c).join('')

  // تنظيف الأحرف غير المسموح بها
  result = result
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  // إذا أفضى لنص فارغ (نص عربي غير مدعوم) نستخدم timestamp
  if (!result) {
    result = `item-${Date.now()}`
  }

  return result.slice(0, 60)
}

export function uniqueSlug(base: string): string {
  const slug = generateSlug(base)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${slug}-${suffix}`
}
