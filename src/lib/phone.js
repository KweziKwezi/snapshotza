// South African phone numbers. The database stores them as +27 followed by 9 digits (see migration 0015).

/** "082 123 4567", "+27 82 123 4567", "27821234567" -> "+27821234567"; anything else -> null. */
export function normalizePhone(input) {
  const d = String(input || '').replace(/\D/g, '')
  if (/^0[1-8]\d{8}$/.test(d)) return `+27${d.slice(1)}`
  if (/^27[1-8]\d{8}$/.test(d)) return `+${d}`
  return null
}

/** "+27821234567" -> "082 123 4567" (how South Africans write it). */
export function formatPhone(stored) {
  const n = normalizePhone(stored)
  if (!n) return stored || ''
  const local = `0${n.slice(3)}`
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
}

export const PHONE_HINT = 'A South African number, e.g. 082 123 4567.'
