// Module « Avis Google » : réglages, vérification, refus traduits, fiche (note, avis, horaires), mémoire d'une heure,
// rien d'enregistré en base, bloc du site conforme aux règles de Google, horaires dans les données structurées, écran.
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, login, menuLabels, says } from '../lib/harness.mjs'
import { PLACES_KEY_INVALID, PLACES_KEY_NO_API, PLACE_DOWN, PLACE_NEW, PLACE_UNKNOWN } from '../lib/mock-google.mjs'
import { runSql } from '../lib/sqlite.mjs'

function databaseFile() {
  if (config.target === 'node') return path.join(config.tmpDir, 'etat', 'cms.sqlite')
  const dir = path.join(config.tmpDir, 'etat', 'v3', 'd1', 'miniflare-D1DatabaseObject')
  return path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite'))
}

export const meta = {
  title: 'avis Google : fiche de l\'établissement, avis sur le site, horaires',
  mock: true,
  env: ({ mock }) => ({ NUXT_GOOGLE_PLACES_API_URL: `${mock}/google-places/v1` }),
}

const PLACE = 'ChIJN1t_tDeuEmsRUsoyG83frY4'
const KEY = 'AIzaSy-cle-du-site-1234567890'

export default async function (t) {
  const { B, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), lina = t.http(), visitor = t.http()
  const lookups = () => calls().filter(c => c.url.startsWith('/google-places/'))
  const save = (values, secrets) => claire.call('/api/cms/modules/google-business', { method: 'PUT', body: { values, ...(secrets ? { secrets } : {}) } })
  const verify = async () => (await claire.json('/api/cms/modules/google-business/test', { method: 'POST' }))
  const admin = (client = claire) => client.call('/api/cms/google-business')
  const site = (query = '') => visitor.call(`/api/google-business${query}`)

  await step('module désactivé : rien de public, pas de menu ; activé : à régler, le site n\'affiche rien', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'google-business')
    check(listed && !listed.enabled && listed.category === 'seo', JSON.stringify(listed))
    check((await site()).status === 404 && (await admin()).status === 404, 'fiche servie alors que le module est désactivé')
    check(!(await menuLabels(page)).includes('Avis Google'), 'menu affiché')
    // Sans le module, la page d'exemple s'affiche sans le bloc, et sans erreur.
    const off = await visitor.get('/avis')
    check(off.status === 200 && !off.text.includes('data-cms-reviews'), `page d'exemple : ${off.status}`)
    check((await claire.call('/api/cms/modules/google-business/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    check((await admin()).json.state === 'unconfigured' && (await site()).json.place === null && lookups().length === 0, 'Google appelé sans réglages')
  })

  await step('réglages : identifiant mal écrit refusé, clé jamais renvoyée ; vérification : établissement nommé', async () => {
    const bad = await save({ placeId: 'https://maps.google.com/?cid=12345' })
    check(bad.status === 400 && /ChIJ/.test(bad.json.message), `${bad.status} ${bad.text}`)
    const saved = (await save({ placeId: PLACE }, { apiKey: KEY })).json
    check(saved.configured && saved.enabled, JSON.stringify(saved).slice(0, 200))
    check(!(await claire.get('/api/cms/modules/google-business')).text.includes(KEY), 'la clé est renvoyée par l\'API')
    const r = await verify()
    check(r.ok && r.message === 'Établissement trouvé : « Cabinet Durand », 12 rue des Lilas, 69003 Lyon, France. Note de 4,7 sur 5 (128 avis).', JSON.stringify(r))
    const call = lookups().pop()
    check(call.url === `/google-places/v1/places/${PLACE}?languageCode=fr` && call.googleKey === KEY, JSON.stringify(call))
    // Seuls les champs utiles sont demandés (chacun est facturé), sans espace dans la liste.
    check(call.fieldMask === 'id,displayName,rating,userRatingCount,googleMapsUri,googleMapsLinks,formattedAddress,nationalPhoneNumber,businessStatus,regularOpeningHours,reviews', call.fieldMask)
  })

  await step('refus de Google traduits : clé inconnue, API non activée, établissement introuvable, panne ; établissement sans avis', async () => {
    await save({}, { apiKey: PLACES_KEY_INVALID })
    let r = await verify()
    check(!r.ok && /ne reconnaît pas cette clé/.test(r.message), JSON.stringify(r))
    const refused = (await admin()).json
    check(refused.state === 'refused' && (await site()).json.place === null, JSON.stringify(refused))
    await save({}, { apiKey: PLACES_KEY_NO_API })
    r = await verify()
    check(!r.ok && /Places API \(New\)/.test(r.message), JSON.stringify(r))
    await save({ placeId: PLACE_UNKNOWN }, { apiKey: KEY })
    r = await verify()
    check(!r.ok && /ne trouve pas cet établissement/.test(r.message), JSON.stringify(r))
    await save({ placeId: PLACE_DOWN })
    r = await verify()
    check(!r.ok && /ne répond pas/.test(r.message) && (await admin()).json.state === 'unavailable', JSON.stringify(r))
    await save({ placeId: PLACE_NEW })
    r = await verify()
    check(r.ok && /n'a pas encore d'avis/.test(r.message), JSON.stringify(r))
    const fresh = (await site()).json.place
    check(fresh.name === 'Cabinet tout neuf' && fresh.rating === null && fresh.count === 0 && fresh.reviews.length === 0 && fresh.hours === null, JSON.stringify(fresh))
    // Sans note, le bloc du site ne s'affiche pas.
    check(!(await visitor.get('/avis')).text.includes('data-cms-reviews'), 'bloc affiché sans avis')
    await save({ placeId: PLACE })
  })

  await step('fiche pour le site : note, avis avec leur auteur et leur lien, horaires ; langue demandée ; cache du site', async () => {
    const r = await site()
    const place = r.json.place
    check(r.status === 200 && config.siteCached(r.headers.get('cache-control')), `cache : ${r.headers.get('cache-control')}`)
    check(place.name === 'Cabinet Durand' && place.rating === 4.7 && place.count === 128 && place.reviewsUrl.includes('/reviews/') && place.writeReviewUrl.includes('/write/') && place.closed === null, JSON.stringify(place).slice(0, 300))
    const [first] = place.reviews
    check(place.reviews.length === 3 && first.author === 'Jeanne Martin' && first.authorUrl === 'https://www.google.com/maps/contrib/1' && first.authorPhoto.includes('photo-1') && first.rating === 5 && first.when === 'il y a un mois' && first.visit === '2026-09' && first.url === 'https://www.google.com/maps/reviews/1' && first.translated === false, JSON.stringify(first))
    check(place.hours.periods.length === 5 && place.hours.lines[0] === 'lundi: 09:00 – 18:00', JSON.stringify(place.hours))
    check(!r.text.includes(KEY), 'la clé sort par la route publique')
    const en = (await site('?locale=en')).json.place
    check(en.reviews[0].text === 'Very clear advice.' && en.reviews[0].translated === true && en.reviews[0].original.startsWith('Conseils très clairs') && en.reviews[0].when === 'a month ago', JSON.stringify(en.reviews[0]))
    check(lookups().pop().url.endsWith('languageCode=en'), 'langue non transmise à Google')
    // Une langue que le site n'a pas reçoit celle du site.
    check((await site('?locale=xx')).json.place.reviews[0].when === 'il y a un mois', 'langue inconnue acceptée')
  })

  await step('mémoire d\'une heure : Google n\'est pas rappelé à chaque page ; rien de ce que Google renvoie n\'est écrit en base', async () => {
    const before = lookups().length
    await site(); await site('?locale=en'); await admin()
    check(lookups().length === before, `${lookups().length - before} appels pour une fiche déjà lue`)
    const dump = runSql(databaseFile(), '.dump')
    check(!dump.includes('Jeanne Martin') && !dump.includes('Conseils très clairs') && dump.includes(PLACE), 'un avis est enregistré en base')
  })

  await step('bloc du site : auteur, photo, lien vers l\'avis, mention « Google Maps », ordre expliqué ; texte jamais interprété', async () => {
    const html = (await visitor.get('/avis')).text
    check(html.includes('data-cms-reviews') && html.includes('Jeanne Martin'), 'bloc absent de la page rendue par le serveur')
    const view = await t.newPage({ context: await t.newContext() })
    await view.goto(B + '/avis', { waitUntil: 'networkidle0' })
    const summary = await view.$eval('[data-avis-resume] [data-cms-reviews]', el => ({ rating: el.querySelector('[data-cms-reviews-rating]').textContent, count: el.querySelector('[data-cms-reviews-count]').textContent.trim(), reviews: el.querySelectorAll('[data-cms-review]').length, source: el.querySelector('[data-cms-reviews-source]').textContent, translate: el.querySelector('[data-cms-reviews-source]').getAttribute('translate') }))
    check(summary.rating === '4,7' && summary.count === '128 avis' && summary.reviews === 0 && summary.source === 'Google Maps' && summary.translate === 'no', JSON.stringify(summary))
    // Les avis d'au moins quatre étoiles : deux sur trois.
    const list = await view.$$eval('[data-avis-liste] [data-cms-review]', items => items.map(li => ({
      author: li.querySelector('.cms-reviews-author a')?.textContent, profile: li.querySelector('.cms-reviews-author a')?.href, photo: li.querySelector('img')?.src,
      source: [...li.querySelectorAll('a')].at(-1)?.href, text: li.querySelector('.cms-reviews-text')?.textContent, bold: li.querySelectorAll('b').length, all: li.innerText,
    })))
    check(list.length === 2 && list[0].author === 'Jeanne Martin' && list[0].profile === 'https://www.google.com/maps/contrib/1' && list[0].photo.includes('photo-1') && list[0].source === 'https://www.google.com/maps/reviews/1', JSON.stringify(list[0]))
    check(list[0].text === 'Conseils très clairs, <b>merci</b> !' && list[0].bold === 0 && list[0].all.includes('il y a un mois') && list[0].all.includes('Visite : septembre 2026'), JSON.stringify(list[0]))
    const foot = await view.$eval('[data-avis-liste] .cms-reviews-foot', el => el.innerText)
    check(foot.includes('Avis les plus pertinents selon Google') && foot.includes('Voir tous les avis') && foot.includes('Laisser un avis'), foot)
    check(await view.$eval('[data-avis-liste] [data-cms-reviews-source]', el => el.textContent) === 'Google Maps', 'mention Google Maps absente')
    await view.goto(B + '/avis?lang=en', { waitUntil: 'networkidle0' })
    const english = await view.$eval('[data-avis-liste] [data-cms-reviews]', el => el.innerText)
    check(english.includes('Very clear advice.') && english.includes('Translated by Google') && english.includes('128 reviews') && english.includes('Google Maps') && english.includes('Visited: September 2026'), english)
    await view.setViewport({ width: 390, height: 800 })
    check(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'le bloc déborde sur téléphone')
    await view.close()
  })

  await step('données structurées : les horaires de la fiche complètent l\'organisme de la page d\'accueil, jamais la note', async () => {
    await claire.json('/api/cms/entries/settings/settings', { method: 'PUT', body: { values: { phone: '04 72 00 00 00', email: 'contact@cabinet-durand.fr', address: '12 rue des Lilas', footerText: 'Cabinet Durand' } } })
    await claire.json('/api/cms/entries/home/home', { method: 'PUT', body: { values: { heroTitle: 'Bienvenue' }, publish: ['fr'] } })
    const home = await visitor.json('/api/content/home/home')
    const organization = home.structuredData.find(b => b['@type'] === 'LegalService')
    check(organization && JSON.stringify(organization.openingHoursSpecification) === JSON.stringify([{ '@type': 'OpeningHoursSpecification', 'dayOfWeek': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], 'opens': '09:00', 'closes': '18:00' }]), JSON.stringify(organization))
    check(!JSON.stringify(home.structuredData).includes('aggregateRating'), 'note Google publiée dans les données structurées')
    // Module désactivé : les horaires disparaissent, la page reste servie.
    await claire.call('/api/cms/modules/google-business/enabled', { method: 'PUT', body: { enabled: false } })
    const without = (await visitor.json('/api/content/home/home')).structuredData.find(b => b['@type'] === 'LegalService')
    check(without && !without.openingHoursSpecification, JSON.stringify(without))
    await claire.call('/api/cms/modules/google-business/enabled', { method: 'PUT', body: { enabled: true } })
  })

  await step('écran « Avis Google » : note, avis, horaires, lien « Laisser un avis » ; lisible par une rédactrice, réglages réservés', async () => {
    await page.goto(B + '/admin/google-business', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-gb-state="ok"]')
    check((await menuLabels(page)).includes('Avis Google'), 'entrée du menu absente')
    check(await page.$eval('[data-gb-rating]', el => el.textContent) === '4,7' && await page.$eval('[data-gb-count]', el => el.textContent) === '128', 'note ou nombre d\'avis')
    check((await page.$$('[data-gb-review]')).length === 3 && (await page.$eval('[data-gb-hours]', el => el.innerText)).includes('lundi: 09:00 – 18:00'), 'avis ou horaires')
    await says(page, 'Copier le lien « Laisser un avis »')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: 'Lina Roux', email: 'lina@example.com', role: 'writer' } })
    await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
    check((await lina.signIn('lina@example.com', 'motdepasse-test-2')).status === 200, 'connexion refusée')
    check((await admin(lina)).status === 200 && (await lina.call('/api/cms/modules/google-business', { method: 'PUT', body: { values: { placeId: PLACE } } })).status === 403, 'droits de la rédactrice')
    check((await admin(visitor)).status === 401, 'fiche du back-office lisible sans connexion')
    await page.setViewport({ width: 390, height: 800 })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'l\'écran déborde sur téléphone')
    await page.setViewport({ width: 1280, height: 900 })
  })
}
