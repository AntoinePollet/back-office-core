import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FOLDER_MAX_DEPTH, FOLDER_NAME_MAX, type MediaFolder, checkFolderCreate, checkFolderMove, cleanFolderName, descendantIds,
  folderDepth, folderLabel, folderPath, folderTree, nameTaken, parseFolderPath, subtreeHeight,
} from './media-folders.ts'

// Chantiers › Isolation › 2026 ; Chantiers › Toiture ; Logos
const folders: MediaFolder[] = [
  { id: 'chantiers', name: 'Chantiers', parentId: null },
  { id: 'isolation', name: 'Isolation', parentId: 'chantiers' },
  { id: '2026', name: '2026', parentId: 'isolation' },
  { id: 'toiture', name: 'Toiture', parentId: 'chantiers' },
  { id: 'logos', name: 'Logos', parentId: null },
]

test('nom de dossier : espaces nettoyés, vide, trop long, caractères interdits', () => {
  assert.deepEqual(cleanFolderName('  Photos   de   chantier '), { name: 'Photos de chantier' })
  assert.equal(cleanFolderName('Été 2026 (Lyon) – n°2').name, 'Été 2026 (Lyon) – n°2')
  assert.equal(cleanFolderName('   ').error, 'Donnez un nom au dossier.')
  assert.equal(cleanFolderName(undefined).error, 'Donnez un nom au dossier.')
  assert.equal(cleanFolderName('a'.repeat(FOLDER_NAME_MAX)).name?.length, FOLDER_NAME_MAX)
  assert.match(cleanFolderName('a'.repeat(FOLDER_NAME_MAX + 1)).error!, /trop long/)
  assert.match(cleanFolderName('Chantiers/Isolation').error!, /« \/ »/)
  assert.match(cleanFolderName('a\\b').error!, /« \/ »/)
  assert.match(cleanFolderName('a\u0007b').error!, /invisible/)
  assert.ok(cleanFolderName('..').error)
})

test('nom unique dans un même dossier, sans tenir compte des majuscules', () => {
  assert.equal(nameTaken(folders, null, 'chantiers'), true)
  assert.equal(nameTaken(folders, null, ' CHANTIERS '), true)
  assert.equal(nameTaken(folders, 'chantiers', 'Chantiers'), false)
  assert.equal(nameTaken(folders, 'chantiers', 'toiture'), true)
  // Renommer un dossier en changeant seulement ses majuscules est permis.
  assert.equal(nameTaken(folders, null, 'CHANTIERS', 'chantiers'), false)
})

test('chemin, libellé et niveau d\'un dossier', () => {
  assert.deepEqual(folderPath(folders, '2026').map(f => f.name), ['Chantiers', 'Isolation', '2026'])
  assert.deepEqual(folderPath(folders, null), [])
  assert.deepEqual(folderPath(folders, 'inconnu'), [])
  assert.equal(folderLabel(folders, '2026'), 'Chantiers › Isolation › 2026')
  assert.equal(folderLabel(folders, null), 'Médiathèque')
  assert.equal(folderLabel(folders, 'isolation', '/'), 'Chantiers/Isolation')
  assert.deepEqual([folderDepth(folders, null), folderDepth(folders, 'logos'), folderDepth(folders, '2026')], [0, 1, 3])
})

test('une donnée abîmée (boucle) ne bloque pas', () => {
  const loop: MediaFolder[] = [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }]
  assert.ok(folderPath(loop, 'a').length <= 3)
  assert.deepEqual([...descendantIds(loop, 'a')], ['b'])
})

test('sous-dossiers et hauteur', () => {
  assert.deepEqual([...descendantIds(folders, 'chantiers')].sort(), ['2026', 'isolation', 'toiture'])
  assert.deepEqual([...descendantIds(folders, 'logos')], [])
  assert.deepEqual([subtreeHeight(folders, 'chantiers'), subtreeHeight(folders, 'isolation'), subtreeHeight(folders, 'logos')], [2, 1, 0])
})

test('création : parent connu, profondeur limitée, nom libre', () => {
  assert.equal(checkFolderCreate(folders, null, 'Équipe'), null)
  assert.equal(checkFolderCreate(folders, 'isolation', 'Avant'), null)
  assert.match(checkFolderCreate(folders, '2026', 'Trop profond')!, new RegExp(`${FOLDER_MAX_DEPTH} niveaux`))
  assert.match(checkFolderCreate(folders, 'chantiers', 'toiture')!, /existe déjà/)
  assert.match(checkFolderCreate(folders, 'inconnu', 'X')!, /introuvable/)
})

test('déplacement d\'un dossier : jamais dans lui-même ni dans un de ses sous-dossiers', () => {
  assert.match(checkFolderMove(folders, 'chantiers', 'chantiers')!, /lui-même/)
  assert.match(checkFolderMove(folders, 'chantiers', '2026')!, /lui-même/)
  assert.match(checkFolderMove(folders, 'chantiers', 'isolation')!, /lui-même/)
  assert.equal(checkFolderMove(folders, 'toiture', null), null)
  assert.equal(checkFolderMove(folders, 'toiture', 'isolation'), null)
  // Rester où l'on est n'est pas une erreur.
  assert.equal(checkFolderMove(folders, 'toiture', 'chantiers'), null)
})

test('déplacement d\'un dossier : profondeur et nom déjà pris à l\'arrivée', () => {
  // Isolation (avec 2026 dessous) dans Logos : Logos › Isolation › 2026, trois niveaux, permis.
  assert.equal(checkFolderMove(folders, 'isolation', 'logos'), null)
  // Chantiers (deux niveaux dessous) dans Logos : quatre niveaux.
  assert.match(checkFolderMove(folders, 'chantiers', 'logos')!, /niveaux/)
  const twin = [...folders, { id: 'iso2', name: 'isolation', parentId: 'logos' }]
  assert.match(checkFolderMove(twin, 'iso2', 'chantiers')!, /existe déjà/)
  assert.match(checkFolderMove(folders, 'inconnu', null)!, /introuvable/)
  assert.match(checkFolderMove(folders, 'logos', 'inconnu')!, /introuvable/)
})

test('chemin de dossier de l\'outil d\'import', () => {
  assert.deepEqual(parseFolderPath('Chantiers/Isolation'), { names: ['Chantiers', 'Isolation'] })
  assert.deepEqual(parseFolderPath(' /Chantiers / Isolation/ '), { names: ['Chantiers', 'Isolation'] })
  assert.ok(parseFolderPath('').error)
  assert.ok(parseFolderPath('///').error)
  assert.ok(parseFolderPath(12).error)
  assert.match(parseFolderPath('a/b/c/d').error!, /niveaux/)
  assert.match(parseFolderPath(`ok/${'x'.repeat(FOLDER_NAME_MAX + 1)}`).error!, /trop long/)
})

test('arbre pour « Déplacer vers… » : parents avant enfants, par nom', () => {
  assert.deepEqual(folderTree(folders).map(({ folder, depth }) => `${depth}:${folder.name}`), ['1:Chantiers', '2:Isolation', '3:2026', '2:Toiture', '1:Logos'])
})
