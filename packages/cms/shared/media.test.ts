import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  IMAGE_RATIOS, IMAGE_WIDTHS, canHaveFocus, cmsImageSrcset, cmsImageUrl, cmsObjectPosition, cropRect, cropSize, imageQuery,
  imageVariant, isFocusInput, normalizeFocus, parseRatio, snapRatio,
} from './media.ts'

const photo = { url: '/media/abc/photo.jpg', mime: 'image/jpeg', width: 2000, height: 1000 }
const focused = { ...photo, focus: { x: 0.25, y: 0.8 } }

test('point d\'intérêt : borné, arrondi au centième, le centre et les valeurs illisibles donnent null', () => {
  assert.deepEqual(normalizeFocus({ x: 0.254, y: 0.796 }), { x: 0.25, y: 0.8 })
  assert.deepEqual(normalizeFocus({ x: -3, y: 7 }), { x: 0, y: 1 })
  assert.equal(normalizeFocus({ x: 0.5, y: 0.5 }), null)
  assert.equal(normalizeFocus({ x: 0.501, y: 0.499 }), null)
  for (const bad of [null, undefined, 'centre', 3, [], { x: '0.2', y: 0.3 }, { x: 0.2 }, { x: Number.NaN, y: 0.1 }, { x: Infinity, y: 0 }]) assert.equal(normalizeFocus(bad), null)
})

test('saisie d\'un point : null accepté, forme et bornes vérifiées', () => {
  assert.ok(isFocusInput(null))
  assert.ok(isFocusInput({ x: 0, y: 1 }))
  for (const bad of ['0.2 0.3', 5, {}, { x: 0.2 }, { x: 1.2, y: 0.5 }, { x: 0.5, y: -0.1 }, { x: '0.5', y: 0.5 }, [0.2, 0.3]]) assert.equal(isFocusInput(bad), false, JSON.stringify(bad))
})

test('fichiers qui peuvent avoir un point : les images recadrables seulement', () => {
  assert.ok(canHaveFocus('image/jpeg') && canHaveFocus('image/png') && canHaveFocus('image/webp') && canHaveFocus('image/avif'))
  for (const mime of ['image/svg+xml', 'image/gif', 'application/pdf', '', null, undefined]) assert.equal(canHaveFocus(mime), false)
})

test('object-position : en pour cent, rien sans point', () => {
  assert.equal(cmsObjectPosition(focused), '25% 80%')
  assert.equal(cmsObjectPosition({ focus: { x: 0, y: 1 } }), '0% 100%')
  assert.equal(cmsObjectPosition({ ...photo, focus: undefined }), undefined)
  assert.equal(cmsObjectPosition({ focus: null }), undefined)
  assert.equal(cmsObjectPosition({ focus: { x: 0.5, y: 0.5 } }), undefined)
  assert.equal(cmsObjectPosition(null), undefined)
})

test('proportions : lecture et retour à la liste fermée', () => {
  assert.equal(parseRatio('16/9'), 16 / 9)
  assert.equal(parseRatio('16:9'), 16 / 9)
  assert.equal(parseRatio('16x9'), 16 / 9)
  assert.equal(parseRatio(' 3 / 2 '), 1.5)
  assert.equal(parseRatio('1.5'), 1.5)
  assert.equal(parseRatio(2), 2)
  for (const bad of ['', 'large', '16/0', '0/9', '-1/1', '1/2/3', 0, -1, Number.NaN, null, undefined, {}]) assert.equal(parseRatio(bad), null, String(bad))
  for (const r of IMAGE_RATIOS) assert.equal(snapRatio(r), r)
  assert.equal(snapRatio('16:9'), '16/9')
  assert.equal(snapRatio('1920x1080'), '16/9')
  assert.equal(snapRatio(1.02), '1/1')
  assert.equal(snapRatio('7/5'), '4/3')
  assert.equal(snapRatio(100), '3/1')
  assert.equal(snapRatio(0.01), '9/16')
  assert.equal(snapRatio('n\'importe quoi'), null)
})

test('rectangle gardé : le plus grand possible, placé selon le point', () => {
  // Image 2000 × 1000 en carré : 1000 × 1000, on coupe sur les côtés.
  assert.deepEqual(cropRect(photo, '1/1'), { left: 500, top: 0, width: 1000, height: 1000 })
  assert.deepEqual(cropRect(focused, '1/1'), { left: 250, top: 0, width: 1000, height: 1000 })
  assert.deepEqual(cropRect({ ...photo, focus: { x: 0, y: 0 } }, '1/1'), { left: 0, top: 0, width: 1000, height: 1000 })
  assert.deepEqual(cropRect({ ...photo, focus: { x: 1, y: 1 } }, '1/1'), { left: 1000, top: 0, width: 1000, height: 1000 })
  // En bandeau 3/1 : 2000 × 667, on coupe en haut et en bas.
  assert.deepEqual(cropRect(photo, '3/1'), { left: 0, top: 167, width: 2000, height: 667 })
  assert.deepEqual(cropRect(focused, '3/1'), { left: 0, top: 266, width: 2000, height: 667 })
  // Mêmes proportions que l'image : tout est gardé.
  assert.deepEqual(cropRect(focused, '2/1'), { left: 0, top: 0, width: 2000, height: 1000 })
  // Le rectangle ne sort jamais de l'image.
  for (const ratio of IMAGE_RATIOS) {
    for (const focus of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.33, y: 0.71 }]) {
      for (const [width, height] of [[2000, 1000], [333, 1001], [7, 5], [1, 1]] as const) {
        const r = cropRect({ width, height, focus }, ratio)!
        assert.ok(r.left >= 0 && r.top >= 0 && r.width >= 1 && r.height >= 1 && r.left + r.width <= width && r.top + r.height <= height, `${ratio} ${width}x${height} ${JSON.stringify(r)}`)
        const size = cropSize({ width, height, focus }, ratio, 2560)
        assert.ok(size.width <= r.width && size.height <= r.height, `${ratio} ${JSON.stringify(size)}`)
      }
    }
  }
  assert.equal(cropRect({ width: null, height: null }, '1/1'), null)
  assert.equal(cropRect(photo, 'x'), null)
})

test('dimensions servies : proportions exactes, jamais d\'agrandissement', () => {
  assert.deepEqual(cropSize(photo, '1/1', 640), { width: 640, height: 640 })
  assert.deepEqual(cropSize(photo, '16/9', 640), { width: 640, height: 360 })
  assert.deepEqual(cropSize(photo, '3/4', 480), { width: 480, height: 640 })
  // Carré demandé en 1280 dans une image de 1000 de haut : 1000 × 1000.
  assert.deepEqual(cropSize(photo, '1/1', 1280), { width: 1000, height: 1000 })
  // Dimensions inconnues : la largeur demandée.
  assert.deepEqual(cropSize({}, '16/9', 640), { width: 640, height: 360 })
})

test('adresses : inchangées sans proportions, point d\'intérêt dans l\'adresse d\'un recadrage', () => {
  assert.equal(cmsImageUrl(photo, 600), '/media/abc/photo.jpg?w=640')
  assert.equal(cmsImageUrl(focused, 600), '/media/abc/photo.jpg?w=640')
  assert.equal(cmsImageUrl(photo, 600, '1/1'), '/media/abc/photo.jpg?w=640&r=1x1')
  assert.equal(cmsImageUrl(focused, 600, '16/9'), '/media/abc/photo.jpg?w=640&r=16x9&f=25-80')
  assert.equal(cmsImageUrl(focused, 600, '16:9'), '/media/abc/photo.jpg?w=640&r=16x9&f=25-80')
  assert.equal(cmsImageUrl(focused, 600, 1.8), '/media/abc/photo.jpg?w=640&r=16x9&f=25-80')
  assert.equal(cmsImageUrl(focused, 600, null), '/media/abc/photo.jpg?w=640')
  assert.equal(cmsImageUrl(focused, 99999, '1/1'), '/media/abc/photo.jpg?w=2560&r=1x1&f=25-80')
  // SVG, GIF, PDF : servis tels quels.
  assert.equal(cmsImageUrl({ url: '/media/a/logo.svg', mime: 'image/svg+xml' }, 600, '1/1'), '/media/a/logo.svg')
  assert.equal(cmsImageUrl({ url: '/media/a/anim.gif', mime: 'image/gif', focus: { x: 0, y: 0 } }, 600, '1/1'), '/media/a/anim.gif')
  assert.equal(cmsImageUrl(null, 600, '1/1'), '')
  assert.equal(imageQuery(focused, 500, '9/16'), 'w=640&r=9x16&f=25-80')
})

test('srcset : identique à avant sans proportions ; avec, limité à la partie gardée', () => {
  assert.equal(cmsImageSrcset({ url: '/media/a/p.jpg', mime: 'image/jpeg', width: 320 }), '/media/a/p.jpg?w=160 160w, /media/a/p.jpg?w=320 320w')
  assert.equal(cmsImageSrcset(focused, 640), '/media/abc/photo.jpg?w=160 160w, /media/abc/photo.jpg?w=320 320w, /media/abc/photo.jpg?w=480 480w, /media/abc/photo.jpg?w=640 640w')
  // Carré dans 2000 × 1000 : 1000 de large au plus, donc jusqu'à la version 1024.
  const square = cmsImageSrcset(focused, undefined, '1/1')!.split(', ')
  assert.deepEqual(square.map(s => s.split(' ')[1]), ['160w', '320w', '480w', '640w', '800w', '1024w'])
  assert.ok(square.every(s => /^\/media\/abc\/photo\.jpg\?w=\d+&r=1x1&f=25-80 \d+w$/.test(s)), square.join(' | '))
  assert.equal(cmsImageSrcset(photo, 320, '16/9'), '/media/abc/photo.jpg?w=160&r=16x9 160w, /media/abc/photo.jpg?w=320&r=16x9 320w')
  assert.equal(cmsImageSrcset({ url: '/media/a/logo.svg', mime: 'image/svg+xml' }, 640, '1/1'), undefined)
  assert.equal(cmsImageSrcset(null), undefined)
})

test('route /media : une seule adresse par version, le reste est redirigé', () => {
  // Formes exactes : servies.
  assert.deepEqual(imageVariant({ w: '640' }, focused), { width: 640 })
  assert.deepEqual(imageVariant({ w: '640', r: '16x9', f: '25-80' }, focused), { width: 640, height: 360, ratio: '16/9', focus: { x: 0.25, y: 0.8 } })
  assert.deepEqual(imageVariant({ w: '640', r: '1x1' }, photo), { width: 640, height: 640, ratio: '1/1', focus: null })
  assert.deepEqual(imageVariant({ w: '2560', r: '1x1' }, photo), { width: 1000, height: 1000, ratio: '1/1', focus: null })
  // Largeur hors liste.
  assert.deepEqual(imageVariant({ w: '500' }, photo), { redirect: 'w=640', cropped: false })
  assert.deepEqual(imageVariant({ w: '99999' }, photo), { redirect: 'w=2560', cropped: false })
  assert.deepEqual(imageVariant({ w: '640.0' }, photo), { redirect: 'w=640', cropped: false })
  // Proportions hors liste ou écrites autrement.
  assert.deepEqual(imageVariant({ w: '640', r: '7x5' }, photo), { redirect: 'w=640&r=4x3', cropped: true })
  assert.deepEqual(imageVariant({ w: '640', r: '16/9' }, photo), { redirect: 'w=640&r=16x9', cropped: true })
  assert.deepEqual(imageVariant({ w: '640', r: 'zzz' }, photo), { redirect: 'w=640', cropped: true })
  assert.deepEqual(imageVariant({ w: '640', r: '' }, photo), { redirect: 'w=640', cropped: true })
  // Point absent, périmé ou inventé : celui du fichier.
  assert.deepEqual(imageVariant({ w: '640', r: '1x1' }, focused), { redirect: 'w=640&r=1x1&f=25-80', cropped: true })
  assert.deepEqual(imageVariant({ w: '640', r: '1x1', f: '10-10' }, focused), { redirect: 'w=640&r=1x1&f=25-80', cropped: true })
  assert.deepEqual(imageVariant({ w: '640', r: '1x1', f: '10-10' }, photo), { redirect: 'w=640&r=1x1', cropped: true })
  assert.deepEqual(imageVariant({ w: '640', f: '10-10' }, focused), { redirect: 'w=640', cropped: true })
  assert.deepEqual(imageVariant({ w: ['640', '800'], r: ['1x1', '3x1'] }, photo), { width: 640, height: 640, ratio: '1/1', focus: null })
  // Pas une demande de version.
  for (const w of [undefined, '', '0', '-5', 'abc']) assert.equal(imageVariant({ w }, photo), null)
  // Nombre de versions possibles par fichier.
  assert.equal(IMAGE_WIDTHS.length * (1 + IMAGE_RATIOS.length), 140)
})
