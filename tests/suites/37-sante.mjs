// Santé du site : liens cassés, images sans texte alternatif ou lourdes, fichiers inutilisés.
import fs from 'node:fs'
import { check, login, menuLabels } from '../lib/harness.mjs'

export const meta = { title: 'santé du site : liens, images, fichiers inutilisés', mock: true }

export default async function (t) {
  const { B, M, step } = t
  const admin = t.http(), anon = t.http()
  const create = async (type, body) => (await admin.json(`/api/cms/entries/${type}`, { method: 'POST', body })).id
  const upload = async (name, bytes) => {
    const form = new FormData()
    form.append('file', new Blob([bytes ?? fs.readFileSync(t.fixture('Photo du Cabinet.png'))], { type: 'image/png' }), name)
    const r = await fetch(B + '/api/cms/media', { method: 'POST', body: form, headers: { cookie: admin.cookie(), origin: B } })
    check(r.status === 200, `envoi de ${name} : ${r.status}`)
    return r.json()
  }
  const report = () => admin.json('/api/cms/health')
  const files = {}, ids = {}

  await step('préparation : fichiers (sans description, décrit, lourd, inutilisé) et contenus avec leurs liens', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    files.plain = await upload('sans-description.png')
    files.described = await upload('decrite.png')
    await admin.json(`/api/cms/media/${files.described.id}`, { method: 'PATCH', body: { alt: { fr: 'La façade du cabinet' } } })
    files.heavy = await upload('lourde.png', new Uint8Array(1_700_000))
    await admin.json(`/api/cms/media/${files.heavy.id}`, { method: 'PATCH', body: { alt: { fr: 'Vue d\'ensemble' } } })
    files.orphan = await upload('orpheline.png')

    ids.social = await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit social' } } }, publish: ['fr'] })
    ids.gone = await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit rural' } } } })
    const body = [
      '<p><a href="/services/droit-social">page en ligne</a>',
      '<a href="/Services/Droit-Social/?x=1#haut">la même, écrite autrement</a>',
      '<a href="/contact">page du site hors du back-office</a>',
      '<a href="/page-fantome">page disparue</a>',
      `<a href="${files.described.url}">fichier de la médiathèque</a>`,
      `<a href="${M}/ok">autre site</a>`,
      `<a href="${M}/introuvable">page externe disparue</a>`,
      `<a href="${M}/echec">site en panne</a>`,
      `<a href="${M}/refuse">site qui refuse les robots</a>`,
      '<a href="mailto:contact@cabinet-durand.fr">e-mail</a> <a href="#haut">ancre</a></p>',
    ].join(' ')
    ids.affaires = await create('services', { shared: { onQuote: true, cover: files.plain.id }, locales: { fr: { values: { title: 'Droit des affaires', body } } }, publish: ['fr'] })
    // Jamais publié : ses liens ne concernent pas les visiteurs.
    await create('services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Brouillon', body: '<p><a href="/autre-fantome">lien</a></p>' } } } })
    // L'accueil : un bouton vers un contenu qui n'est pas en ligne, une image lourde, une image décrite.
    await admin.json('/api/cms/entries/home/home', { method: 'PUT', body: {
      shared: { heroImage: files.heavy.id, showGallery: true, gallery: [{ media: files.described.id }, { media: files.plain.id }] },
      locales: { fr: { values: { heroTitle: 'Un conseil clair', cta: { kind: 'page', type: 'services', id: ids.gone } } } },
      publish: ['fr'],
    } })
  })

  await step('rapport : ce qui est certain (page hors ligne), et ce qui reste à vérifier', async () => {
    const r = await report()
    check(r.examined === 3, 'contenus examinés : ' + r.examined)
    check(r.links.total === 12, 'liens examinés : ' + r.links.total)
    const [missing] = r.links.missingPages
    check(r.links.missingPages.length === 1 && missing.name === 'Accueil' && missing.field === 'Bouton principal' && missing.to === '/admin/home' && missing.target.includes('« Droit rural »') && missing.target.includes('pas en ligne'), JSON.stringify(r.links.missingPages))
    // Une adresse mal écrite ne passe ni l'éditeur de texte ni le champ lien : rien de tel dans des contenus saisis ici.
    check(r.links.invalid.length === 0, JSON.stringify(r.links.invalid))
    // Pages connues du back-office et fichiers de la médiathèque : rien à vérifier. Le reste est rendu au navigateur.
    check(JSON.stringify(r.links.internal.map(l => l.path)) === JSON.stringify(['/contact', '/page-fantome']), JSON.stringify(r.links.internal))
    check(JSON.stringify(r.links.external.map(l => l.url)) === JSON.stringify(['ok', 'introuvable', 'echec', 'refuse'].map(p => `${M}/${p}`)), JSON.stringify(r.links.external))
    check(r.links.external[0].uses[0].to === `/admin/services/${ids.affaires}`, JSON.stringify(r.links.external[0].uses))
  })

  await step('rapport : images sans texte alternatif, image lourde, fichier inutilisé, résumé du référencement', async () => {
    const r = await report()
    check(r.images.withoutAlt.length === 1 && r.images.withoutAlt[0].name === 'sans-description.png' && r.images.withoutAlt[0].uses === 2 && r.images.withoutAlt[0].to === `/admin/media?file=${files.plain.id}`, JSON.stringify(r.images.withoutAlt))
    check(r.images.heavy.length === 1 && r.images.heavy[0].name === 'lourde.png' && r.images.heavy[0].size === 1_700_000, JSON.stringify(r.images.heavy))
    check(r.unused.count === 1 && r.unused.files[0].name === 'orpheline.png', JSON.stringify(r.unused))
    check(r.seo && r.seo.pages === 5 && r.seo.improve >= 1 && r.seo.missingDescription >= 1, JSON.stringify(r.seo))
  })

  await step('vérification des autres sites par le serveur : verdicts, limites, connexion exigée', async () => {
    const check4 = await admin.json('/api/cms/health/links', { method: 'POST', body: { urls: ['ok', 'introuvable', 'echec', 'refuse'].map(p => `${M}/${p}`) } })
    check(JSON.stringify(check4.results.map(r => r.verdict)) === JSON.stringify(['ok', 'broken', 'down', 'unknown']), JSON.stringify(check4.results))
    check(check4.results[1].status === 404 && check4.results[1].detail === 'Réponse 404.', JSON.stringify(check4.results[1]))
    const odd = await admin.json('/api/cms/health/links', { method: 'POST', body: { urls: ['http://domaine-qui-n-existe-pas.invalid/', 'ftp://exemple.fr/a', 'pas une adresse'] } })
    check(JSON.stringify(odd.results.map(r => r.verdict)) === JSON.stringify(['down', 'unknown', 'broken']), JSON.stringify(odd.results))
    check((await admin.post('/api/cms/health/links', { urls: [] })).status === 400, 'liste vide acceptée')
    check((await admin.post('/api/cms/health/links', { urls: Array.from({ length: 9 }, (_, i) => `${M}/ok?${i}`) })).status === 400, 'trop d\'adresses acceptées')
    check((await anon.post('/api/cms/health/links', { urls: [`${M}/ok`] })).status === 401 && (await anon.get('/api/cms/health')).status === 401, 'accessible sans connexion')
  })

  await step('écran : liens vérifiés un à un, problèmes listés avec leur contenu, rien d\'ajouté aux pages introuvables', async () => {
    const page = await t.newPage()
    await login(page, B)
    check((await menuLabels(page)).includes('Santé du site'), 'entrée du menu absente')
    await page.goto(B + '/admin/health', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-health][data-health-state="done"]')
    const issues = await page.$$eval('[data-health-section="links"] [data-health-issue]', items => items.map(li => ({ kind: li.dataset.healthIssue, verdict: li.dataset.healthVerdict ?? null, text: li.innerText.replace(/\s+/g, ' ') })))
    const kinds = issues.map(i => `${i.kind}${i.verdict ? ':' + i.verdict : ''}`)
    check(JSON.stringify(kinds) === JSON.stringify(['missing-page', 'dead:broken', 'dead:broken', 'dead:down']), JSON.stringify(kinds))
    check(issues[0].text.includes('Page hors ligne') && issues[0].text.includes('Droit rural') && issues[0].text.includes('Bouton principal'), issues[0].text)
    check(issues[1].text.includes('/page-fantome') && issues[1].text.includes('Droit des affaires') && issues[1].text.includes('« Contenu »'), issues[1].text)
    check(issues[2].text.includes('/introuvable') && issues[3].text.includes('/echec') && issues[3].text.includes('Ne répond pas'), JSON.stringify(issues.slice(2)))
    // « /contact » existe sur le site sans être un contenu du back-office : vérifiée par le navigateur, elle répond.
    check(!issues.some(i => i.text.includes('/contact')), 'page existante signalée')
    check((await page.$eval('[data-health-count="links"]', el => el.innerText)) === '4 liens à corriger', 'compteur des liens')
    check((await page.$eval('[data-health-unknown]', el => el.innerText)).includes('1 lien n\'a pas pu être vérifié'), 'lien non vérifiable non signalé')
    check((await page.$$eval('[data-health-issue="alt"]', l => l.map(e => e.innerText.replace(/\s+/g, ' ')))).join() === 'sans-description.png 2 utilisations', 'images sans texte alternatif')
    check((await page.$eval('[data-health-issue="heavy"]', el => el.innerText)).includes('1,6 Mo'), 'image lourde')
    check((await page.$eval('[data-health-count="unused"]', el => el.innerText)).startsWith('1 fichier'), 'fichier inutilisé')
    check(!(await page.$('[data-health-ok]')), '« rien à signaler » affiché')
    // La vérification n'est pas une visite : « /page-fantome » ne s'ajoute pas aux pages introuvables.
    const lost = await admin.json('/api/cms/redirects/not-found')
    check(!lost.items.some(i => i.path === '/page-fantome'), 'la vérification a été comptée comme une visite')
    await t.shot(page, 'sante')
    await page.close()
  })

  await step('corrections : une fois publiées, les problèmes disparaissent ; site fermé, pages du site non vérifiées', async () => {
    await admin.json(`/api/cms/entries/services/${ids.affaires}`, { method: 'PUT', body: { shared: { onQuote: true, cover: files.described.id }, locales: { fr: { values: { title: 'Droit des affaires', body: '<p><a href="/page-fantome">lien</a></p>' } } }, publish: ['fr'] } })
    await admin.json(`/api/cms/entries/services/${ids.gone}`, { method: 'PUT', body: { locales: { fr: { values: { title: 'Droit rural' } } }, publish: ['fr'] } })
    await admin.json(`/api/cms/media/${files.plain.id}`, { method: 'PATCH', body: { alt: { fr: 'Salle de réunion' } } })
    const r = await report()
    check(!r.links.missingPages.length && !r.links.invalid.length && !r.links.external.length && !r.images.withoutAlt.length, JSON.stringify(r.links))
    check(r.links.internal.length === 1 && r.links.internal[0].path === '/page-fantome', JSON.stringify(r.links.internal))
    await admin.json('/api/cms/availability', { method: 'PUT', body: { mode: 'maintenance' } })
    // Même navigateur, donc déjà connecté.
    const page = await t.newPage()
    await page.goto(B + '/admin/health', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-health][data-health-state="done"]')
    check((await page.$eval('[data-health-closed]', el => el.innerText)).includes('1 lien vers une page du site n\'a pas été vérifié'), 'avertissement « site fermé » absent')
    check(!(await page.$('[data-health-issue="dead"]')), 'page d\'attente prise pour un lien mort')
    await admin.json('/api/cms/availability', { method: 'PUT', body: { mode: 'online' } })
  })
}
