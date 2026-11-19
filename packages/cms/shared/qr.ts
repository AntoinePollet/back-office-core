/**
 * Code QR dessiné en SVG, dans le navigateur : rien ne part vers un service externe (le contenu est une clé secrète).
 * Le calcul du code vient de `uqr` (quelques kilo-octets, aucune dépendance) ; ce fichier n'en fait que le dessin.
 */
import { encode } from 'uqr'

/** Grille du code : `grille[ligne][colonne]` vaut vrai pour un carré noir. Correction d'erreurs moyenne (15 %). */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data
}

/**
 * Tracé SVG d'une grille : un rectangle par suite horizontale de carrés noirs (bien moins de points qu'un par carré).
 * `margin` : marge blanche autour du code, en carrés ; la norme en demande 4 pour une lecture fiable.
 */
export function qrPath(matrix: boolean[][], margin = 4): string {
  let path = ''
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let end = x
      while (end + 1 < row.length && row[end + 1]) end++
      path += `M${x + margin} ${y + margin}h${end - x + 1}v1h-${end - x + 1}z`
      x = end
    }
  })
  return path
}

/** De quoi dessiner le code : `<svg :viewBox><rect fill="#fff" width="100%" height="100%"/><path :d fill="#000"/></svg>`. */
export function qrSvg(text: string, margin = 4) {
  const matrix = qrMatrix(text)
  const size = matrix.length + margin * 2
  return { size, viewBox: `0 0 ${size} ${size}`, path: qrPath(matrix, margin) }
}
