// Écriture des contenus par l'API (packages/cms/server/utils/entries.ts, shared/flat.ts) : forme à plat, refus de ce qui
// est inconnu ou mal rangé, simulation, identifiant choisi ; et forme unique des champs vides dans l'API publique
// (shared/content.ts). Sans navigateur, sauf la dernière étape qui vérifie que le formulaire n'est pas gêné par ces refus.
import { check, clickText, field, login, says } from '../lib/harness.mjs'

export const meta = { title: 'API : écriture à plat, refus des valeurs mal rangées, champs vides' }

const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
const ID = '0b6c4f4e-58a5-5a4e-9d6b-3c1f3f0d9a11'

export default async function (t) {
  const { step } = t
  const admin = t.http(), lina = t.http(), anon = t.http()
  const ids = {}
  const S = '/api/cms/entries/services'
  /** Envoi qui doit être refusé : vérifie le statut et que le message contient tous les textes attendus. */
  const refused = async (client, method, url, body, status, ...texts) => {
    const r = await client.call(url, { method, body })
    check(r.status === status, `${method} ${url} : statut ${r.status} au lieu de ${status} — ${r.text.slice(0, 300)}`)
    const said = JSON.stringify(r.json?.data?.errors ?? {}) + ' ' + (r.json?.message ?? '')
    for (const text of texts) check(said.includes(text), `message attendu « ${text} », reçu : ${said.slice(0, 400)}`)
    return r.json
  }
  const doc = id => admin.json(`${S}/${id}`)
  const site = async (query = '') => (await anon.json('/api/content/services' + query))

  await step('préparation : connexion, une rédactrice invitée', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const { link } = await admin.json('/api/cms/users', { method: 'POST', body: { name: LINA.name, email: LINA.email, role: LINA.role } })
    check((await anon.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: LINA.password })).status === 200, 'mot de passe refusé')
    check((await lina.signIn(LINA.email, LINA.password)).status === 200, 'connexion de la rédactrice refusée')
  })

  await step('à plat : création, le serveur range lui-même champs communs et champs traduits, deux langues d\'un coup', async () => {
    ids.cat = (await admin.json('/api/cms/entries/categories', { method: 'POST', body: { values: { name: 'Entreprises' } } })).id
    const created = await admin.json(S, {
      method: 'POST',
      body: {
        values: { title: 'Droit social', excerpt: 'Contrats de travail.', category: ids.cat, audience: 'companies', onQuote: false, fromPrice: 150, seo: { description: 'Avocats en droit social.', noindex: true } },
        translations: { en: { values: { title: 'Employment law' }, slug: 'employment-law' } },
        publish: ['fr', 'en'],
      },
    })
    ids.social = created.id
    check(JSON.stringify(created.shared) === JSON.stringify({ category: ids.cat, audience: 'companies', onQuote: false, fromPrice: 150, seo: { noindex: true } }), 'champs communs : ' + JSON.stringify(created.shared))
    check(JSON.stringify(created.locales.fr.values) === JSON.stringify({ title: 'Droit social', excerpt: 'Contrats de travail.', seo: { description: 'Avocats en droit social.' } }), 'fr : ' + JSON.stringify(created.locales.fr.values))
    check(created.locales.en.values.title === 'Employment law' && created.locales.en.slug === 'employment-law', 'en : ' + JSON.stringify(created.locales.en))
    check(created.locales.fr.status === 'published' && created.locales.en.status === 'published', 'statuts : ' + JSON.stringify([created.locales.fr.status, created.locales.en.status]))
    const [fr] = await site(), [en] = await site('?locale=en')
    check(fr.title === 'Droit social' && fr.fromPrice === 150 && fr.category.title === 'Entreprises' && fr.seo.noindex === true, 'site fr : ' + JSON.stringify(fr))
    check(en.title === 'Employment law' && en.slug === 'employment-law' && en.fromPrice === 150, 'site en : ' + JSON.stringify(en))
  })

  await step('à plat : seuls les champs cités changent, null vide un champ, une autre langue par `locale`', async () => {
    const saved = await admin.json(`${S}/${ids.social}`, { method: 'PUT', body: { values: { fromPrice: 180, excerpt: null, seo: { title: 'Droit social à Lyon' } } } })
    check(saved.shared.fromPrice === 180 && saved.shared.category === ids.cat && saved.shared.seo.noindex === true, 'communs : ' + JSON.stringify(saved.shared))
    const fr = saved.locales.fr.values
    check(fr.title === 'Droit social' && fr.excerpt === null && fr.seo.title === 'Droit social à Lyon' && fr.seo.description === 'Avocats en droit social.', 'fr : ' + JSON.stringify(fr))
    check(saved.locales.fr.status === 'changed' && saved.locales.en.status === 'changed', 'brouillon attendu : ' + saved.locales.fr.status)
    check((await site())[0].fromPrice === 150, 'le site ne doit pas changer avant la publication')
    // Publier sans rien renvoyer : la langue est reprise telle qu'elle est en base.
    const published = await admin.json(`${S}/${ids.social}`, { method: 'PUT', body: { values: {}, publish: ['fr', 'en'] } })
    check(published.locales.fr.status === 'published' && published.locales.en.status === 'published', 'publication : ' + published.locales.fr.status)
    check((await site())[0].fromPrice === 180 && (await site())[0].excerpt === null, 'site : ' + JSON.stringify((await site())[0]))
    const en = await admin.json(`${S}/${ids.social}`, { method: 'PUT', body: { locale: 'en', values: { excerpt: 'Employment contracts.' } } })
    check(en.locales.en.values.excerpt === 'Employment contracts.' && en.locales.en.values.title === 'Employment law' && en.locales.fr.values.title === 'Droit social', 'en : ' + JSON.stringify(en.locales.en.values))
  })

  await step('à plat : un nom inconnu, un champ commun dans une traduction ou un mélange des deux écritures sont refusés', async () => {
    const before = (await doc(ids.social)).version
    await refused(admin, 'PUT', `${S}/${ids.social}`, { values: { titel: 'Faute de frappe', title: 'Bon' } }, 422, '« titel » n\'est pas un champ de « Services »')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { values: { faq: [] } }, 422, '« faq » n\'est pas un champ')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { translations: { en: { values: { fromPrice: 10 } } } }, 422, '« fromPrice » est commun à toutes les langues')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { translations: { de: { values: { title: 'Arbeitsrecht' } } } }, 422, 'Langue inconnue « de »')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { locale: 'de', values: { title: 'Arbeitsrecht' } }, 400, 'langue inconnue « de »')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { values: { title: 'A' }, shared: { onQuote: true } }, 400, 'ne se combinent pas')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { title: 'Oubli de values' }, 400, 'Clé inconnue dans la demande : « title »')
    await refused(admin, 'PUT', '/api/cms/entries/home/home', { values: { faq: [{ question: 'Q', reponse: 'R' }] } }, 422, 'faq.0.reponse')
    check((await doc(ids.social)).version === before, 'un envoi refusé ne doit rien enregistrer')
  })

  await step('par parties : une valeur dans la mauvaise partie n\'est plus ignorée en silence', async () => {
    const before = (await doc(ids.social)).version
    // Le cas de l'essai : des champs traduits envoyés dans `shared`.
    await refused(admin, 'PUT', `${S}/${ids.social}`, { shared: { title: 'Mal rangé', onQuote: true } }, 422, '« title » est un champ traduit', 'pas dans shared')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { locales: { fr: { values: { title: 'Droit social', fromPrice: 10 } } } }, 422, '« fromPrice » est commun à toutes les langues', 'pas dans locales.fr.values')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { shared: { inconnu: 1 } }, 422, '« inconnu » n\'est pas un champ de « Services »')
    await refused(admin, 'PUT', `${S}/${ids.social}`, { locales: { de: { values: { title: 'x' } } } }, 422, 'Langue inconnue « de »')
    await refused(admin, 'POST', S, { shared: { title: 'Nouveau' } }, 422, '« title » est un champ traduit')
    check((await doc(ids.social)).version === before, 'un envoi refusé ne doit rien enregistrer')
    check((await admin.json(S)).length === 1, 'aucun contenu ne doit avoir été créé')
  })

  await step('par parties : ce que le formulaire envoie reste accepté (seo, valeurs mises de côté, envoi partiel, verrou)', async () => {
    const current = await doc(ids.social)
    const saved = await admin.json(`${S}/${ids.social}`, {
      method: 'PUT',
      body: {
        shared: { ...current.shared, seo: { noindex: false }, _kept: { ancien: 1 } },
        locales: { fr: { slug: current.locales.fr.slug, values: { ...current.locales.fr.values, seo: { title: 'T' }, _kept: {} } } },
        baseVersion: current.version,
      },
    })
    check(saved.shared.seo.noindex === false && saved.locales.fr.values.seo.title === 'T', 'seo : ' + JSON.stringify(saved.shared.seo))
    check(saved.locales.en.values.title === 'Employment law', 'une langue non envoyée ne doit pas être touchée')
    // Verrou par partie : la version lue avant cet enregistrement est périmée pour le français, pas pour l'anglais.
    await refused(admin, 'PUT', `${S}/${ids.social}`, { locales: { fr: { values: { title: 'Trop tard' } } }, baseVersion: current.version }, 409)
    const en = await admin.json(`${S}/${ids.social}`, { method: 'PUT', body: { locales: { en: { values: { title: 'Labour law' } } }, baseVersion: current.version } })
    check(en.locales.en.values.title === 'Labour law', 'la langue non modifiée entre-temps devait passer')
    // Le même verrou vaut pour l'écriture à plat.
    await refused(admin, 'PUT', `${S}/${ids.social}`, { values: { title: 'Trop tard' }, baseVersion: current.version }, 409)
  })

  await step('page unique : le premier enregistrement la crée, à plat, champs communs compris', async () => {
    // Le cas de l'essai : des coordonnées, sans savoir lesquelles sont traduites.
    const saved = await admin.json('/api/cms/entries/settings/settings', { method: 'PUT', body: { values: { phone: '04 72 00 00 00', email: 'contact@cabinet-durand.fr', address: '12 rue de la République', footerText: '' } } })
    check(saved.shared.phone === '04 72 00 00 00' && saved.locales.fr.values.address === '12 rue de la République', JSON.stringify(saved))
    const pub = await anon.json('/api/content/settings')
    check(pub.phone === '04 72 00 00 00' && pub.email === 'contact@cabinet-durand.fr' && pub.address === '12 rue de la République' && pub.footerText === null, 'site : ' + JSON.stringify(pub))
    // Sans brouillons, un champ commun modifié seul est bien mis en ligne.
    await admin.json('/api/cms/entries/settings/settings', { method: 'PUT', body: { values: { phone: '04 72 11 11 11' } } })
    check((await anon.json('/api/content/settings')).phone === '04 72 11 11 11', 'le téléphone modifié seul devait arriver sur le site')
    await refused(admin, 'PUT', '/api/cms/entries/categories/inconnu', { values: { name: 'x' } }, 404)
  })

  await step('simulation : tout est vérifié, rien n\'est écrit', async () => {
    const before = await doc(ids.social)
    const same = await admin.json(`${S}/${ids.social}`, { method: 'PUT', body: { values: { title: before.locales.fr.values.title }, dryRun: true } })
    check(same.dryRun === true && same.created === false && same.changed.length === 0, 'sans changement : ' + JSON.stringify(same))
    const change = await admin.json(`${S}/${ids.social}`, { method: 'PUT', body: { values: { title: 'Autre titre', fromPrice: 1 }, publish: ['fr'], dryRun: true } })
    check(JSON.stringify(change.changed) === JSON.stringify(['shared', 'fr']) && JSON.stringify(change.published) === JSON.stringify(['fr']), 'avec changement : ' + JSON.stringify(change))
    const create = await admin.json(S, { method: 'POST', body: { values: { title: 'Jamais créé', onQuote: true }, dryRun: true } })
    check(create.created === true && typeof create.id === 'string', 'création simulée : ' + JSON.stringify(create))
    await refused(admin, 'POST', S, { values: { onQuote: false, title: 'Sans tarif' }, publish: ['fr'], dryRun: true }, 422, 'fromPrice')
    const after = await doc(ids.social)
    check(after.version === before.version && after.locales.fr.values.title === before.locales.fr.values.title, 'la simulation a écrit quelque chose')
    check((await admin.json(S)).length === 1, 'la simulation a créé un contenu')
  })

  await step('identifiant choisi à la création : accepté une fois, au format attendu', async () => {
    const created = await admin.json(S, { method: 'POST', body: { id: ID, values: { title: 'Médiation', onQuote: true } } })
    check(created.id === ID, 'identifiant : ' + created.id)
    await refused(admin, 'POST', S, { id: ID, values: { title: 'Doublon', onQuote: true } }, 409, 'déjà cet identifiant')
    await refused(admin, 'POST', S, { id: 'mediation', values: { title: 'Mauvais format', onQuote: true } }, 400, 'UUID')
    check((await admin.json(S)).length === 2, 'un seul contenu devait être créé')
  })

  await step('champ réservé : la rédactrice ne le modifie pas à plat, et le refus est dit', async () => {
    await refused(lina, 'PUT', `${S}/${ID}`, { values: { title: 'Médiation familiale', audience: 'individuals' } }, 422, '« audience » est un champ réservé')
    const saved = await lina.json(`${S}/${ID}`, { method: 'PUT', body: { values: { title: 'Médiation familiale' } } })
    check(saved.locales.fr.values.title === 'Médiation familiale', 'le titre devait être enregistré')
    await refused(lina, 'PUT', `${S}/${ID}`, { values: { title: 'x' }, publish: ['fr'] }, 403)
    await refused(lina, 'PUT', '/api/cms/entries/settings/settings', { values: { phone: '01' } }, 403)
  })

  await step('champs vides : une seule forme pour le site, quelle que soit la façon de vider', async () => {
    const EMPTY = { excerpt: null, cover: null, category: null, audience: null, companySize: null, body: null }
    const variants = {
      'jamais remplis': {},
      'textes vides': { excerpt: '', body: '<p></p>', cover: '', category: '', audience: '' },
      'null': { excerpt: null, body: null, cover: null, category: null, audience: null, companySize: null },
    }
    for (const [name, values] of Object.entries(variants)) {
      const { id } = await admin.json(S, { method: 'POST', body: { values: { title: `Vide (${name})`, onQuote: true, ...values }, publish: ['fr'] } })
      const item = await anon.json(`/api/content/services/${id}`)
      for (const [key, want] of Object.entries(EMPTY)) check(item[key] === want, `${name} : ${key} vaut ${JSON.stringify(item[key])}, attendu ${JSON.stringify(want)}`)
      // Masqué par sa condition (tarif sur devis) : vide lui aussi. L'interrupteur, lui, n'est jamais vide.
      check(item.fromPrice === null && item.onQuote === true, `${name} : fromPrice ${JSON.stringify(item.fromPrice)}, onQuote ${JSON.stringify(item.onQuote)}`)
      check(Object.keys(EMPTY).every(key => key in item), `${name} : tous les champs doivent être présents`)
    }
    // Page d'accueil : listes vides, lien vide, et les mêmes règles dans un répéteur.
    await admin.json('/api/cms/entries/home/home', { method: 'PUT', body: { values: { heroTitle: 'Bienvenue', heroText: '', faq: [{ question: 'Une question ?', answer: 'Une réponse.' }] }, publish: ['fr'] } })
    const home = await anon.json('/api/content/home')
    check(home.heroText === null && home.heroImage === null && home.cta === null, 'accueil : ' + JSON.stringify([home.heroText, home.heroImage, home.cta]))
    check(Array.isArray(home.featured) && home.featured.length === 0, 'relation multiple vide : ' + JSON.stringify(home.featured))
    check(JSON.stringify(home.faq) === JSON.stringify([{ question: 'Une question ?', answer: 'Une réponse.', hasLink: false, more: null }]), 'répéteur : ' + JSON.stringify(home.faq))
    await admin.json('/api/cms/entries/home/home', { method: 'PUT', body: { values: { faq: [] }, publish: ['fr'] } })
    check(JSON.stringify((await anon.json('/api/content/home')).faq) === '[]', 'répéteur vidé')
    // Choix multiples et date (collection réservée à l'administrateur).
    const d = await admin.json('/api/cms/entries/documents', { method: 'POST', body: { values: { title: 'Sans rien', date: '' }, publish: ['fr'] } })
    const document = await anon.json(`/api/content/documents/${d.id}`)
    check(document.date === null && document.file === null && JSON.stringify(document.topics) === '[]', 'document : ' + JSON.stringify(document))
  })

  await step('formulaire : il enregistre et publie un contenu écrit à plat, sans rien envoyer qui soit refusé', async () => {
    const page = await t.newPage()
    await login(page, t.B)
    await page.goto(`${t.B}/admin/services/${ids.social}`, { waitUntil: 'networkidle0' })
    const title = await field(page, 'Titre')
    await title.evaluate(el => el.select())
    await title.type('Droit social et paie')
    await clickText(page, 'button', 'Enregistrer')
    await says(page, 'Brouillon enregistré')
    await clickText(page, 'button', 'Publier')
    await says(page, 'Publié')
    const saved = await doc(ids.social)
    check(saved.locales.fr.values.title === 'Droit social et paie' && saved.locales.fr.status === 'published', JSON.stringify(saved.locales.fr))
    check(saved.shared.fromPrice === 180 && saved.shared._kept === undefined, 'communs : ' + JSON.stringify(saved.shared))
    check((await site()).some(s => s.title === 'Droit social et paie'), 'le site devait montrer le nouveau titre')
  })
}
