/**
 * Phone number helper utilities for WhatsApp in Palestine (+972 / +970)
 */

export type WhatsAppPrefix = '972' | '970'

/**
 * Normalizes phone numbers to clean national digits (stripping leading 0, 00970, 00972, +970, +972).
 * Examples:
 *  "0599123456"      -> "599123456"
 *  "+972599123456"   -> "599123456"
 *  "00970-56-8123456"-> "568123456"
 */
export function extractNationalDigits(phone: string | null | undefined): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00970') || digits.startsWith('00972')) {
    digits = digits.slice(5)
  } else if (digits.startsWith('970') || digits.startsWith('972')) {
    digits = digits.slice(3)
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }
  return digits
}

/**
 * Builds a direct WhatsApp click-to-chat URL with the specified prefix and optional message.
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  prefix: WhatsAppPrefix = '972',
  message?: string
): string {
  const national = extractNationalDigits(phone)
  if (!national) {
    return message ? `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}` : ''
  }
  const fullPhone = `${prefix}${national}`
  const query = message ? `?phone=${fullPhone}&text=${encodeURIComponent(message)}` : `?phone=${fullPhone}`
  return `https://api.whatsapp.com/send${query}`
}

/**
 * Formats phone for clean display.
 */
export function formatDisplayPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const national = extractNationalDigits(phone)
  if (!national) return phone
  if (national.length === 9) {
    return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
  }
  return phone
}
