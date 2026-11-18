// Outil d'import de contenus (packages/cms/bin/import.mjs, cli/import.ts) : lancé comme le ferait un projet client,
// depuis le dossier du playground, contre le serveur de test. Sans navigateur.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check } from '../lib/harness.mjs'

export const meta = { title: 'import de contenus : simulation, import, relance sans doublon, mise à jour, erreurs, droits' }

const BIN = path.join(config.rootDir, 'packages', 'cms', 'bin', 'import.mjs')
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }

export default async function (t) {
  const { step } = t
  const admin = t.http(), anon = t.http()
  const dir = path.join(config.tmpDir, 'import')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(t.fixture('Photo du Cabinet.png'), path.join(dir, 'cabinet.png'))

  /** Lance l'outil depuis le dossier du site. Le compte passe par l'environnement, jamais par la ligne de commande. */
  const run = (args, { email = t.admin.email, password = t.admin.password } = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args, '--url', t.B], {
      cwd: config.playgroundDir,
      env: { ...process.env, CMS_EMAIL: email, CMS_PASSWORD: password, CMS_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('error', reject)
    child.on('close', code => resolve({ code, out }))
  })
  const write = (name, data) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
    return file
  }
  /** Vérifie le code de sortie et que la sortie contient chaque texte (une expression régulière est aussi acceptée). */
  const expect = (r, code, ...texts) => {
    check(r.code === code, `code de sortie ${r.code} au lieu de ${code}\n${r.out}`)
    for (const text of texts) check(text instanceof RegExp ? text.test(r.out) : r.out.includes(text), `sortie attendue « ${text} »\n${r.out}`)
  }
  const list = type => admin.json(`/api/cms/entries/${type}`)
  const site = (type, query = '') => anon.json(`/api/content/${type}${query}`)
  const byTitle = async (type, title) => {
    const item = (await list(type)).find(i => i.title === title)
    check(item, `« ${title} » introuvable dans ${type}`)
    return admin.json(`/api/cms/entries/${type}/${item.id}`)
  }

  const content = () => ({
    singletons: {
      settings: { phone: '04 72 00 00 00', email: 'contact@cabinet-durand.fr', address: '12 rue de la République', en: { address: '12 rue de la République, France' } },
    },
    collections: {
      categories: [{ id: 'entreprises', name: 'Entreprises', en: { name: 'Companies' } }],
      services: [
        {
          id: 'commercial',
          title: 'Droit commercial',
          excerpt: 'Création de société, contrats.',
          cover: { file: 'cabinet.png', alt: { fr: 'La façade du cabinet', en: 'The front of the firm' } },
          category: 'entreprises',
          audience: 'companies',
          onQuote: false,
          fromPrice: 180,
          body: '<p>De la <strong>création</strong> à la cession.</p><script>alert(1)</script>',
          seo: { description: 'Avocats en droit commercial.', image: 'cabinet.png' },
          en: { title: 'Commercial law', slug: 'commercial-law', excerpt: 'Company formation, contracts.' },
        },
        { id: 'travail', title: 'Droit du travail', onQuote: true },
      ],
      testimonials: [{ id: 'claire', author: 'Claire Martin', quote: 'Un cabinet réactif.', photo: 'cabinet.png' }],
    },
  })
  const file = write('contenus.json', content())
  const versions = async () => Object.fromEntries(await Promise.all((await list('services')).map(async i => [i.title, (await admin.json(`/api/cms/entries/services/${i.id}`)).version])))

  await step('simulation sur une base vide : tout est annoncé, rien n\'est écrit', async () => {
    check((await admin.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const r = await run([file, '--dry-run'])
    expect(r, 0, 'simulation, rien ne sera écrit', /à envoyer\s+cabinet\.png/, /à créer\s+« commercial »/, /à créer\s+Réglages du site/, '5 à créer, 0 à mettre à jour, 0 inchangé, 0 erreur', 'Fichiers : 1 à envoyer sur 1', 'Rien n\'a été écrit')
    check((await list('services')).length === 0 && (await list('categories')).length === 0, 'la simulation a créé des contenus')
    check((await admin.json('/api/cms/media')).length === 0, 'la simulation a envoyé un fichier')
    check((await site('settings')) === null, 'la simulation a écrit les réglages')
  })

  await step('import : contenus créés et publiés, deux langues, image envoyée une seule fois, relation et référencement', async () => {
    const r = await run([file])
    expect(r, 0, /envoyé\s+.*cabinet\.png/, /créé\s+« commercial »/, /créé\s+« travail »/, /créé\s+« entreprises »/, /créé\s+« claire »/, '5 créés, 0 mis à jour, 0 inchangé, 0 erreur', 'Fichiers : 1 envoyé sur 1')
    const media = await admin.json('/api/cms/media')
    check(media.length === 1 && media[0].width === 320 && media[0].height === 240, 'médiathèque : ' + JSON.stringify(media))
    check(media[0].alt.fr === 'La façade du cabinet' && media[0].alt.en === 'The front of the firm', 'texte alternatif : ' + JSON.stringify(media[0].alt))

    const [affaires, famille] = await site('services')
    check(affaires.title === 'Droit commercial' && famille.title === 'Droit du travail', 'ordre du fichier attendu : ' + [affaires?.title, famille?.title])
    check(affaires.slug === 'droit-commercial' && affaires.fromPrice === 180 && affaires.audience === 'companies', JSON.stringify(affaires))
    check(affaires.cover.id === media[0].id && affaires.cover.alt === 'La façade du cabinet' && affaires.seo.image.id === media[0].id, 'image : ' + JSON.stringify(affaires.cover))
    check(affaires.category.title === 'Entreprises', 'relation : ' + JSON.stringify(affaires.category))
    check(affaires.body === '<p>De la <strong>création</strong> à la cession.</p>', 'le HTML doit être nettoyé par le serveur : ' + affaires.body)
    check(affaires.seo.description === 'Avocats en droit commercial.', 'seo : ' + JSON.stringify(affaires.seo))
    check(famille.cover === null && famille.excerpt === null && famille.fromPrice === null, 'champs vides : ' + JSON.stringify(famille))

    const en = await site('services', '?locale=en')
    check(en.length === 1 && en[0].title === 'Commercial law' && en[0].slug === 'commercial-law' && en[0].category.title === 'Companies' && en[0].cover.alt === 'The front of the firm', 'anglais : ' + JSON.stringify(en))
    const settings = await site('settings')
    check(settings.phone === '04 72 00 00 00' && settings.address === '12 rue de la République', 'réglages : ' + JSON.stringify(settings))
    check((await site('settings', '?locale=en')).address === '12 rue de la République, France', 'réglages en anglais')
    const [claire] = await site('testimonials')
    check(claire.author === 'Claire Martin' && claire.photo.id === media[0].id && claire.visible === true, 'témoignage : ' + JSON.stringify(claire))
  })

  await step('relance : rien n\'est recréé ni réécrit', async () => {
    const before = await versions()
    const r = await run([file])
    expect(r, 0, /déjà présent\s+.*cabinet\.png/, /inchangé\s+« commercial »/, /inchangé\s+Réglages du site/, '0 créé, 0 mis à jour, 5 inchangés, 0 erreur', 'Fichiers : 0 envoyé sur 1')
    check((await list('services')).length === 2 && (await list('categories')).length === 1 && (await list('testimonials')).length === 1, 'doublons après la relance')
    check((await admin.json('/api/cms/media')).length === 1, 'le fichier a été envoyé une deuxième fois')
    check(JSON.stringify(await versions()) === JSON.stringify(before), 'des contenus ont été réécrits : ' + JSON.stringify(await versions()))
    expect(await run([file, '--dry-run']), 0, '0 à créer, 0 à mettre à jour, 5 inchangés, 0 erreur')
  })

  await step('fichier corrigé : l\'élément est mis à jour, le nouveau est créé, le reste ne bouge pas', async () => {
    const data = content()
    data.collections.services[0].title = 'Droit des sociétés'
    data.collections.services[0].fromPrice = 200
    data.collections.services[0].cover.alt.fr = 'Le cabinet, vu de la rue'
    data.collections.services.push({ id: 'social', title: 'Droit social', onQuote: true, category: 'entreprises' })
    const corrected = write('contenus.json', data)
    expect(await run([corrected, '--dry-run']), 0, /texte à corriger\s+.*cabinet\.png/, /à mettre à jour\s+« commercial »/, /à créer\s+« social »/, /inchangé\s+« travail »/, '1 à créer, 1 à mettre à jour, 4 inchangés')
    check((await site('services'))[0].title === 'Droit commercial', 'la simulation a modifié le site')
    expect(await run([corrected]), 0, /texte corrigé\s+.*cabinet\.png/, /mis à jour\s+« commercial »/, /créé\s+« social »/, /inchangé\s+« travail »/, '1 créé, 1 mis à jour, 4 inchangés, 0 erreur')
    const services = await site('services')
    check(services.length === 3 && services[0].title === 'Droit des sociétés' && services[0].fromPrice === 200, JSON.stringify(services.map(s => [s.title, s.fromPrice])))
    // L'adresse d'une page publiée ne change pas quand son titre change.
    check(services[0].slug === 'droit-commercial' && services[0].cover.alt === 'Le cabinet, vu de la rue', JSON.stringify([services[0].slug, services[0].cover.alt]))
    check((await site('services', '?locale=en'))[0].title === 'Commercial law', 'la traduction ne devait pas bouger')
    expect(await run([corrected]), 0, '0 créé, 0 mis à jour, 6 inchangés, 0 erreur')
  })

  await step('un champ absent du fichier garde ce qui a été saisi dans le back-office ; un champ du fichier est remis', async () => {
    const doc = await byTitle('services', 'Droit du travail')
    await admin.json(`/api/cms/entries/services/${doc.id}`, { method: 'PUT', body: { values: { title: 'Titre changé à la main', excerpt: 'Résumé saisi à la main.' }, publish: ['fr'] } })
    expect(await run([file]), 0, /mis à jour\s+« travail »/, '0 créé, 1 mis à jour, 5 inchangés')
    const famille = (await site('services')).find(s => s.id === doc.id)
    check(famille.title === 'Droit du travail' && famille.excerpt === 'Résumé saisi à la main.', JSON.stringify([famille.title, famille.excerpt]))
  })

  await step('brouillon : par option ou élément par élément ; module JS avec une fonction', async () => {
    const draft = write('brouillons.mjs', `
      const titres = ['Conciliation', 'Arbitrage']
      export default async () => ({
        collections: {
          services: [
            ...titres.map(title => ({ id: title.toLowerCase(), title, onQuote: true })),
            { id: 'successions', title: 'Successions', onQuote: true, status: 'published' },
          ],
        },
      })
    `)
    expect(await run([draft, '--draft']), 0, /créé\s+« conciliation »/, /créé\s+« arbitrage »/, /créé\s+« successions »/, '3 créés')
    const titles = (await site('services')).map(s => s.title)
    check(titles.includes('Successions') && !titles.includes('Conciliation') && !titles.includes('Arbitrage'), 'publiés : ' + titles.join(', '))
    check((await byTitle('services', 'Conciliation')).locales.fr.status === 'draft', 'Conciliation devait rester en brouillon')
    expect(await run([draft, '--draft']), 0, '0 créé, 0 mis à jour, 3 inchangés')
    // Sans l'option, les brouillons sont publiés.
    expect(await run([draft]), 0, /mis à jour\s+« conciliation »/, '0 créé, 2 mis à jour, 1 inchangé')
    check((await site('services')).some(s => s.title === 'Conciliation'), 'Conciliation devait être publiée')
  })

  await step('fichier fautif : tout est signalé avec son emplacement, rien n\'est envoyé', async () => {
    const before = { services: (await list('services')).length, categories: (await list('categories')).length, media: (await admin.json('/api/cms/media')).length }
    const bad = write('fautif.json', {
      collections: {
        articles: [{ id: 'a', title: 'Collection inconnue' }],
        categories: [{ id: 'ok', name: 'Catégorie correcte' }, { name: 'Sans id' }],
        services: [
          { id: 's1', titel: 'Faute de frappe', onQuote: true },
          { id: 's2', title: 'Mauvais types', fromPrice: '150', onQuote: 'oui', audience: 'tous', category: 'inexistante', cover: 'absente.png' },
          { id: 's3', title: 'Type de fichier', onQuote: true, cover: '../fichiers/notes.txt' },
          { id: 's4', title: 'Traduction', onQuote: true, en: { title: 'Translation', fromPrice: 10 } },
        ],
      },
    })
    const r = await run([bad])
    expect(r, 1, 'rien n\'a été envoyé',
      'collections.articles : collection inconnue. Collections de cms.config.ts : services, categories, testimonials, documents',
      'collections.categories[1] : id manquant',
      'collections.services[0] (« s1 »).titel : champ inconnu dans « services »',
      'collections.services[1] (« s2 »).fromPrice : nombre attendu (reçu un texte)',
      'collections.services[1] (« s2 »).onQuote : true ou false attendu',
      'collections.services[1] (« s2 »).audience : choix inconnu "tous". Choix possibles : companies, individuals',
      'collections.services[1] (« s2 »).category : aucun élément « inexistante » dans collections.categories',
      /collections\.services\[1\] \(« s2 »\)\.cover : fichier introuvable \(.*absente\.png\)/,
      'collections.services[2] (« s3 »).cover : type de fichier non accepté',
      'collections.services[3] (« s4 »).en.fromPrice : ce champ est commun à toutes les langues')
    check(!r.out.includes('Catégorie correcte') && !/créé/.test(r.out), 'rien ne devait être importé\n' + r.out)
    const after = { services: (await list('services')).length, categories: (await list('categories')).length, media: (await admin.json('/api/cms/media')).length }
    check(JSON.stringify(after) === JSON.stringify(before), 'des contenus ont été écrits : ' + JSON.stringify(after))
    expect(await run([path.join(dir, 'absent.json')]), 1, 'Fichier d\'import introuvable')
    expect(await run([write('casse.json', '{ "collections": ')]), 1, 'Le fichier d\'import n\'a pas pu être lu')
  })

  await step('erreur sur un élément (refus du serveur) : il est nommé avec son champ, les autres sont importés', async () => {
    const mixed = write('mixte.json', {
      collections: {
        services: [
          { id: 'fiscal', title: 'Droit fiscal', onQuote: true },
          // Tarif obligatoire quand le service n'est pas sur devis : la règle est celle du back-office, à la publication.
          { id: 'sans-tarif', title: 'Sans tarif', onQuote: false },
          { id: 'penal', title: 'Droit pénal', onQuote: true, slug: 'droit-commercial' },
          { id: 'rural', title: 'Droit rural', onQuote: true },
        ],
      },
    })
    const r = await run([mixed])
    expect(r, 1, /créé\s+« fiscal »/, /créé\s+« rural »/, /ERREUR\s+« sans-tarif » › fromPrice \(fr\) : Ce champ est obligatoire\./, /ERREUR\s+« penal » › slug \(fr\) : Cette adresse est déjà utilisée/, '2 créés, 0 mis à jour, 0 inchangé, 2 erreurs', 'terminé avec des erreurs')
    const titles = (await list('services')).map(s => s.title)
    check(titles.includes('Droit fiscal') && titles.includes('Droit rural') && !titles.includes('Sans tarif') && !titles.includes('Droit pénal'), titles.join(', '))
    // Le fichier corrigé, relancé : seuls les deux éléments en erreur sont créés.
    const fixed = JSON.parse(fs.readFileSync(mixed, 'utf8'))
    fixed.collections.services[1].fromPrice = 90
    delete fixed.collections.services[2].slug
    expect(await run([write('mixte.json', fixed)]), 0, /créé\s+« sans-tarif »/, /créé\s+« penal »/, /inchangé\s+« fiscal »/, '2 créés, 0 mis à jour, 2 inchangés, 0 erreur')
  })

  await step('compte : mot de passe faux ou absent refusé clairement ; les droits du compte sont respectés', async () => {
    expect(await run([file], { password: 'mauvais-mot-de-passe' }), 1, 'Connexion refusée', 'e-mail ou mot de passe incorrect')
    expect(await run([file], { password: '' }), 1, 'CMS_PASSWORD manquant')
    // Une rédactrice prépare des services en brouillon, mais ne publie pas et n'a pas accès aux réglages.
    const { link } = await admin.json('/api/cms/users', { method: 'POST', body: { name: LINA.name, email: LINA.email, role: LINA.role } })
    check((await anon.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: LINA.password })).status === 200, 'mot de passe refusé')
    const hers = write('redactrice.json', { singletons: { settings: { phone: '01 00 00 00 00' } }, collections: { services: [{ id: 'bail', title: 'Baux commerciaux', onQuote: true }] } })
    const refusedRun = await run([hers], LINA)
    expect(refusedRun, 1, /ERREUR\s+Réglages du site › Vous n'avez pas accès à « Réglages du site »/, /ERREUR\s+« bail » › Vous pouvez préparer « Services » en brouillon, mais pas le publier/, '2 erreurs')
    check((await site('settings')).phone === '04 72 00 00 00' && !(await list('services')).some(s => s.title === 'Baux commerciaux'), 'un contenu refusé a été écrit')
    expect(await run([write('redactrice.json', { collections: { services: [{ id: 'bail', title: 'Baux commerciaux', onQuote: true }] } }), '--draft'], LINA), 0, /créé\s+« bail »/, '1 créé')
    check((await byTitle('services', 'Baux commerciaux')).locales.fr.status === 'draft', 'le service devait être en brouillon')
  })

  await step('l\'exemple du playground (tous les types de champs, deux langues) s\'importe sans erreur et se relance sans changement', async () => {
    const example = path.join(config.playgroundDir, 'import', 'contenus.json')
    const first = await run([example])
    expect(first, 0, /créé\s+Accueil/, /créé\s+« honoraires-2026 »/, '0 erreur', 'Fichiers : 4 envoyés sur 4')
    expect(await run([example]), 0, '0 créé, 0 mis à jour, 11 inchangés, 0 erreur', 'Fichiers : 0 envoyé sur 4')
    const home = await site('home')
    check(home.heroImage.alt === 'La façade du cabinet' && home.cta.href === '/services/droit-des-affaires', 'accueil : ' + JSON.stringify(home.cta))
    check(home.featured.length === 2 && home.faq.length === 2 && home.faq[1].more.href === 'https://www.service-public.fr/', 'accueil : ' + JSON.stringify(home.faq))
    const homeEn = await site('home', '?locale=en')
    check(homeEn.heroTitle === 'Lawyers by your side' && homeEn.faq.length === 1 && homeEn.heroImage.alt === 'The front of the firm', 'accueil en anglais : ' + JSON.stringify(homeEn.heroTitle))
    const documents = await site('documents')
    check(documents.length === 2 && documents[0].title === 'Communiqué de rentrée' && documents[1].date === '2026-01-05' && documents[1].file.mime === 'application/pdf' && documents[1].topics.join() === 'tarifs,cabinet', 'documents : ' + JSON.stringify(documents))
  })
}
