import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canSchedule, defaultScheduleInputs, describeFieldErrors, formatScheduleDate, groupSchedules, isFrequentCron, isValidTimeZone, parseScheduleTime,
  scheduleBadge, scheduleProblem, scheduleSentence, timeZoneLabel, zonedInputs, zonedToInstant,
} from './schedule'
import { rightsOn } from './access'

const PARIS = 'Europe/Paris'
const iso = (r: { at: Date } | { error: string }) => ('at' in r ? r.at.toISOString() : `erreur : ${r.error}`)

test('heure du site → instant : hiver, été, autres fuseaux', () => {
  assert.equal(iso(zonedToInstant('2026-12-03', '09:00', PARIS)), '2026-12-03T08:00:00.000Z')
  assert.equal(iso(zonedToInstant('2026-07-14', '09:00', PARIS)), '2026-07-14T07:00:00.000Z')
  assert.equal(iso(zonedToInstant('2026-12-03', '09:00', 'Indian/Reunion')), '2026-12-03T05:00:00.000Z')
  assert.equal(iso(zonedToInstant('2026-12-03', '09:00', 'America/Montreal')), '2026-12-03T14:00:00.000Z')
  assert.equal(iso(zonedToInstant('2026-12-03', '09:00', 'UTC')), '2026-12-03T09:00:00.000Z')
  // Minuit et fin de journée, autour d'un changement de jour en UTC.
  assert.equal(iso(zonedToInstant('2027-01-01', '00:00', PARIS)), '2026-12-31T23:00:00.000Z')
  assert.equal(iso(zonedToInstant('2026-12-31', '23:55', 'America/Montreal')), '2027-01-01T04:55:00.000Z')
})

test('changement d\'heure : l\'heure qui n\'existe pas est refusée, l\'heure double désigne la première', () => {
  // Passage à l'heure d'été en France : dimanche 28 mars 2027, 2 h → 3 h.
  assert.equal(iso(zonedToInstant('2027-03-28', '01:59', PARIS)), '2027-03-28T00:59:00.000Z')
  assert.match(iso(zonedToInstant('2027-03-28', '02:30', PARIS)), /n'existe pas ce jour-là \(heure de Paris\)/)
  assert.equal(iso(zonedToInstant('2027-03-28', '03:00', PARIS)), '2027-03-28T01:00:00.000Z')
  // Passage à l'heure d'hiver : dimanche 31 octobre 2027, 3 h → 2 h. 2 h 30 existe deux fois : la première (heure d'été).
  assert.equal(iso(zonedToInstant('2027-10-31', '02:30', PARIS)), '2027-10-31T00:30:00.000Z')
  assert.equal(iso(zonedToInstant('2027-10-31', '03:00', PARIS)), '2027-10-31T02:00:00.000Z')
  // La veille et le lendemain d'un changement d'heure.
  assert.equal(iso(zonedToInstant('2027-03-27', '09:00', PARIS)), '2027-03-27T08:00:00.000Z')
  assert.equal(iso(zonedToInstant('2027-03-29', '09:00', PARIS)), '2027-03-29T07:00:00.000Z')
})

test('saisies refusées : date ou heure absente, date qui n\'existe pas', () => {
  assert.match(iso(zonedToInstant('', '09:00', PARIS)), /Indiquez la date/)
  assert.match(iso(zonedToInstant('2026-12-03', '', PARIS)), /Indiquez l'heure/)
  assert.match(iso(zonedToInstant('2026-02-30', '09:00', PARIS)), /n'existe pas/)
  assert.match(iso(zonedToInstant('2026-12-03', '25:00', PARIS)), /n'existe pas/)
})

test('instant → champs de saisie : aller et retour, y compris un jour de changement d\'heure', () => {
  assert.deepEqual(zonedInputs('2026-12-03T08:00:00Z', PARIS), { date: '2026-12-03', time: '09:00' })
  assert.deepEqual(zonedInputs('2026-12-31T23:30:00Z', PARIS), { date: '2027-01-01', time: '00:30' })
  for (const [date, time] of [['2027-03-28', '03:15'], ['2027-10-31', '01:45'], ['2026-06-01', '23:55']] as const) {
    const r = zonedToInstant(date, time, PARIS)
    assert.ok('at' in r)
    assert.deepEqual(zonedInputs(r.at, PARIS), { date, time })
  }
})

test('heure demandée : passée, trop lointaine, instant complet de l\'API', () => {
  const now = new Date('2026-11-20T10:00:00Z')
  assert.equal(iso(parseScheduleTime({ date: '2026-12-03', time: '09:00' }, PARIS, now)), '2026-12-03T08:00:00.000Z')
  assert.match(iso(parseScheduleTime({ date: '2026-11-20', time: '10:59' }, PARIS, now)), /déjà passée \(heure de Paris\)/)
  assert.equal(iso(parseScheduleTime({ date: '2026-11-20', time: '11:01' }, PARIS, now)), '2026-11-20T10:01:00.000Z')
  assert.match(iso(parseScheduleTime({ date: '2029-12-03', time: '09:00' }, PARIS, now)), /plus de deux ans/)
  assert.equal(iso(parseScheduleTime({ at: '2026-12-03T09:00:00+01:00' }, PARIS, now)), '2026-12-03T08:00:00.000Z')
  assert.equal(iso(parseScheduleTime({ at: '2026-12-03T08:00:00Z' }, PARIS, now)), '2026-12-03T08:00:00.000Z')
  // Sans décalage, l'instant serait ambigu : refusé.
  assert.match(iso(parseScheduleTime({ at: '2026-12-03T09:00' }, PARIS, now)), /décalage/)
  assert.match(iso(parseScheduleTime({ at: 12 }, PARIS, now)), /décalage/)
  assert.match(iso(parseScheduleTime({}, PARIS, now)), /Indiquez la date/)
})

test('affichage : date en clair, année seulement si elle diffère, nom du fuseau', () => {
  const now = new Date('2026-11-20T10:00:00Z')
  assert.equal(formatScheduleDate('2026-12-03T08:00:00Z', PARIS, now), 'le 3 décembre à 9 h 00')
  assert.equal(formatScheduleDate('2026-12-01T13:05:00Z', PARIS, now), 'le 1er décembre à 14 h 05')
  assert.equal(formatScheduleDate('2027-01-02T08:30:00Z', PARIS, now), 'le 2 janvier 2027 à 9 h 30')
  // Le même instant, dit dans un autre fuseau, n'est pas la même heure : d'où le rappel du fuseau partout.
  assert.equal(formatScheduleDate('2026-12-03T08:00:00Z', 'America/Montreal', now), 'le 3 décembre à 3 h 00')
  assert.equal(timeZoneLabel(PARIS), 'heure de Paris')
  assert.equal(timeZoneLabel('UTC'), 'heure universelle (UTC)')
  assert.match(timeZoneLabel('Indian/Reunion'), /Indian\/Reunion/)
  assert.deepEqual(defaultScheduleInputs(PARIS, new Date('2026-11-20T23:30:00Z')), { date: '2026-11-22', time: '09:00' })
  assert.equal(isValidTimeZone('Europe/Paris'), true)
  assert.equal(isValidTimeZone('Europe/Lutece'), false)
  assert.equal(isValidTimeZone(''), false)
  assert.equal(isValidTimeZone(undefined), false)
})

test('règles : ce qui peut être programmé selon l\'état de la langue', () => {
  const at = new Date('2026-12-03T08:00:00Z')
  const check = (action: 'publish' | 'unpublish', status: 'draft' | 'published' | 'changed' | null, others: { action: 'publish' | 'unpublish'; at: string }[] = []) =>
    scheduleProblem({ action, at, status, others })
  assert.equal(check('publish', 'draft'), null)
  assert.equal(check('publish', 'changed'), null)
  assert.match(check('publish', 'published')!, /déjà en ligne/)
  assert.match(check('publish', null)!, /rien dans cette langue/)
  assert.equal(check('unpublish', 'published'), null)
  assert.equal(check('unpublish', 'changed'), null)
  assert.match(check('unpublish', 'draft')!, /pas en ligne/)
  // Une offre : mise en ligne le 1er, retrait le 3.
  assert.equal(check('unpublish', 'draft', [{ action: 'publish', at: '2026-12-01T08:00:00Z' }]), null)
  assert.match(check('unpublish', 'draft', [{ action: 'publish', at: '2026-12-05T08:00:00Z' }])!, /pas en ligne/)
  // Une fermeture : retrait le 1er, remise en ligne le 3.
  assert.equal(check('publish', 'published', [{ action: 'unpublish', at: '2026-12-01T08:00:00Z' }]), null)
  assert.match(check('publish', 'draft', [{ action: 'unpublish', at: '2026-12-03T08:00:00Z' }])!, /même heure/)
  // Une autre programmation de la même action ne compte pas : elle sera remplacée.
  assert.equal(check('publish', 'draft', [{ action: 'publish', at: '2026-12-03T08:00:00Z' }]), null)
})

test('droits : seul qui peut publier programme, et seulement là où il y a des brouillons', () => {
  const def = { kind: 'collection', drafts: true } as never
  const who = (role: string) => rightsOn({ id: 'u', role }, 'services', def)
  assert.equal(canSchedule({ drafts: true }, who('admin')), true)
  assert.equal(canSchedule({ drafts: true }, who('editor')), true)
  assert.equal(canSchedule({ drafts: true }, who('writer')), false)
  assert.equal(canSchedule({ drafts: false }, who('admin')), false)
  assert.equal(canSchedule(undefined, who('admin')), false)
  assert.equal(canSchedule({ drafts: true }, null), false)
})

test('déclencheur fréquent ou de nuit', () => {
  assert.equal(isFrequentCron('*/5 * * * *'), true)
  assert.equal(isFrequentCron('*/15 * * * *'), true)
  assert.equal(isFrequentCron('0 * * * *'), true)
  assert.equal(isFrequentCron('0,30 8-18 * * *'), true)
  assert.equal(isFrequentCron('17 3 * * *'), false)
  assert.equal(isFrequentCron('59 23 31 12 *'), false)
  assert.equal(isFrequentCron(''), true)
})

test('état affiché : phrases, langues réunies, échec, statut de liste', () => {
  const now = new Date('2026-11-20T10:00:00Z')
  const base = { at: '2026-12-03T08:00:00.000Z', by: 'Claire Durand', byId: 'u1' }
  const list = [
    { ...base, locale: 'en', action: 'publish' as const },
    { ...base, locale: 'fr', action: 'publish' as const },
    { ...base, locale: 'fr', action: 'unpublish' as const, at: '2026-12-24T17:00:00.000Z' },
  ]
  const groups = groupSchedules(list, ['fr', 'en'])
  assert.deepEqual(groups.map(g => [g.action, g.locales]), [['publish', ['fr', 'en']], ['unpublish', ['fr']]])
  assert.equal(scheduleSentence(groups[0]!, PARIS, { now }), 'Mise en ligne programmée le 3 décembre à 9 h 00 (heure de Paris) par Claire Durand — français et anglais')
  assert.equal(scheduleSentence({ ...groups[0]!, locales: [] }, PARIS, { now, me: true }), 'Mise en ligne programmée le 3 décembre à 9 h 00 (heure de Paris) par vous')
  assert.equal(scheduleSentence({ ...groups[1]!, locales: [] }, PARIS, { now }), 'Retrait du site programmé le 24 décembre à 18 h 00 (heure de Paris) par Claire Durand')
  const failed = { ...list[1]!, failedAt: '2026-12-03T08:00:05.000Z', error: 'Le contenu n\'est plus complet.' }
  assert.equal(scheduleSentence({ ...failed, locales: [] }, PARIS, { now }), 'La mise en ligne prévue le 3 décembre à 9 h 00 (heure de Paris) n\'a pas pu se faire : Le contenu n\'est plus complet.')
  // Un échec passe en tête, et n'est pas réuni avec ce qui est encore en attente.
  assert.deepEqual(groupSchedules([list[0]!, failed, list[2]!], ['fr', 'en']).map(g => [!!g.failedAt, g.locales]), [[true, ['fr']], [false, ['en']], [false, ['fr']]])

  assert.equal(scheduleBadge([], PARIS, now), null)
  assert.deepEqual(scheduleBadge([{ action: 'unpublish', at: '2026-12-24T17:00:00Z' }, { action: 'publish', at: '2026-12-03T08:00:00Z' }], PARIS, now),
    { label: 'Programmé', title: 'Mise en ligne le 3 décembre à 9 h 00 (heure de Paris)', failed: false })
  assert.equal(scheduleBadge([{ action: 'unpublish', at: '2026-12-24T17:00:00Z' }], PARIS, now)!.label, 'Retrait programmé')
  assert.equal(scheduleBadge([{ action: 'publish', at: '2026-12-03T08:00:00Z', failed: true }, { action: 'unpublish', at: '2026-12-24T17:00:00Z' }], PARIS, now)!.label, 'Programmation en échec')
})

test('échec : les champs à corriger sont dits en une phrase', () => {
  const labels = { title: 'Titre', excerpt: 'Résumé' }
  assert.equal(describeFieldErrors({ fr: { title: 'Ce champ est obligatoire.' } }, labels, false), '« Titre » : Ce champ est obligatoire.')
  assert.equal(describeFieldErrors({ fr: { title: 'Ce champ est obligatoire.', price: 'Ce champ est obligatoire.', slug: 'Une adresse est nécessaire pour publier.' }, en: { _: 'Rien à publier dans cette langue.', price: 'Ce champ est obligatoire.' } }, { ...labels, price: 'Tarif' }, true, ['price']),
    '« Titre » : Ce champ est obligatoire (français) ; « Tarif » : Ce champ est obligatoire ; « Adresse de la page » : Une adresse est nécessaire pour publier (français) ; Rien à publier dans cette langue (anglais).')
})
