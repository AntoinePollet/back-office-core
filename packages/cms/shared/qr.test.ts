import assert from 'node:assert/strict'
import { test } from 'node:test'
import { qrMatrix, qrPath, qrSvg } from './qr'

const URI = 'otpauth://totp/Cabinet%20Durand:claire%40example.com?secret=NVAWQTD2GA3W2OLSPFWHA2CQL5TDEU2ZGRYWYUBUNYYEONDBNN3Q&issuer=Cabinet+Durand&digits=6&period=30'

/** Redessine un tracé sur une grille, pour le comparer à la grille d'origine. */
function rasterize(path: string, size: number) {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(w); i++) {
      assert.equal(grid[Number(y)]![Number(x) + i], false, 'deux rectangles se recouvrent')
      grid[Number(y)]![Number(x) + i] = true
    }
  }
  return grid
}

/** Motif de repérage (carré 7 × 7 aux trois coins) : sans lui, aucun lecteur ne trouve le code. */
function hasFinder(matrix: boolean[][], top: number, left: number) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3))
      if (matrix[top + y]![left + x] !== (ring !== 2)) return false
    }
  }
  return true
}

test('grille : carrée, d\'une taille de code QR, avec ses trois motifs de repérage', () => {
  const matrix = qrMatrix(URI)
  const n = matrix.length
  assert.ok(matrix.every(row => row.length === n), 'grille non carrée')
  // Tailles valides : 21, 25, 29… (version 1 à 40).
  assert.equal((n - 17) % 4, 0)
  assert.ok(n >= 21 && n <= 177)
  assert.ok(hasFinder(matrix, 0, 0) && hasFinder(matrix, 0, n - 7) && hasFinder(matrix, n - 7, 0))
  assert.equal(hasFinder(matrix, n - 7, n - 7), false)
  // Une adresse d'activation tient dans un code que l'écran d'un téléphone affiche sans peine.
  assert.ok(n <= 57, `code trop dense : ${n} carrés de côté`)
})

test('grille : la même adresse donne le même code, une autre clé un autre code', () => {
  assert.deepEqual(qrMatrix(URI), qrMatrix(URI))
  assert.notDeepEqual(qrMatrix(URI), qrMatrix(URI.replace('NVAW', 'NVAX')))
})

test('tracé : redessine exactement la grille, décalée de la marge', () => {
  const matrix = qrMatrix(URI)
  for (const margin of [0, 4]) {
    const drawn = rasterize(qrPath(matrix, margin), matrix.length + margin * 2)
    matrix.forEach((row, y) => row.forEach((dark, x) => assert.equal(drawn[y + margin]![x + margin], dark, `carré ${x},${y}`)))
    assert.equal(drawn.flat().filter(Boolean).length, matrix.flat().filter(Boolean).length, 'des carrés noirs dans la marge')
  }
})

test('tracé : un rectangle par suite de carrés noirs', () => {
  assert.equal(qrPath([[true, true, false, true], [false, false, false, false], [true, false, true, true]], 1), 'M1 1h2v1h-2zM4 1h1v1h-1zM1 3h1v1h-1zM3 3h2v1h-2z')
  assert.equal(qrPath([[false]]), '')
})

test('dessin : marge blanche de 4 carrés autour du code', () => {
  const { size, viewBox, path } = qrSvg(URI)
  const n = qrMatrix(URI).length
  assert.equal(size, n + 8)
  assert.equal(viewBox, `0 0 ${n + 8} ${n + 8}`)
  const xs = [...path.matchAll(/M(\d+) (\d+)h(\d+)/g)].flatMap(([, x, , w]) => [Number(x), Number(x) + Number(w)])
  const ys = [...path.matchAll(/M(\d+) (\d+)h/g)].map(([, , y]) => Number(y))
  assert.equal(Math.min(...xs), 4); assert.equal(Math.max(...xs), n + 4)
  assert.equal(Math.min(...ys), 4); assert.equal(Math.max(...ys), n + 3)
})
