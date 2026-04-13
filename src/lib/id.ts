/**
 * Alfabeto sin O/0 e I/1 para lectura humana y escaneo más fiable.
 * Cada ID es el identificador único de la etiqueta (QR); no debe repetirse nunca.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ALPHABET_LEN = ALPHABET.length
/** Longitud del código en la etiqueta y en el QR (entropía alta, colisiones despreciables). */
export const TRACKING_ID_LENGTH = 12

export function createTrackingId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(TRACKING_ID_LENGTH)
    crypto.getRandomValues(bytes)
    let s = ''
    for (let i = 0; i < TRACKING_ID_LENGTH; i++) {
      s += ALPHABET[bytes[i]! % ALPHABET_LEN]
    }
    return s
  }
  let s = ''
  for (let i = 0; i < TRACKING_ID_LENGTH; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET_LEN)]
  }
  return s
}
