// Droits fins : champs réservés, « seulement ses contenus », demandes de publication, rôles personnalisés.
import { check, login, menuLabels, says, until } from '../lib/harness.mjs'

export const meta = { title: 'champs réservés, contenus personnels, demandes de publication, rôles personnalisés', mock: true }

const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const NOE = { name: 'Noé Blanc', email: 'noe@example.com', password: 'mot-de-passe-de-noe', role: 'writer' }

export default async function (t) {
  const { step, admin, B, M, calls } = t
  const claire = t.http(), marc = t.http(), lina = t.http(), noe = t.http(), visitor = t.http()
  const ids = {}
  const service = (title, shared = {}, extra = {}) => ({ shared: { onQuote: true, ...shared }, locales: { fr: { values: { title } } }, ...extra })
  const testimonial = (author, extra = {}) => ({ shared: { author }, locales: { fr: { values: { quote: 'Avis de ' + author } } }, ...extra })
  const patchUser = (who, body) => claire.call(`/api/cms/users/${who.id}`, { method: 'PATCH', body })

  await step('préparation : un éditeur et deux rédacteurs', async () => {
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    for (const [who, client] of [[MARC, marc], [LINA, lina], [NOE, noe]]) {
      const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: who.name, email: who.email, role: who.role } })
      who.id = id
      check((await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: who.password })).status === 200, 'mot de passe refusé pour ' + who.name)
      check((await client.signIn(who.email, who.password)).status === 200, 'connexion refusée pour ' + who.name)
    }
  })

  // ───── Champs réservés
  await step('champ réservé : la saisie d\'un rédacteur est ignorée, celle d\'un éditeur est gardée', async () => {
    check((await lina.json('/api/cms/me')).restrictedFields === false && (await marc.json('/api/cms/me')).restrictedFields === true, 'droit « champs réservés » mal annoncé')
    const created = await lina.json('/api/cms/entries/services', { method: 'POST', body: service('Service de Lina', { audience: 'companies' }) })
    ids.service = created.id
    check(created.shared.audience === undefined, 'le rédacteur a rempli un champ réservé à la création : ' + created.shared.audience)
    const byMarc = await marc.json(`/api/cms/entries/services/${ids.service}`, { method: 'PUT', body: service('Service de Lina', { audience: 'individuals' }) })
    check(byMarc.shared.audience === 'individuals', 'la saisie de l\'éditeur n\'est pas gardée')
    const byLina = await lina.json(`/api/cms/entries/services/${ids.service}`, { method: 'PUT', body: service('Service de Lina, relu', { audience: 'companies' }) })
    check(byLina.shared.audience === 'individuals' && byLina.locales.fr.values.title === 'Service de Lina, relu', JSON.stringify([byLina.shared.audience, byLina.locales.fr.values.title]))
    const cleared = await lina.json(`/api/cms/entries/services/${ids.service}`, { method: 'PUT', body: service('Service de Lina, relu', { audience: null }) })
    check(cleared.shared.audience === 'individuals', 'le rédacteur a vidé un champ réservé')
  })

  // ───── Seulement ses contenus
  await step('seulement ses contenus : chaque rédacteur ne voit et ne modifie que les siens', async () => {
    ids.a = (await lina.json('/api/cms/entries/testimonials', { method: 'POST', body: testimonial('Client de Lina') })).id
    ids.b = (await noe.json('/api/cms/entries/testimonials', { method: 'POST', body: testimonial('Client de Noé') })).id
    ids.c = (await claire.json('/api/cms/entries/testimonials', { method: 'POST', body: testimonial('Client de Claire') })).id
    const titles = async client => (await client.json('/api/cms/entries/testimonials')).map(i => i.title).sort().join()
    check(await titles(lina) === 'Client de Lina' && await titles(noe) === 'Client de Noé', `${await titles(lina)} / ${await titles(noe)}`)
    check(await titles(marc) === 'Client de Claire,Client de Lina,Client de Noé', 'l\'éditeur devrait tout voir : ' + await titles(marc))
    const codes = [
      (await lina.get(`/api/cms/entries/testimonials/${ids.b}`)).status,
      (await lina.put(`/api/cms/entries/testimonials/${ids.b}`, testimonial('Piraté'))).status,
      (await lina.get(`/api/cms/entries/testimonials/${ids.b}/revisions`)).status,
      (await lina.post(`/api/cms/entries/testimonials/${ids.b}/duplicate`)).status,
      (await lina.get(`/api/cms/entries/testimonials/${ids.c}`)).status,
      (await lina.put('/api/cms/entries/testimonials/order', { ids: [ids.a, ids.b, ids.c] })).status,
    ]
    check(codes.every(c => c === 403), codes.join())
    check((await lina.put(`/api/cms/entries/testimonials/${ids.a}`, testimonial('Client de Lina', { publish: ['fr'] }))).status === 200, 'le rédacteur ne peut plus publier le sien')
    const found = async (client, q) => JSON.stringify(await client.json('/api/cms/search?q=' + q))
    check(!(await found(lina, 'noe')).includes('Client de Noé') && (await found(lina, 'lina')).includes('Client de Lina'), 'la recherche montre le contenu d\'un autre')
    check((await found(marc, 'noe')).includes('Client de Noé'), 'l\'éditeur devrait trouver tous les contenus')
  })

  // ───── Demandes de publication
  await step('demande de publication : visible par qui peut publier, avec son message, et transmise aux workflows', async () => {
    await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Demandes', trigger: { event: 'entry.review_requested', types: ['services'] }, actions: [{ kind: 'webhook', url: M + '/ok' }] } })
    const asked = await lina.post(`/api/cms/entries/services/${ids.service}/review`, { note: 'Prêt à relire.' })
    check(asked.status === 200 && asked.json.review.by === 'Lina Roux', `${asked.status} ${asked.text.slice(0, 150)}`)
    const doc = await marc.json(`/api/cms/entries/services/${ids.service}`)
    check(doc.review?.note === 'Prêt à relire.' && doc.review.by === 'Lina Roux', JSON.stringify(doc.review))
    check((await marc.json('/api/cms/entries/services')).find(i => i.id === ids.service).review === true, 'la liste ne signale pas la demande')
    const seen = async client => (await client.json('/api/cms/reviews')).map(r => `${r.title}|${r.mine}|${r.canHandle}`).join()
    check(await seen(marc) === 'Service de Lina, relu|false|true', 'éditeur : ' + await seen(marc))
    check(await seen(lina) === 'Service de Lina, relu|true|false', 'demandeuse : ' + await seen(lina))
    check(await seen(noe) === '', 'un autre rédacteur voit la demande : ' + await seen(noe))
    const hook = await until(() => calls().find(c => c.url === '/ok'), 'appel du workflow')
    check(hook.body.request.by === 'Lina Roux' && hook.body.request.note === 'Prêt à relire.' && hook.body.entry.title === 'Service de Lina, relu', JSON.stringify(hook.body))
  })

  await step('demande : retirée par son auteur ou par un éditeur, pas par un tiers ; close par la publication', async () => {
    check((await noe.del(`/api/cms/entries/services/${ids.service}/review`)).status === 403, 'un tiers a retiré la demande')
    check((await lina.del(`/api/cms/entries/services/${ids.service}/review`)).status === 200 && (await marc.json('/api/cms/reviews')).length === 0, 'retrait par l\'auteur')
    await lina.json(`/api/cms/entries/services/${ids.service}/review`, { method: 'POST', body: {} })
    const pub = await marc.put(`/api/cms/entries/services/${ids.service}`, service('Service de Lina, relu', {}, { publish: ['fr'] }))
    check(pub.status === 200 && pub.json.review === null && (await marc.json('/api/cms/reviews')).length === 0, `publication : ${pub.status} ${JSON.stringify(pub.json?.review)}`)
    const nothing = await lina.post(`/api/cms/entries/services/${ids.service}/review`, {})
    check(nothing.status === 400 && /déjà en ligne/.test(nothing.json?.message ?? ''), `demande sur un contenu à jour : ${nothing.status}`)
  })

  // ───── Rôles personnalisés
  await step('rôle personnalisé : création contrôlée, droits appliqués dès l\'attribution', async () => {
    const bad = [
      (await claire.post('/api/cms/roles', { name: '', rights: { types: { services: { edit: true } } } })).status,
      (await claire.post('/api/cms/roles', { name: 'éditeur', rights: { types: { services: { edit: true } } } })).status,
      (await claire.post('/api/cms/roles', { name: 'Vide', rights: { types: { services: { publish: true } } } })).status,
      (await marc.post('/api/cms/roles', { name: 'Pirate', rights: { types: { services: { edit: true } } } })).status,
    ]
    check(bad.join() === '400,400,400,403', bad.join())
    const role = await claire.json('/api/cms/roles', { method: 'POST', body: { name: 'Stagiaire', rights: { types: { services: { edit: true }, testimonials: { edit: true, publish: true, own: true }, settings: { edit: true, publish: true }, inconnu: { edit: true } }, deleteMedia: false, restrictedFields: true } } })
    ids.role = role.id
    check(Object.keys(role.rights.types).sort().join() === 'services,settings,testimonials', 'types gardés : ' + Object.keys(role.rights.types).join())
    check((await patchUser(NOE, { role: 'role_inconnu' })).status === 400, 'rôle inconnu accepté')
    check((await patchUser(NOE, { role: ids.role })).status === 200, 'attribution refusée')
    const me = await noe.json('/api/cms/me')
    check(me.roleName === 'Stagiaire' && me.restrictedFields === true && me.deleteMedia === false, JSON.stringify([me.roleName, me.restrictedFields, me.deleteMedia]))
    const a = me.access
    check(a.services.edit && !a.services.publish && a.testimonials.publish && a.testimonials.own && !a.home.edit, JSON.stringify(a))
    // « Réglages du site » est réservé aux administrateurs : aucun rôle personnalisé ne l'ouvre.
    check(!a.settings.edit && (await noe.get('/api/cms/entries/settings/settings')).status === 403, 'un rôle personnalisé a ouvert un contenu réservé')
    const codes = [
      (await noe.get('/api/cms/entries/home/home')).status,
      (await noe.put(`/api/cms/entries/services/${ids.service}`, service('Vu par Noé', { audience: 'companies' }))).status,
      (await noe.put(`/api/cms/entries/services/${ids.service}`, { publish: ['fr'] })).status,
      (await noe.get(`/api/cms/entries/testimonials/${ids.a}`)).status,
      (await noe.del('/api/cms/media/fichier-inexistant')).status,
    ]
    check(codes.join() === '403,200,403,403,403', codes.join())
    check((await marc.json(`/api/cms/entries/services/${ids.service}`)).shared.audience === 'companies', 'le rôle devait pouvoir modifier le champ réservé')
  })

  await step('rôle personnalisé : une modification s\'applique tout de suite ; suppression refusée tant qu\'il est porté', async () => {
    const updated = await claire.call(`/api/cms/roles/${ids.role}`, { method: 'PUT', body: { name: 'Stagiaire', rights: { types: { services: { edit: true, publish: true } } } } })
    check(updated.status === 200 && updated.json.users === 1, `${updated.status} ${updated.text.slice(0, 120)}`)
    check((await noe.put(`/api/cms/entries/services/${ids.service}`, service('Publié par Noé', {}, { publish: ['fr'] }))).status === 200, 'le nouveau droit de publier n\'est pas appliqué')
    check((await noe.get('/api/cms/entries/testimonials')).status === 403, 'l\'ancien accès aux témoignages est resté')
    check((await claire.del(`/api/cms/roles/${ids.role}`)).status === 409, 'rôle porté supprimé')
    check((await patchUser(NOE, { role: 'writer' })).status === 200 && (await claire.del(`/api/cms/roles/${ids.role}`)).status === 200, 'suppression du rôle libéré')
    check((await noe.json('/api/cms/me')).roleName === 'Rédacteur', 'retour au rôle intégré')
  })

  // ───── Interface
  await step('interface : demande depuis le formulaire, champ réservé figé, entrée « À valider » pour l\'éditeur', async () => {
    await lina.json(`/api/cms/entries/services/${ids.service}`, { method: 'PUT', body: service('Service de Lina, encore modifié') })
    const page = await t.newPage({ context: await t.newContext() })
    await login(page, B, LINA)
    await page.goto(`${B}/admin/services/${ids.service}`, { waitUntil: 'networkidle0' })
    await says(page, 'Champ réservé : vous pouvez le lire, pas le modifier.')
    const locked = await page.evaluate(() => [...document.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent.trim() === 'Public')?.inert)
    check(locked === true, 'le champ réservé n\'est pas figé')
    await (await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Demander la publication')))).asElement().evaluate(b => b.click())
    await page.waitForSelector('.modal-open textarea')
    await page.type('.modal-open textarea', 'Texte revu, merci de publier.')
    await page.$eval('.modal-open button.btn-primary', b => b.click())
    await says(page, 'Demande envoyée')
    await says(page, 'Retirer ma demande')

    const editor = await t.newPage({ context: await t.newContext() })
    await login(editor, B, MARC)
    await editor.waitForFunction(() => [...document.querySelectorAll('aside .menu a')].some(a => a.textContent.includes('À valider')))
    check((await menuLabels(editor)).some(l => /^À valider\s*1$/.test(l)), 'menu : ' + (await menuLabels(editor)).join(' | '))
    await editor.goto(`${B}/admin/reviews`, { waitUntil: 'networkidle0' })
    await says(editor, 'Texte revu, merci de publier.')
    await editor.goto(`${B}/admin/services/${ids.service}`, { waitUntil: 'networkidle0' })
    await says(editor, 'Écarter la demande')
  })

  await step('interface : page des rôles, création par la grille', async () => {
    const page = await t.newPage({ context: await t.newContext() })
    await login(page, B)
    await page.goto(`${B}/admin/roles`, { waitUntil: 'networkidle0' })
    await says(page, 'Aucun rôle personnalisé')
    await (await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Créer un rôle')))).asElement().evaluate(b => b.click())
    await page.waitForSelector('.modal-open table')
    const rows = await page.$$eval('.modal-open tbody tr', trs => trs.map(tr => tr.querySelector('td').childNodes[0].textContent.trim()))
    check(rows.includes('Services') && !rows.includes('Réglages du site'), 'grille : ' + rows.join())
    await page.type('.modal-open input.input', 'Responsable des témoignages')
    // Cocher « Publier » coche aussi « Modifier ».
    await page.$eval('.modal-open input[aria-label="Témoignages : publish"]', i => i.click())
    check(await page.$eval('.modal-open input[aria-label="Témoignages : edit"]', i => i.checked), 'publier sans modifier')
    await page.$eval('.modal-open button.btn-primary', b => b.click())
    await says(page, 'Rôle créé')
    const created = (await claire.json('/api/cms/roles'))[0]
    check(created.name === 'Responsable des témoignages' && created.rights.types.testimonials.publish && Object.keys(created.rights.types).length === 1, JSON.stringify(created))
    await page.goto(`${B}/admin/users`, { waitUntil: 'networkidle0' })
    const options = await page.$$eval('tbody tr:nth-child(2) select option', os => os.map(o => o.textContent.trim()))
    check(options.join() === 'Rédacteur,Éditeur,Administrateur,Responsable des témoignages', 'rôles proposés : ' + options.join())
  })
}
