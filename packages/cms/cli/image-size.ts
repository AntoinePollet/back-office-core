/**
 * Dimensions d'une image, lues dans les premiers octets du fichier (PNG, JPEG, GIF, WebP).
 * Dans le back-office c'est le navigateur qui les mesure ; l'outil d'import n'en a pas.
 * Renvoie null pour un format non reconnu (SVG, AVIF, PDF) : la médiathèque s'en passe.
 */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const ok = (width: number, height: number) => (width > 0 && height > 0 && width < 100000 && height < 100000 ? { width, height } : null)

  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return ok(b.readUInt32BE(16), b.readUInt32BE(20))
  if (b.length >= 10 && b.toString('latin1', 0, 3) === 'GIF') return ok(b.readUInt16LE(6), b.readUInt16LE(8))

  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16)
    if (kind === 'VP8X') return ok(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3))
    if (kind === 'VP8 ') return ok(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return ok(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))
    }
    return null
  }

  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG : une suite de blocs ; les dimensions sont dans le premier bloc « début d'image » (SOF).
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]!
      if (marker === 0xff) { i++; continue }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5))
      // Blocs sans longueur : marqueurs de reprise et début d'image.
      if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}
