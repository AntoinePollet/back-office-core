import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIVE_PREVIEW_TAG, type LiveDraft, applyLiveDraft, applyLiveDrafts, clampLiveShare, liveFrameUrl, liveScale, parseReadKey, readLiveMessage } from './live-preview.ts'

// Clés telles que `useCms.ts` les construit.
const key = (kind: string, target: string, query: Record<string, unknown>) => `cms:${kind}:${target}:${JSON.stringify(query)}`
const draft = (over: Partial<LiveDraft> = {}): LiveDraft => ({
  type: 'services', id: 's1', locale: 'fr', defaultLocale: 'fr',
  entry: { id: 's1', locale: 'fr', title: 'En cours de saisie' },
  ...over,
})
const saved = { id: 's1', locale: 'fr', title: 'Enregistré' }
const other = { id: 's2', locale: 'fr', title: 'Autre service' }

test('clé d\'une lecture : nature, type, langue, aperçu', () => {
  assert.deepEqual(parseReadKey(key('liste', 'services', { preview: '1' })), { kind: 'liste', type: 'services', locale: null, preview: true })
  assert.deepEqual(parseReadKey(key('page', 'services', { locale: 'en', preview: '1', limit: 10, page: 2 })), { kind: 'page', type: 'services', locale: 'en', preview: true })
  assert.deepEqual(parseReadKey(key('contenu', 'services/droit-social', { preview: 'jeton' })), { kind: 'contenu', type: 'services', locale: null, preview: true })
  assert.deepEqual(parseReadKey(key('page-unique', 'home', {})), { kind: 'page-unique', type: 'home', locale: null, preview: false })
  // Un filtre dont la valeur contient des deux-points ou des accolades ne trompe pas la lecture de la clé.
  assert.deepEqual(parseReadKey(key('liste', 'services', { 'where[title]': 'a:{b}', 'preview': '1' })), { kind: 'liste', type: 'services', locale: null, preview: true })
  for (const bad of ['', 'autre:liste:services:{}', 'cms:inconnu:services:{}', 'cms:liste:services', 'cms:liste:services:{pas du json}', 'cms:liste:services:[]'])
    assert.equal(parseReadKey(bad), null, bad)
})

test('contenu lu par son adresse : remplacé si c\'est lui, quelle que soit l\'adresse', () => {
  const k = key('contenu', 'services/ancienne-adresse', { preview: '1' })
  assert.deepEqual(applyLiveDraft(k, saved, draft()), draft().entry)
  assert.equal(applyLiveDraft(k, other, draft()), other)
  // Réponse de redirection ou absente : laissée telle quelle.
  const moved = { _redirect: '/services/nouvelle' }
  assert.equal(applyLiveDraft(k, moved, draft()), moved)
  assert.equal(applyLiveDraft(k, null, draft()), null)
})

test('page unique : remplacée, même quand rien n\'est encore enregistré', () => {
  const home = draft({ type: 'home', id: 'home', entry: { id: 'home', locale: 'fr', heroTitle: 'Bonjour' } })
  const k = key('page-unique', 'home', { preview: '1' })
  assert.equal(applyLiveDraft(k, { id: 'home', locale: 'fr', heroTitle: 'Avant' }, home), home.entry)
  assert.equal(applyLiveDraft(k, null, home), home.entry)
  // Une autre page unique n'est pas touchée.
  const settings = { id: 'settings', locale: 'fr' }
  assert.equal(applyLiveDraft(key('page-unique', 'settings', { preview: '1' }), settings, home), settings)
})

test('liste : l\'élément est remplacé à sa place, la liste n\'est ni complétée ni triée', () => {
  const k = key('liste', 'services', { preview: '1' })
  const list = [other, saved]
  const next = applyLiveDraft(k, list, draft())
  assert.deepEqual(next, [other, draft().entry])
  assert.notEqual(next, list) // nouvel objet : l'affichage se met à jour
  assert.equal(list[1], saved) // la réponse d'origine n'est pas modifiée
  // Contenu absent de la liste (filtré, ou sur une autre page) : rien ne change, et c'est le même objet.
  const without = [other]
  assert.equal(applyLiveDraft(k, without, draft()), without)
  assert.equal(applyLiveDraft(k, null, draft()), null)
})

test('page de liste : seuls les éléments changent, la pagination est gardée', () => {
  const k = key('page', 'services', { preview: '1', limit: 10, page: 1 })
  const page = { items: [saved, other], total: 12, page: 1, limit: 10, pageCount: 2 }
  assert.deepEqual(applyLiveDraft(k, page, draft()), { ...page, items: [draft().entry, other] })
  const elsewhere = { ...page, items: [other] }
  assert.equal(applyLiveDraft(k, elsewhere, draft()), elsewhere)
})

test('rien n\'est remplacé hors aperçu, pour un autre type ou une autre langue', () => {
  // Lecture du site en ligne (sans ?preview) : jamais de contenu non enregistré.
  assert.equal(applyLiveDraft(key('contenu', 'services/x', {}), saved, draft()), saved)
  const list = [saved]
  assert.equal(applyLiveDraft(key('liste', 'services', {}), list, draft()), list)
  // Autre type qui porterait le même identifiant.
  assert.equal(applyLiveDraft(key('liste', 'products', { preview: '1' }), list, draft()), list)
  // Langue : la lecture sans langue est dans la langue par défaut du site.
  const english = draft({ locale: 'en', entry: { id: 's1', locale: 'en', title: 'Being typed' } })
  assert.equal(applyLiveDraft(key('liste', 'services', { preview: '1' }), list, english), list)
  const en = [{ id: 's1', locale: 'en', title: 'Saved' }]
  assert.deepEqual(applyLiveDraft(key('liste', 'services', { locale: 'en', preview: '1' }), en, english), [english.entry])
  assert.equal(applyLiveDraft(key('liste', 'services', { locale: 'en', preview: '1' }), en, draft()), en)
  // Clé qui n'est pas une lecture du core.
  assert.equal(applyLiveDraft('ma-cle', list, draft()), list)
})

test('plusieurs contenus en cours de saisie sur la même réponse', () => {
  const second = draft({ id: 's2', entry: { id: 's2', locale: 'fr', title: 'Autre, modifié' } })
  assert.deepEqual(applyLiveDrafts(key('liste', 'services', { preview: '1' }), [saved, other], [draft(), second]), [draft().entry, second.entry])
})

test('messages : seule la bonne fenêtre, de la même origine, est écoutée', () => {
  const frame = {}, parent = {}, origin = 'https://site.example'
  const ready = { tag: LIVE_PREVIEW_TAG, kind: 'ready', path: '/services/x' }
  const sent = { tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: draft() }
  assert.deepEqual(readLiveMessage({ origin, source: frame, data: ready }, { origin, source: frame }), ready)
  assert.deepEqual(readLiveMessage({ origin, source: parent, data: sent }, { origin, source: parent }), sent)
  // Autre origine : ignoré, même avec un message bien formé.
  assert.equal(readLiveMessage({ origin: 'https://ailleurs.example', source: parent, data: sent }, { origin, source: parent }), null)
  assert.equal(readLiveMessage({ origin: 'https://site.example.ailleurs.example', source: parent, data: sent }, { origin, source: parent }), null)
  assert.equal(readLiveMessage({ origin: 'http://site.example', source: parent, data: sent }, { origin, source: parent }), null)
  // Autre fenêtre de la même origine (un autre cadre, une fenêtre ouverte par la page).
  assert.equal(readLiveMessage({ origin, source: {}, data: sent }, { origin, source: parent }), null)
  assert.equal(readLiveMessage({ origin, source: null, data: sent }, { origin, source: null }), null)
  // Origine opaque (cadre en bac à sable, fichier local).
  assert.equal(readLiveMessage({ origin: 'null', source: parent, data: sent }, { origin: 'null', source: parent }), null)
})

test('messages : toute autre forme est ignorée', () => {
  const source = {}, origin = 'https://site.example'
  const read = (data: unknown) => readLiveMessage({ origin, source, data }, { origin, source })
  for (const data of [null, 'texte', 42, [], {}, { tag: 'autre', kind: 'ready', path: '/' }, { tag: LIVE_PREVIEW_TAG }, { tag: LIVE_PREVIEW_TAG, kind: 'ready' },
    { tag: LIVE_PREVIEW_TAG, kind: 'inconnu' }, { tag: LIVE_PREVIEW_TAG, kind: 'draft' }, { tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: { ...draft(), entry: null } },
    { tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: { ...draft(), type: '' } }])
    assert.equal(read(data), null, JSON.stringify(data))
  // Le contenu transmis doit être celui qui est annoncé.
  assert.equal(read({ tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: draft({ entry: { id: 'autre', locale: 'fr' } }) }), null)
  assert.equal(read({ tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: draft({ entry: { id: 's1', locale: 'en' } }) }), null)
  // Ce qui dépasse de la forme prévue n'est pas transmis.
  assert.deepEqual(read({ tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: { ...draft(), extra: 1 }, autre: true }), { tag: LIVE_PREVIEW_TAG, kind: 'draft', draft: draft() })
})

test('cadre : adresse d\'aperçu, réduction et partage de la largeur', () => {
  assert.equal(liveFrameUrl('/services/x'), '/services/x?preview=1')
  assert.equal(liveFrameUrl('/'), '/?preview=1')
  assert.equal(liveScale(1280, 640), 0.5)
  assert.equal(liveScale(390, 640), 1) // jamais agrandi
  assert.equal(liveScale(1280, 0), 1)
  assert.equal(clampLiveShare(0.1), 0.3)
  assert.equal(clampLiveShare(0.9), 0.7)
  assert.equal(clampLiveShare(0.55), 0.55)
  assert.equal(clampLiveShare(Number.NaN), 0.5)
})
