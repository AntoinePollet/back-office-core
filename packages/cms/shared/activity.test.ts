import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACTIVITY_ACTIONS, ACTIVITY_CATEGORIES, type ActivityAction, activityCsv, activityFromEvents, activityPhrase, activitySentence, csvCell, joinFr, languageName } from './activity.ts'

const say = (name: string | null, action: ActivityAction, details = {}) => activitySentence(name, activityPhrase(action, details))

test('phrases des contenus : personne, action, titre, type et langue', () => {
  const service = { title: 'Droit des affaires', typeLabel: 'Services' }
  assert.equal(say('Claire Durand', 'entry.published', { ...service, locales: ['fr'] }), 'Claire Durand a publié « Droit des affaires » (Services, français)')
  assert.equal(say('Claire Durand', 'entry.published', { ...service, locales: ['fr', 'en'] }), 'Claire Durand a publié « Droit des affaires » (Services, français et anglais)')
  assert.equal(say('Marc Petit', 'entry.unpublished', { ...service, locales: ['en'] }), 'Marc Petit a retiré du site « Droit des affaires » (Services, anglais)')
  assert.equal(say('Marc Petit', 'entry.created', service), 'Marc Petit a créé « Droit des affaires » (Services)')
  assert.equal(say('Marc Petit', 'entry.updated', service), 'Marc Petit a modifié « Droit des affaires » (Services)')
  assert.equal(say('Marc Petit', 'entry.deleted', service), 'Marc Petit a supprimé « Droit des affaires » (Services) (mis à la corbeille)')
  assert.equal(say('Marc Petit', 'entry.restored', service), 'Marc Petit a restauré « Droit des affaires » (Services) depuis la corbeille')
  assert.equal(say('Claire Durand', 'entry.purged', service), 'Claire Durand a supprimé définitivement « Droit des affaires » (Services)')
  assert.equal(say('Claire Durand', 'entry.revision_restored', service), 'Claire Durand a restauré une version précédente de « Droit des affaires » (Services)')
  assert.equal(say('Claire Durand', 'entry.reordered', { typeLabel: 'Services' }), 'Claire Durand a changé l\'ordre des contenus de « Services »')
  // Page unique : pas de type entre parenthèses ; titre vide : « Sans titre ».
  assert.equal(say('Claire Durand', 'entry.published', { title: 'Accueil', single: true, locales: ['fr'] }), 'Claire Durand a publié la page « Accueil » (français)')
  assert.equal(say('Claire Durand', 'entry.created', { title: '', typeLabel: 'Services' }), 'Claire Durand a créé « Sans titre » (Services)')
})

test('phrases des fichiers, des comptes et des réglages', () => {
  assert.equal(say('Marc Petit', 'media.uploaded', { name: 'photo.png' }), 'Marc Petit a envoyé le fichier « photo.png »')
  assert.equal(say('Marc Petit', 'media.moved', { count: 1, name: 'photo.png', to: 'Chantiers' }), 'Marc Petit a déplacé le fichier « photo.png » dans le dossier « Chantiers »')
  assert.equal(say('Marc Petit', 'media.moved', { count: 3 }), 'Marc Petit a déplacé 3 fichiers à la racine de la médiathèque')
  assert.equal(say('Marc Petit', 'folder.renamed', { from: 'Chantiers', to: 'Réalisations' }), 'Marc Petit a renommé le dossier « Chantiers » en « Réalisations »')
  assert.equal(say('Claire Durand', 'user.invited', { name: 'Lina Roux', email: 'lina@example.com', role: 'Rédacteur' }), 'Claire Durand a invité Lina Roux (lina@example.com) avec le rôle « Rédacteur »')
  assert.equal(say('Claire Durand', 'user.role_changed', { name: 'Lina Roux', email: 'lina@example.com', from: 'Rédacteur', to: 'Éditeur' }), 'Claire Durand a changé le rôle de Lina Roux (lina@example.com) : Rédacteur → Éditeur')
  assert.equal(say('Claire Durand', 'user.types_changed', { name: 'Lina Roux', list: ['Services', 'Accueil'] }), 'Claire Durand a limité Lina Roux à 2 contenus : Services, Accueil')
  assert.equal(say('Claire Durand', 'user.types_changed', { name: 'Lina Roux' }), 'Claire Durand a donné à Lina Roux l\'accès à tous les contenus de son rôle')
  assert.equal(say('Claire Durand', 'user.deleted', { name: 'Lina Roux', email: 'lina@example.com' }), 'Claire Durand a supprimé le compte de Lina Roux (lina@example.com)')
  assert.equal(say('Claire Durand', 'module.updated', { name: 'Brevo' }), 'Claire Durand a modifié les réglages du module « Brevo »')
  assert.equal(say('Claire Durand', 'workflow.toggled', { name: 'Alerte', to: 'off' }), 'Claire Durand a mis en pause le workflow « Alerte »')
  assert.equal(say('Claire Durand', 'preview_link.created', { name: 'Pour le client', days: 7 }), 'Claire Durand a créé un lien d\'aperçu « Pour le client », valable 7 jours')
  assert.equal(say('Claire Durand', 'migration.applied', { count: 1 }), 'Claire Durand a validé une migration de contenu (1 changement appliqué)')
  assert.equal(say('Claire Durand', 'trash.emptied', { count: 2 }), 'Claire Durand a vidé la corbeille (2 éléments supprimés définitivement)')
  assert.equal(say('Claire Durand', 'auth.login'), 'Claire Durand a ouvert une session')
})

test('sans personne, la phrase se lit seule', () => {
  assert.equal(say(null, 'auth.failures', { email: 'claire@example.com', count: 3 }), '3 échecs de connexion de suite pour le compte claire@example.com')
  assert.equal(say(null, 'auth.blocked', { email: 'claire@example.com', count: 8 }), 'Connexion bloquée un moment pour le compte claire@example.com, après 8 échecs')
  assert.equal(say(null, 'auth.blocked', { count: 40 }), 'Connexions bloquées un moment depuis une même adresse, après 40 échecs')
  assert.equal(say('', 'trash.expired', { count: 1 }), 'Corbeille : 1 élément supprimé définitivement après le délai de récupération')
  assert.equal(activitySentence(null, 'a créé une sauvegarde'), 'A créé une sauvegarde')
})

test('chaque action a une famille connue, un libellé et une phrase', () => {
  for (const [code, meta] of Object.entries(ACTIVITY_ACTIONS)) {
    assert.ok(meta.category in ACTIVITY_CATEGORIES, code)
    assert.ok(meta.label, code)
    assert.ok(meta.phrase({}).length > 5, code)
  }
  assert.equal(languageName('en'), 'anglais')
  assert.equal(joinFr(['a', 'b', 'c']), 'a, b et c')
})

test('événements d\'un enregistrement → lignes du journal, avec retenue', () => {
  const e = (name: string, locale?: string) => ({ name, type: 'services', id: 's1', title: 'Droit social', locale })
  const actions = (events: ReturnType<typeof e>[], hint?: Parameters<typeof activityFromEvents>[1]) => activityFromEvents(events, hint).map(l => [l.action, ...(l.locales ?? [])].join(' '))
  // Enregistrer un brouillon : une ligne « modifié ».
  assert.deepEqual(actions([e('entry.updated')]), ['entry.updated'])
  // Publier deux langues : une seule ligne, sans « modifié » en plus.
  assert.deepEqual(actions([e('entry.updated'), e('entry.published', 'fr'), e('entry.published', 'en')]), ['entry.published fr en'])
  // Créer et publier : deux lignes.
  assert.deepEqual(actions([e('entry.created'), e('entry.published', 'fr')]), ['entry.created', 'entry.published fr'])
  assert.deepEqual(actions([e('entry.updated'), e('entry.unpublished', 'fr')]), ['entry.unpublished fr'])
  // Rien n'a changé : rien au journal. Version restaurée, copie : dites telles.
  assert.deepEqual(actions([e('entry.updated')], 'unchanged'), [])
  assert.deepEqual(actions([e('entry.updated')], 'revision'), ['entry.revision_restored'])
  assert.deepEqual(actions([e('entry.created')], 'duplicate'), ['entry.duplicated'])
  assert.deepEqual(actions([e('entry.deleted')]), ['entry.deleted'])
  assert.deepEqual(actions([e('entry.restored')]), ['entry.restored'])
  // Les événements des modules et des comptes ne sont pas des contenus.
  assert.deepEqual(activityFromEvents([{ name: 'form.submitted' }, { name: 'user.invited' }]), [])
})

test('export CSV : séparateur français, guillemets doublés, formules neutralisées', () => {
  assert.equal(csvCell('a "b"'), '"a ""b"""')
  for (const text of ['=1+1', '+33 6', '-2', '@SUM(A1)', '\tx']) assert.equal(csvCell(text), `"'${text}"`)
  assert.equal(csvCell('claire@example.com'), '"claire@example.com"')
  const csv = activityCsv([{ at: Date.UTC(2026, 10, 19, 9, 5, 0), actorName: '=cmd|\'/c calc\'!A1', actorEmail: 'x@example.com', action: 'entry.published', category: 'content', summary: 'a publié « A ; B »', ip: null }])
  const [head, line] = csv.split('\r\n')
  assert.equal(head, '﻿"Date";"Personne";"E-mail";"Type d\'action";"Action";"Adresse IP"')
  assert.equal(line, '"19/11/2026 10:05:00";"\'=cmd|\'/c calc\'!A1";"x@example.com";"Contenu publié";"a publié « A ; B »";""')
})
