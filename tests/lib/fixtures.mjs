// Fichiers importés par les tests, fabriqués à la demande : aucun fichier binaire dans le dépôt.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, tail])
}

/** Image PNG en couleurs (dégradé), sans dépendance. */
export function png(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3
      raw[i] = Math.round(255 * x / (width - 1))
      raw[i + 1] = Math.round(255 * y / (height - 1))
      raw[i + 2] = 160
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bits par couche, couleurs RVB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

const FILES = {
  // Le nom (majuscules, espaces) compte : les tests vérifient l'adresse « photo-du-cabinet.png ».
  'Photo du Cabinet.png': () => png(320, 240),
  // Galeries (suite 14) : trois images différentes, donc trois fichiers distincts.
  'atelier.png': () => png(240, 180),
  'chantier.png': () => png(200, 150),
  'reunion.png': () => png(160, 120),
  // Type de fichier refusé par la médiathèque.
  'notes.txt': () => Buffer.from('texte'),
}

/** Écrit les fichiers de test dans `dir` et renvoie une fonction qui donne leur chemin. */
export function writeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, make] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), make())
  return (name) => {
    if (!FILES[name]) throw new Error(`Fichier de test inconnu : ${name}`)
    return path.join(dir, name)
  }
}
