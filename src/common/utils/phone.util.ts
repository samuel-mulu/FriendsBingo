/** Normalize Ethiopian mobile numbers to international format (2519…). */
export function normalizeEthiopianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('251')) {
    return digits;
  }

  if (digits.startsWith('0')) {
    return `251${digits.slice(1)}`;
  }

  if (digits.startsWith('9') && digits.length === 9) {
    return `251${digits}`;
  }

  return digits;
}

/** Normalized + local variants for DB lookups (legacy rows may use either). */
export function ethiopianPhoneLookupVariants(phone: string): string[] {
  const normalized = normalizeEthiopianPhone(phone);
  const local = toLocalEthiopianPhone(normalized);

  if (local === normalized) {
    return [normalized];
  }

  return [normalized, local];
}

/** Local display format: 0962520885 */
export function toLocalEthiopianPhone(normalizedPhone: string): string {
  if (normalizedPhone.startsWith('251') && normalizedPhone.length >= 12) {
    return `0${normalizedPhone.slice(3)}`;
  }

  return normalizedPhone;
}

/** Mask for UI: 0962****** */
export function maskEthiopianPhone(phone: string): string {
  const local = toLocalEthiopianPhone(normalizeEthiopianPhone(phone));
  if (local.length <= 4) {
    return local;
  }

  return `${local.slice(0, 4)}${'*'.repeat(local.length - 4)}`;
}
