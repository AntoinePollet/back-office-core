// Corbeille (suppression récupérable 30 jours) et journal d'activité (qui a fait quoi et quand).
// Le serveur fait foi : l'essentiel est vérifié par l'API et par le site ; deux étapes contrôlent les écrans.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { check, clickText, login, menuLabels, says, until } from '../lib/harness.mjs'

export const meta = { title: 'corbeille (contenus et fichiers) et journal d\'activité', mock: true }

const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }
// Rôle personnalisé : supprime des services sans pouvoir publier ; témoignages : seulement les siens.
const NOE = { name: 'Noé Blanc', email: 'noe@example.com', password: 'mot-de-passe-de-noe' }
const ZOE = { name: 'Zoé Noir', email: 'zoe@example.com', password: 'mot-de-passe-de-zoe' }
// Un nom qu'un tableur prendrait pour une formule.
const EVE = { name: '=Eve+1', email: 'eve@example.com', password: 'mot-de-passe-de-eve', role: 'writer' }
const SECRETS = ['mauvais-mot-de-passe-SECRET', 'xkeysib-cle-tres-secrete']

/** Fichier de la base locale du serveur de test, pour simuler le temps qui passe. Null si introuvable. */
function databaseFile() {
  const find = (dir) => {
    if (!existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const hit = find(full); if (hit) return hit }
      else if (entry.name.endsWith('.sqlite') && !entry.name.includes('metadata')) return full
    }
    return null
  }
  return find(config.tmpDir)
}

export default async function (t) {
  const { step, admin, B, M, info } = t
  const claire = t.http(), marc = t.http(), lina = t.http(), noe = t.http(), zoe = t.http(), eve = t.http(), visitor = t.http()
  const page = await t.newPage()
  const ids = {}
  const files = {}
  const E = '/api/cms/entries'

  /** Envoi d'un fichier par la session du navigateur (l'administratrice). */
  const upload = (name, folder) => page.evaluate(async (name, folder) => {
    const canvas = document.createElement('canvas'); canvas.width = 60; canvas.height = 40
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#' + [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 0xffffff, 7).toString(16).padStart(6, '0'); ctx.fillRect(0, 0, 60, 40)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const form = new FormData(); form.append('file', blob, name)
    if (folder) form.append('folder', folder)
    return (await fetch('/api/cms/media', { method: 'POST', body: form })).json()
  }, name, folder ?? null)
  const service = (title, extra = {}) => ({ values: { title, onQuote: true, ...extra.values }, ...(extra.en ? { translations: { en: { values: { title: extra.en } } } } : {}), publish: extra.draft ? [] : ['fr', ...(extra.en ? ['en'] : [])] })
  /** Largeur de téléphone : attend que le menu latéral, qui se replie en glissant, soit sorti de l'écran. */
  const phone = async (page) => {
    await page.setViewport({ width: 390, height: 800 })
    await page.waitForFunction(() => document.querySelector('.drawer-side aside').getBoundingClientRect().right <= 0)
  }
  const trash = async client => (await client.json('/api/cms/trash')).items
  const inTrash = async (client, title) => (await trash(client)).find(i => i.title === title)
  const siteTitles = async (locale = 'fr') => (await visitor.json(`/api/content/services?locale=${locale}`)).map(s => s.title).join(' | ')
  const home = () => visitor.json('/api/content/home')
  /** Tout le journal (ou ce que les filtres en gardent), lu page après page. */
  const journal = async (query = '') => {
    const lines = []
    for (let before = ''; ;) {
      const part = await claire.json('/api/cms/activity?limit=100' + query + before)
      lines.push(...part.items)
      if (!part.next) return lines
      before = '&before=' + encodeURIComponent(part.next)
    }
  }
  /** Attend qu'une phrase figure au journal (il est écrit après la réponse) et renvoie sa ligne. */
  const logged = sentence => until(async () => (await journal()).find(l => l.summary === sentence), 'ligne du journal : ' + sentence)

  await step('préparation : comptes, rôle personnalisé, contenus publiés, image citée par deux contenus', async () => {
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    await login(page, B)
    const role = await claire.json('/api/cms/roles', { method: 'POST', body: { name: 'Relecteur', rights: { types: { services: { edit: true, delete: true }, testimonials: { edit: true, publish: true, delete: true, own: true } } } } })
    ids.role = role.id
    for (const [who, client] of [[MARC, marc], [LINA, lina], [NOE, noe], [ZOE, zoe], [EVE, eve]]) {
      const { id, link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: who.name, email: who.email, role: who.role ?? role.id } })
      who.id = id
      who.token = link.replace(/^.*\/admin\/invite\//, '')
      check((await visitor.post(`/api/cms/invite/${who.token}`, { password: who.password })).status === 200, 'mot de passe refusé pour ' + who.name)
      check((await client.signIn(who.email, who.password)).status === 200, 'connexion refusée pour ' + who.name)
    }
    // Workflows : la mise en corbeille déclenche toujours « contenu supprimé » ; la restauration a son déclencheur.
    for (const event of ['entry.deleted', 'entry.restored'])
      await claire.json('/api/cms/workflows', { method: 'POST', body: { name: 'Suivi ' + event, trigger: { event, types: [] }, actions: [{ kind: 'webhook', url: `${M}/suivi` }] } })

    files.folder = await claire.json('/api/cms/media/folders', { method: 'POST', body: { name: 'Photos' } })
    files.cover = await upload('couverture.png', files.folder.id)
    files.other = await upload('autre.png', files.folder.id)
    check(files.cover.id && files.cover.folderId === files.folder.id, 'envoi du fichier : ' + JSON.stringify(files.cover))

    // « Droit social » : deux langues, une image, une ancienne adresse (donc une redirection), plusieurs versions.
    const a = await marc.json(`${E}/services`, { method: 'POST', body: service('Droit du travail', { en: 'Employment law', values: { cover: files.cover.id } }) })
    ids.a = a.id
    await marc.json(`${E}/services/${ids.a}`, { method: 'PUT', body: { values: { title: 'Droit social' }, slug: 'droit-social', publish: ['fr'] } })
    ids.b = (await marc.json(`${E}/services`, { method: 'POST', body: service('Droit fiscal') })).id
    await claire.json(`${E}/home/home`, { method: 'PUT', body: { values: { heroTitle: 'Bienvenue', featured: [ids.a, ids.b], showGallery: true, gallery: [files.cover.id, files.other.id] }, publish: ['fr'] } })
    check(await siteTitles() === 'Droit social | Droit fiscal', 'site : ' + await siteTitles())
    const h = await home()
    check(h.featured.map(f => f.title).join() === 'Droit social,Droit fiscal' && h.gallery.length === 2, 'accueil : ' + JSON.stringify([h.featured, h.gallery.length]))
    ids.revisions = (await marc.json(`${E}/services/${ids.a}/revisions`)).length
    check(ids.revisions >= 2, 'historique attendu : ' + ids.revisions)
    check((await visitor.json('/api/content/services/droit-du-travail'))._redirect === '/services/droit-social', 'la redirection de départ manque')
  })

  // ───────────── Corbeille : contenus ─────────────

  await step('supprimer un contenu : il va dans la corbeille, avec qui, quand et le délai', async () => {
    const r = await marc.del(`${E}/services/${ids.a}`)
    check(r.status === 200 && r.json.days === 30 && r.json.purgeFailed === false, `suppression : ${r.status} ${r.text.slice(0, 200)}`)
    const item = await inTrash(marc, 'Droit social')
    check(item && item.kind === 'entry' && item.typeLabel === 'Services' && item.deletedBy === 'Marc Petit' && item.daysLeft === 30 && item.wasPublished === true, 'corbeille : ' + JSON.stringify(item))
    check(Date.now() - new Date(item.deletedAt).getTime() < 60_000, 'date de suppression : ' + item.deletedAt)
    ids.trashA = item.id
    // Une seconde suppression ne trouve plus rien ; l'identifiant reste réservé au contenu supprimé.
    check((await marc.del(`${E}/services/${ids.a}`)).status === 404, 'second passage')
    const again = await claire.post(`${E}/services`, { id: ids.a, values: { title: 'Usurpateur', onQuote: true } })
    check(again.status === 409 && /corbeille/.test(again.json.message), `identifiant repris : ${again.status} ${again.text.slice(0, 160)}`)
  })

  await step('pour le site, le contenu supprimé n\'existe plus : API, page 404, plan du site, relation, liste, recherche, redirection', async () => {
    check(await siteTitles() === 'Droit fiscal' && await siteTitles('en') === '', `listes : ${await siteTitles()} / ${await siteTitles('en')}`)
    const paged = await visitor.json('/api/content/services?limit=10')
    check(paged.total === 1 && paged.items.every(i => i.id !== ids.a), 'pagination : ' + JSON.stringify(paged).slice(0, 200))
    const codes = [
      (await visitor.get('/api/content/services/droit-social')).status,
      (await visitor.get(`/api/content/services/${ids.a}`)).status,
      (await visitor.get('/api/content/services/employment-law?locale=en')).status,
      (await visitor.get('/api/content/services/droit-du-travail')).status, // ancienne adresse : plus de redirection
      (await visitor.get('/services/droit-social')).status,
      (await visitor.get('/en/services/employment-law')).status,
      // L'aperçu des brouillons ne le montre pas non plus.
      (await claire.get('/api/content/services/droit-social?preview=1')).status,
    ]
    check(codes.every(c => c === 404), 'adresses : ' + codes.join())
    const map = (await visitor.get('/sitemap.xml')).text
    check(!map.includes('droit-social') && !map.includes('employment-law') && map.includes('droit-fiscal'), 'plan du site : ' + map.slice(0, 600))
    check((await home()).featured.map(f => f.title).join() === 'Droit fiscal', 'relation de l\'accueil : ' + JSON.stringify((await home()).featured))
    check((await visitor.get('/')).text.includes('Droit fiscal') && !(await visitor.get('/')).text.includes('Droit social'), 'page d\'accueil')
    // Dans le back-office aussi : liste, recherche, ouverture.
    check((await claire.json(`${E}/services`)).map(i => i.title).join() === 'Droit fiscal', 'liste du back-office')
    check(!JSON.stringify(await claire.json('/api/cms/search?q=social')).includes(ids.a), 'recherche du back-office')
    check((await claire.get(`${E}/services/${ids.a}`)).status === 404, 'ouverture dans le back-office')
  })

  await step('restaurer : le contenu revient comme il était (langues, publication, adresse, rang, historique, redirection, relation)', async () => {
    const r = await marc.post(`/api/cms/trash/${ids.trashA}/restore`)
    check(r.status === 200 && r.json.kind === 'entry' && r.json.id === ids.a && r.json.published === true && r.json.asDraft === false && r.json.renamed.length === 0, `restauration : ${r.status} ${r.text.slice(0, 300)}`)
    check(await siteTitles() === 'Droit social | Droit fiscal' && await siteTitles('en') === 'Employment law', `site : ${await siteTitles()} / ${await siteTitles('en')}`)
    const doc = await marc.json(`${E}/services/${ids.a}`)
    check(doc.locales.fr.slug === 'droit-social' && doc.locales.fr.status === 'published' && doc.locales.en.slug === 'employment-law' && doc.shared.cover === files.cover.id, 'contenu : ' + JSON.stringify(doc.locales))
    check((await marc.json(`${E}/services/${ids.a}/revisions`)).length === ids.revisions, 'historique : ' + (await marc.json(`${E}/services/${ids.a}/revisions`)).length)
    check((await visitor.get('/services/droit-social')).status === 200 && (await visitor.get('/services/droit-social')).text.includes('Droit social'), 'page publique')
    check((await visitor.json('/api/content/services/droit-du-travail'))._redirect === '/services/droit-social', 'redirection non restaurée')
    check((await home()).featured.map(f => f.title).join() === 'Droit social,Droit fiscal', 'relation de l\'accueil')
    check((await visitor.get('/sitemap.xml')).text.includes('/services/droit-social'), 'plan du site')
    check(!(await inTrash(marc, 'Droit social')), 'encore dans la corbeille')
    check((await marc.post(`/api/cms/trash/${ids.trashA}/restore`)).status === 404, 'seconde restauration')
    // Workflows : « supprimé » à la mise en corbeille, « restauré » au retour.
    const runs = await until(async () => { const list = await claire.json('/api/cms/workflow-runs'); return list.length >= 2 && list }, 'journal des workflows')
    check(runs.some(x => x.event === 'entry.deleted' && x.status === 'success') && runs.some(x => x.event === 'entry.restored' && x.status === 'success'), JSON.stringify(runs.map(x => [x.event, x.status, x.summary])))
  })

  await step('adresse reprise entre-temps : le contenu restauré reçoit une adresse voisine, l\'autre garde la sienne', async () => {
    check((await marc.del(`${E}/services/${ids.a}`)).status === 200, 'suppression')
    ids.c = (await marc.json(`${E}/services`, { method: 'POST', body: { ...service('Nouveau droit social'), slug: 'droit-social' } })).id
    check((await visitor.json('/api/content/services/droit-social')).id === ids.c, 'l\'adresse devait être libre')
    const r = await marc.json(`/api/cms/trash/${(await inTrash(marc, 'Droit social')).id}/restore`, { method: 'POST' })
    check(JSON.stringify(r.renamed) === JSON.stringify([{ locale: 'fr', from: 'droit-social', to: 'droit-social-2' }]), 'adresses changées : ' + JSON.stringify(r.renamed))
    check((await visitor.json('/api/content/services/droit-social')).id === ids.c, 'le nouveau contenu a perdu son adresse')
    check((await visitor.json('/api/content/services/droit-social-2')).id === ids.a, 'le contenu restauré n\'a pas d\'adresse')
    check((await visitor.json('/api/content/services/employment-law?locale=en')).id === ids.a, 'l\'adresse anglaise, libre, devait être gardée')
    // Rang d'origine : le premier de la liste, devant ceux créés depuis.
    check(await siteTitles() === 'Droit social | Droit fiscal | Nouveau droit social', 'ordre : ' + await siteTitles())
  })

  await step('pages uniques : elles ne se suppriment pas', async () => {
    const r = await claire.del(`${E}/home/home`)
    check(r.status === 400 && /ne se supprime pas/.test(r.json.message), `${r.status} ${r.text.slice(0, 160)}`)
    check((await home()).heroTitle === 'Bienvenue' && !(await trash(claire)).some(i => i.title === 'Accueil'), 'la page d\'accueil a bougé')
  })

  // ───────────── Corbeille : fichiers ─────────────

  await step('supprimer un fichier encore cité : corbeille, plus servi, disparu des contenus ; restaurer : il revient partout', async () => {
    const url = files.cover.url
    check((await visitor.get(url)).status === 200, 'le fichier devait être servi')
    const refused = await marc.del(`/api/cms/media/${files.cover.id}`)
    check(refused.status === 409 && refused.json.data.usage.length === 2, `fichier utilisé : ${refused.status} ${refused.text.slice(0, 200)}`)
    const r = await marc.del(`/api/cms/media/${files.cover.id}?force=1`)
    check(r.status === 200 && r.json.days === 30, 'suppression forcée : ' + r.status)

    const codes = [(await visitor.get(url)).status, (await visitor.get(url + '?w=320')).status, (await visitor.get(url + '?corbeille=1')).status, (await lina.get(url + '?corbeille=1')).status]
    check(codes.every(c => c === 404), 'le fichier à la corbeille est encore servi : ' + codes.join())
    const preview = await marc.get(url + '?corbeille=1')
    check(preview.status === 200 && /no-store/.test(preview.headers.get('cache-control')), `vignette de la corbeille : ${preview.status} ${preview.headers.get('cache-control')}`)
    check((await home()).gallery.map(g => g.name).join() === 'autre.png', 'galerie : ' + JSON.stringify((await home()).gallery))
    check((await visitor.json('/api/content/services/droit-social-2')).cover === null, 'image du service')
    check(!(await claire.json('/api/cms/media')).some(m => m.id === files.cover.id), 'médiathèque')
    const item = await inTrash(marc, 'couverture.png')
    check(item && item.kind === 'media' && item.deletedBy === 'Marc Petit' && item.thumbnail?.includes('corbeille=1'), 'corbeille : ' + JSON.stringify(item))

    const back = await marc.json(`/api/cms/trash/${item.id}/restore`, { method: 'POST' })
    check(back.kind === 'media' && back.folderId === files.folder.id && back.movedToRoot === false, 'restauration : ' + JSON.stringify(back))
    check((await visitor.get(url)).status === 200, 'le fichier restauré n\'est pas servi')
    check((await home()).gallery.map(g => g.name).join() === 'couverture.png,autre.png', 'galerie après restauration : ' + JSON.stringify((await home()).gallery.map(g => g.name)))
    check((await visitor.json('/api/content/services/droit-social-2')).cover?.id === files.cover.id, 'image du service après restauration')
    check((await claire.json('/api/cms/media')).find(m => m.id === files.cover.id)?.folderId === files.folder.id, 'dossier du fichier restauré')
  })

  await step('fichier dont le dossier a disparu : restauré à la racine ; même fichier renvoyé par l\'import : il sort de la corbeille', async () => {
    const loose = await upload('volante.png', files.folder.id)
    check((await claire.del(`/api/cms/media/${loose.id}`)).status === 200, 'suppression')
    const temp = await claire.json('/api/cms/media/folders', { method: 'POST', body: { name: 'Provisoire' } })
    const inTemp = await upload('provisoire.png', temp.id)
    check((await claire.del(`/api/cms/media/${inTemp.id}`)).status === 200 && (await claire.del(`/api/cms/media/folders/${temp.id}`)).status === 200, 'suppression du fichier puis du dossier')
    const back = await claire.json(`/api/cms/trash/${(await inTrash(claire, 'provisoire.png')).id}/restore`, { method: 'POST' })
    check(back.folderId === null && back.movedToRoot === true, 'dossier disparu : ' + JSON.stringify(back))
    // L'outil d'import envoie ses fichiers avec un identifiant : s'il est à la corbeille, le fichier en ressort.
    const again = await page.evaluate(async (id) => {
      const form = new FormData(); form.append('file', new Blob(['x'], { type: 'image/png' }), 'volante.png'); form.append('id', id)
      const r = await fetch('/api/cms/media', { method: 'POST', body: form })
      return { status: r.status, body: await r.json() }
    }, loose.id)
    check(again.status === 200 && again.body.id === loose.id && again.body.folderId === files.folder.id, 'renvoi : ' + JSON.stringify(again))
    check(!(await inTrash(claire, 'volante.png')) && (await visitor.get(loose.url)).status === 200, 'le fichier renvoyé est encore à la corbeille')
    files.loose = loose
  })

  // ───────────── Droits ─────────────

  await step('droits : on ne voit et ne restaure que ce qu\'on pourrait supprimer ; « seulement ses contenus »', async () => {
    const testimonial = author => ({ values: { author, quote: 'Avis de ' + author }, publish: ['fr'] })
    ids.tNoe = (await noe.json(`${E}/testimonials`, { method: 'POST', body: testimonial('Client de Noé') })).id
    ids.tZoe = (await zoe.json(`${E}/testimonials`, { method: 'POST', body: testimonial('Client de Zoé') })).id
    check((await zoe.del(`${E}/testimonials/${ids.tNoe}`)).status === 403, 'suppression du contenu d\'un autre')
    check((await noe.del(`${E}/testimonials/${ids.tNoe}`)).status === 200 && (await zoe.del(`${E}/testimonials/${ids.tZoe}`)).status === 200, 'suppression de son propre contenu')
    check((await marc.del(`${E}/services/${ids.b}`)).status === 200 && (await marc.del(`/api/cms/media/${files.loose.id}`)).status === 200, 'suppressions de l\'éditeur')

    const seen = async client => (await trash(client)).map(i => i.title).sort().join()
    // Rédactrice (ne supprime rien) : corbeille vide. Rôle personnalisé : les services, et ses seuls témoignages ; pas les fichiers.
    check(await seen(lina) === '' && await seen(eve) === '', 'la rédactrice voit : ' + await seen(lina))
    check(await seen(noe) === 'Client de Noé,Droit fiscal', 'Noé voit : ' + await seen(noe))
    check(await seen(zoe) === 'Client de Zoé,Droit fiscal', 'Zoé voit : ' + await seen(zoe))
    // Éditeur : services, témoignages de tous, fichiers. Administratrice : tout.
    check(await seen(marc) === 'Client de Noé,Client de Zoé,Droit fiscal,volante.png' && await seen(claire) === await seen(marc), 'l\'éditeur voit : ' + await seen(marc))
    check((await visitor.get('/api/cms/trash')).status === 401, 'corbeille sans connexion')
    check((await lina.json('/api/cms/trash')).canPurge === false && (await claire.json('/api/cms/trash')).canPurge === true, 'droit de supprimer définitivement mal annoncé')

    const idOf = async title => (await inTrash(claire, title)).id
    const codes = [
      (await lina.post(`/api/cms/trash/${await idOf('Droit fiscal')}/restore`)).status, // ne supprime pas les services
      (await zoe.post(`/api/cms/trash/${await idOf('Client de Noé')}/restore`)).status, // contenu d'un autre
      (await noe.post(`/api/cms/trash/${await idOf('volante.png')}/restore`)).status, // ne supprime pas les fichiers
      (await visitor.post(`/api/cms/trash/${await idOf('Droit fiscal')}/restore`)).status,
    ]
    check(codes.join() === '404,404,404,401', 'restaurations refusées : ' + codes.join())
    // Suppression définitive et vidage : administrateur seulement.
    const purges = [
      (await marc.del(`/api/cms/trash/${await idOf('Droit fiscal')}`)).status, (await noe.del(`/api/cms/trash/${await idOf('Client de Noé')}`)).status,
      (await marc.del('/api/cms/trash')).status, (await lina.del('/api/cms/trash')).status, (await visitor.del('/api/cms/trash')).status,
    ]
    check(purges.join() === '403,403,403,403,401' && (await trash(claire)).length === 4, 'suppressions définitives refusées : ' + purges.join())

    // Noé restaure son témoignage (il peut le publier : il revient en ligne) ; Zoé le sien.
    const mine = await noe.json(`/api/cms/trash/${await idOf('Client de Noé')}/restore`, { method: 'POST' })
    check(mine.published === true && mine.asDraft === false, 'témoignage de Noé : ' + JSON.stringify(mine))
    check((await visitor.json('/api/content/testimonials')).map(x => x.author).join() === 'Client de Noé', 'témoignages en ligne')
    // Noé restaure un service qui était en ligne, sans pouvoir publier : il revient en brouillon.
    const draft = await noe.json(`/api/cms/trash/${await idOf('Droit fiscal')}/restore`, { method: 'POST' })
    check(draft.asDraft === true && draft.published === false, 'service restauré sans droit de publier : ' + JSON.stringify(draft))
    check(!(await siteTitles()).includes('Droit fiscal') && (await claire.json(`${E}/services/${ids.b}`)).locales.fr.status === 'draft', 'le service est revenu en ligne : ' + await siteTitles())
    check((await claire.json(`${E}/services/${ids.b}`, { method: 'PUT', body: { values: {}, publish: ['fr'] } })).locales.fr.status === 'published', 'republication par l\'administratrice')
  })

  // ───────────── Suppression définitive, vidage, expiration ─────────────

  await step('supprimer définitivement, puis vider la corbeille : plus rien à restaurer, fichier effacé du stockage', async () => {
    const zoeItem = await inTrash(claire, 'Client de Zoé')
    check((await claire.del(`/api/cms/trash/${zoeItem.id}`)).status === 200, 'suppression définitive')
    check(!(await inTrash(claire, 'Client de Zoé')) && (await zoe.post(`/api/cms/trash/${zoeItem.id}/restore`)).status === 404, 'encore restaurable')
    check((await claire.del(`/api/cms/trash/${zoeItem.id}`)).status === 404, 'seconde suppression définitive')
    // L'identifiant est libéré : il peut resservir.
    check((await claire.post(`${E}/testimonials`, { id: ids.tZoe, values: { author: 'Nouveau client', quote: 'Avis' } })).status === 200, 'identifiant non libéré')

    check((await marc.del(`${E}/services/${ids.c}`)).status === 200, 'suppression d\'un service')
    check((await trash(claire)).map(i => i.title).sort().join() === 'Nouveau droit social,volante.png', 'avant vidage : ' + (await trash(claire)).map(i => i.title))
    const emptied = await claire.del('/api/cms/trash')
    check(emptied.status === 200 && emptied.json.count === 2 && (await trash(claire)).length === 0, `vidage : ${emptied.status} ${emptied.text}`)
    const gone = [(await visitor.get(files.loose.url)).status, (await claire.get(files.loose.url + '?corbeille=1')).status]
    check(gone.join() === '404,404', 'le fichier supprimé définitivement est encore dans le stockage : ' + gone.join())
    // Ce qui n'était pas dans la corbeille n'a pas bougé.
    check((await visitor.get(files.cover.url)).status === 200 && await siteTitles() === 'Droit social | Droit fiscal', 'le vidage a touché autre chose : ' + await siteTitles())
  })

  await step('expiration : après 30 jours, l\'élément est supprimé pour de bon', async () => {
    const old = (await marc.json(`${E}/services`, { method: 'POST', body: service('Service oublié', { draft: true }) })).id
    const fresh = (await marc.json(`${E}/services`, { method: 'POST', body: service('Service récent', { draft: true }) })).id
    const doomed = await upload('perimee.png')
    for (const url of [`${E}/services/${old}`, `${E}/services/${fresh}`, `/api/cms/media/${doomed.id}`]) check((await marc.del(url)).status === 200, 'suppression ' + url)
    const file = databaseFile()
    let done = false
    if (file) {
      // 29 jours : encore là, « dernier jour ». Puis 31 jours : parti.
      try { execFileSync('sqlite3', [file, `update cms_trash set deleted_at = ${Date.now() - 29.5 * 86400_000} where item_id in ('${old}', '${doomed.id}')`]); done = true }
      catch { /* outil absent */ }
    }
    if (!done) { info('non vérifié ici : il faut l\'outil sqlite3 pour avancer la date de suppression'); return }
    check((await inTrash(claire, 'Service oublié'))?.daysLeft === 1, 'jours restants : ' + JSON.stringify(await inTrash(claire, 'Service oublié')))
    execFileSync('sqlite3', [file, `update cms_trash set deleted_at = ${Date.now() - 31 * 86400_000} where item_id in ('${old}', '${doomed.id}')`])
    check((await trash(marc)).map(i => i.title).join() === 'Service récent', 'après le délai : ' + (await trash(marc)).map(i => i.title))
    check((await claire.get(doomed.url + '?corbeille=1')).status === 404, 'le fichier expiré est encore dans le stockage')
    await logged('Corbeille : 2 éléments supprimés définitivement après le délai de récupération')
  })

  // ───────────── Écran « Corbeille » ─────────────

  await step('écran Corbeille : suppression depuis le formulaire (message exact), liste, restauration, suppression définitive, téléphone', async () => {
    const dialogs = []
    page.on('dialog', d => dialogs.push(d.message()))
    await page.goto(`${B}/admin/services/${ids.b}`, { waitUntil: 'networkidle0' })
    await clickText(page, 'button', 'Supprimer')
    await says(page, 'Contenu mis à la corbeille')
    check(dialogs.at(-1)?.includes('corbeille') && dialogs.at(-1).includes('30 jours') && !dialogs.at(-1).includes('définitivement'), 'confirmation : ' + dialogs.at(-1))
    check((await menuLabels(page)).includes('Corbeille') && (await menuLabels(page)).includes('Activité'), 'menu : ' + await menuLabels(page))

    await clickText(page, 'aside a', 'Corbeille')
    await says(page, 'Ce qui est supprimé reste ici 30 jours')
    const rows = () => page.$$eval('[data-trash-item]', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))
    const row = (await rows()).find(r => r.includes('Droit fiscal'))
    check(row && row.includes('Services') && row.includes('était en ligne') && row.includes('par Claire Durand') && row.includes('encore 30 jours'), 'ligne : ' + row)
    await t.shot(page, 'corbeille')
    await phone(page)
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'la corbeille déborde en largeur de téléphone')
    await t.shot(page, 'corbeille-telephone')
    await page.setViewport({ width: 1400, height: 1100 })

    const line = async title => (await page.evaluateHandle(title => [...document.querySelectorAll('[data-trash-item]')].find(e => e.innerText.includes(title)), title)).asElement()
    await clickText(page, 'button', 'Restaurer', await line('Droit fiscal'))
    await says(page, '« Droit fiscal » est restauré.')
    check(dialogs.at(-1).includes('de nouveau visible sur le site'), 'confirmation de restauration : ' + dialogs.at(-1))
    check((await page.$eval('[data-trash-restored]', e => e.innerText)).includes('Il est de nouveau en ligne.'), 'message de restauration')
    check((await siteTitles()).includes('Droit fiscal'), 'le site ne montre pas le contenu restauré')

    await (await (await line('Service récent')).$('button[aria-label="Supprimer définitivement"]')).evaluate(b => b.click())
    await says(page, 'Supprimé définitivement')
    check(dialogs.at(-1).includes('ne pourra plus être récupéré'), 'confirmation : ' + dialogs.at(-1))
    await says(page, 'La corbeille est vide.')

    // Rédactrice : ni corbeille ni activité dans le menu ; l'écran Activité la renvoie à l'accueil.
    const ctx = await t.newContext()
    const other = await t.newPage({ context: ctx })
    await login(other, B, LINA)
    const labels = await menuLabels(other)
    check(!labels.includes('Corbeille') && !labels.includes('Activité'), 'menu de la rédactrice : ' + labels)
    await other.goto(B + '/admin/activity', { waitUntil: 'networkidle0' })
    check(!new URL(other.url()).pathname.startsWith('/admin/activity') && !(await other.evaluate(() => document.body.innerText)).includes('Le journal garde'), 'la rédactrice a ouvert l\'écran Activité : ' + other.url())
    await ctx.close()
  })

  // ───────────── Journal d'activité ─────────────

  await step('journal : les actions sur les contenus et la corbeille y figurent, avec la bonne personne et la bonne phrase', async () => {
    for (const sentence of [
      'Marc Petit a créé « Droit du travail » (Services)',
      'Marc Petit a publié « Droit du travail » (Services, français et anglais)',
      'Marc Petit a publié « Droit social » (Services, français)',
      'Claire Durand a publié la page « Accueil » (français)',
      'Marc Petit a supprimé « Droit social » (Services) (mis à la corbeille)',
      'Marc Petit a restauré « Droit social » (Services) depuis la corbeille',
      'Noé Blanc a restauré « Droit fiscal » (Services) depuis la corbeille',
      'Claire Durand a supprimé définitivement « Client de Zoé » (Témoignages)',
      'Claire Durand a vidé la corbeille (2 éléments supprimés définitivement)',
      'Claire Durand a envoyé le fichier « couverture.png »',
      'Marc Petit a supprimé le fichier « couverture.png » (mis à la corbeille)',
      'Marc Petit a restauré le fichier « couverture.png » depuis la corbeille',
      'Claire Durand a créé le dossier « Photos »',
      'Claire Durand a supprimé le dossier « Provisoire »',
      'Claire Durand a créé le rôle « Relecteur »',
      'Claire Durand a invité Lina Roux (lina@example.com) avec le rôle « Rédacteur »',
      'Claire Durand a invité Noé Blanc (noe@example.com) avec le rôle « Relecteur »',
      'Lina Roux a choisi son mot de passe',
      'Lina Roux a ouvert une session',
      'Claire Durand a créé le workflow « Suivi entry.deleted »',
    ]) await logged(sentence)
    const lines = await journal()
    // Un enregistrement qui publie ne laisse pas en plus une ligne « modifié ».
    check(!lines.some(l => l.summary.includes('a modifié « Droit social »')), 'ligne « modifié » en trop')
    const line = lines.find(l => l.summary.startsWith('Marc Petit a supprimé « Droit social »'))
    check(line.actorName === 'Marc Petit' && line.actorEmail === MARC.email && line.category === 'content' && line.action === 'entry.deleted' && line.ip === null, JSON.stringify(line))
    // Lien vers l'élément tant qu'il existe ; aucun pour ce qui est supprimé pour de bon.
    check(line.link === `/admin/services/${ids.a}`, 'lien : ' + line.link)
    check(lines.find(l => l.summary.includes('définitivement « Client de Zoé »')).link === null, 'lien vers un contenu supprimé définitivement')
    check(new Date(lines[0].at) >= new Date(lines.at(-1).at), 'ordre : du plus récent au plus ancien')
  })

  await step('journal : versions, ordre, fichiers déplacés, comptes, rôles, réglages, aperçu', async () => {
    await claire.json(`${E}/services/${ids.a}`, { method: 'PUT', body: { unpublish: ['en'] } })
    // La plus ancienne version : le contenu s'appelait alors « Droit du travail ».
    const [first] = (await claire.json(`${E}/services/${ids.a}/revisions`)).slice(-1)
    check((await claire.post(`${E}/services/${ids.a}/revisions/${first.id}/restore`)).status === 200, 'restauration d\'une version')
    // Enregistrer sans rien changer n'écrit rien au journal.
    await claire.json(`${E}/services/${ids.b}`, { method: 'PUT', body: { values: {} } })
    const order = (await claire.json(`${E}/services`)).map(i => i.id).reverse()
    check((await claire.put(`${E}/services/order`, { ids: order })).status === 200, 'changement d\'ordre')
    await claire.json(`${E}/services/${ids.b}/duplicate`, { method: 'POST' })
    await claire.json('/api/cms/media/move', { method: 'POST', body: { ids: [files.cover.id], folderId: null } })
    await claire.json(`/api/cms/media/folders/${files.folder.id}`, { method: 'PATCH', body: { name: 'Images' } })
    await claire.call(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { role: 'editor' } })
    await claire.call(`/api/cms/users/${LINA.id}`, { method: 'PATCH', body: { types: ['services', 'home'] } })
    await claire.json(`/api/cms/roles/${ids.role}`, { method: 'PUT', body: { name: 'Relecteur', rights: { types: { services: { edit: true } } } } })
    check((await claire.del(`/api/cms/users/${ZOE.id}`)).status === 200, 'suppression d\'un compte')
    await claire.json('/api/cms/modules/brevo', { method: 'PUT', body: { values: { from: 'Cabinet Durand <contact@cabinet-durand.fr>' }, secrets: { apiKey: SECRETS[1] } } })
    check((await claire.del('/api/cms/theme')).status === 200 && (await claire.put('/api/cms/admin-color', { color: '#336699' })).status === 200, 'apparence')
    const link = await claire.json('/api/cms/preview-links', { method: 'POST', body: { label: 'Pour le client', days: 7 } })
    ids.previewToken = new URL(link.url).searchParams.get('preview')
    const { workflows } = await claire.json('/api/cms/workflows')
    check((await claire.del(`/api/cms/workflows/${workflows[0].id}`)).status === 200, 'suppression d\'un workflow')

    for (const sentence of [
      'Claire Durand a restauré une version précédente de « Droit du travail » (Services)',
      'Claire Durand a retiré du site « Droit social » (Services, anglais)',
      'Claire Durand a changé l\'ordre des contenus de « Services »',
      'Claire Durand a créé « Droit fiscal (copie) » (Services) en dupliquant un contenu',
      'Claire Durand a déplacé le fichier « couverture.png » à la racine de la médiathèque',
      'Claire Durand a renommé le dossier « Photos » en « Images »',
      'Claire Durand a changé le rôle de Lina Roux (lina@example.com) : Rédacteur → Éditeur',
      'Claire Durand a limité Lina Roux (lina@example.com) à 2 contenus : Services, Accueil',
      'Claire Durand a modifié le rôle « Relecteur »',
      'Claire Durand a supprimé le compte de Zoé Noir (zoe@example.com)',
      'Claire Durand a modifié les réglages du module « Brevo »',
      'Claire Durand a créé un lien d\'aperçu « Pour le client », valable 7 jours',
      `Claire Durand a supprimé le workflow « ${workflows[0].name} »`,
    ]) await logged(sentence)
    await logged('Claire Durand a rétabli l\'apparence d\'origine du site')
    await logged('Claire Durand a changé la couleur du back-office')
    const lines = await journal()
    check(!lines.some(l => l.summary === 'Claire Durand a modifié « Droit fiscal » (Services)'), 'un enregistrement sans changement est au journal')
    // Le compte supprimé garde son nom et son e-mail dans les lignes qu'il a laissées.
    const zoeLine = lines.find(l => l.summary === 'Zoé Noir a créé « Client de Zoé » (Témoignages)')
    check(zoeLine?.actorEmail === ZOE.email && zoeLine.actorName === 'Zoé Noir', 'ligne d\'un compte supprimé : ' + JSON.stringify(zoeLine))
  })

  await step('journal : échecs de connexion répétés, avec retenue, et aucune valeur secrète', async () => {
    const before = (await journal('&category=auth')).length
    for (let i = 0; i < 2; i++) check((await visitor.signIn(MARC.email, SECRETS[0])).status === 401, 'mauvais mot de passe accepté')
    // Deux échecs : rien encore. Le troisième laisse une ligne, le quatrième aucune.
    await visitor.signIn('inconnu@example.com', SECRETS[0])
    check((await journal('&category=auth')).length === before, 'un échec isolé est au journal')
    for (let i = 0; i < 2; i++) await visitor.signIn(MARC.email, SECRETS[0])
    const line = await logged('3 échecs de connexion de suite pour le compte marc@example.com')
    check(line.actorName === null && line.ip && line.category === 'auth', JSON.stringify(line))
    check((await journal('&action=auth.failures')).length === 1, 'une ligne par échec')
    // Une adresse sans compte n'est jamais recopiée dans le journal.
    for (let i = 0; i < 3; i++) await visitor.signIn('inconnu@example.com', SECRETS[0])
    const all = JSON.stringify(await journal()) + (await claire.get('/api/cms/activity/export')).text
    check(!all.includes('inconnu@example.com'), 'adresse sans compte au journal')
    for (const secret of [...SECRETS, LINA.token, MARC.token, ids.previewToken, MARC.password, admin.password]) check(!all.includes(secret), 'valeur secrète au journal : ' + secret.slice(0, 12))
    // Les seules adresses IP sont celles des échecs de connexion.
    check((await journal()).filter(l => l.ip).every(l => l.category === 'auth'), 'adresse IP hors des échecs de connexion')
  })

  await step('journal : filtres (personne, type d\'action, période, recherche), suite de la liste, accès réservé', async () => {
    const byMarc = await journal(`&actor=${encodeURIComponent(MARC.email)}`)
    check(byMarc.length > 5 && byMarc.every(l => l.actorEmail === MARC.email), 'filtre par personne')
    const auto = await journal('&actor=-')
    check(auto.length >= 1 && auto.every(l => l.actorName === null), 'filtre « actions automatiques »')
    const media = await journal('&category=media')
    check(media.length >= 5 && media.every(l => l.category === 'media'), 'filtre par famille')
    const restored = await journal('&action=entry.restored,media.restored')
    check(restored.length >= 4 && restored.every(l => /restauré/.test(l.summary)), 'filtre par action : ' + restored.map(l => l.action))
    const found = await journal(`&q=${encodeURIComponent('couverture.png')}`)
    check(found.length === 4 && found.every(l => l.summary.includes('couverture.png')), 'recherche : ' + found.map(l => l.summary).join(' / '))
    check((await journal(`&q=${encodeURIComponent('100%')}`)).length === 0 && (await journal('&q=noe%40example.com')).length > 0, 'recherche littérale ou par e-mail')
    const now = Date.now()
    check((await journal(`&from=${now - 3600_000}&to=${now + 60_000}`)).length === (await journal()).length, 'période qui couvre tout')
    check((await journal(`&to=${now - 3600_000}`)).length === 0 && (await journal(`&from=${now + 60_000}`)).length === 0, 'période vide')
    check((await journal(`&category=media&actor=${encodeURIComponent(MARC.email)}`)).every(l => l.category === 'media' && l.actorEmail === MARC.email), 'filtres cumulés')

    // Suite de la liste : pas de doublon, pas de trou.
    const total = (await journal()).length
    const seen = []
    let before = ''
    for (let i = 0; i < 40; i++) {
      const pageOf = await claire.json(`/api/cms/activity?limit=7${before}`)
      seen.push(...pageOf.items.map(l => l.id))
      if (i === 0) check(pageOf.actors.some(a => a.email === MARC.email && a.name === 'Marc Petit') && pageOf.retentionDays === 180, 'personnes du filtre : ' + JSON.stringify(pageOf.actors))
      if (!pageOf.next) break
      before = '&before=' + encodeURIComponent(pageOf.next)
    }
    check(seen.length === total && new Set(seen).size === total && total > 60, `suite de la liste : ${seen.length} lignes lues, ${total} attendues`)

    const codes = [
      (await marc.get('/api/cms/activity')).status, (await marc.get('/api/cms/activity/export')).status,
      (await lina.get('/api/cms/activity')).status, (await visitor.get('/api/cms/activity')).status, (await visitor.get('/api/cms/activity/export')).status,
    ]
    check(codes.join() === '403,403,403,401,401', 'accès au journal : ' + codes.join())
  })

  await step('journal : export CSV (filtres repris, formules neutralisées)', async () => {
    const r = await claire.get('/api/cms/activity/export')
    check(r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /attachment; filename="activite-\d{4}-\d\d-\d\d\.csv"/.test(r.headers.get('content-disposition')), `en-têtes : ${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-disposition')}`)
    const rows = r.text.split('\r\n')
    // (La marque d'encodage en tête de fichier est retirée par la lecture du texte : elle est vérifiée par les tests unitaires.)
    check(rows[0] === '"Date";"Personne";"E-mail";"Type d\'action";"Action";"Adresse IP"', 'en-tête : ' + rows[0])
    check(rows.length - 1 === (await journal()).length, `lignes : ${rows.length - 1}`)
    check(rows.some(l => l.includes('"Marc Petit";"marc@example.com";"Contenu supprimé";"Marc Petit a supprimé « Droit social » (Services) (mis à la corbeille)";""')), 'ligne attendue absente')
    // Un nom qui commence par « = » est précédé d'une apostrophe, dans chaque cellule où il ouvre le texte.
    const eveLine = rows.find(l => l.includes('eve@example.com') && l.includes('a choisi son mot de passe'))
    check(eveLine?.includes(';"\'=Eve+1";') && eveLine.includes(';"\'=Eve+1 a choisi son mot de passe";') && !/;"=/.test(r.text), 'formule non neutralisée : ' + eveLine)
    const filtered = (await claire.get(`/api/cms/activity/export?category=media&actor=${encodeURIComponent(MARC.email)}`)).text.split('\r\n')
    check(filtered.length - 1 === (await journal(`&category=media&actor=${encodeURIComponent(MARC.email)}`)).length && filtered.slice(1).every(l => l.includes('marc@example.com')), 'export filtré : ' + filtered.length)
  })

  await step('écran Activité : phrases, filtres, lien vers l\'élément, export, largeur de téléphone', async () => {
    await page.goto(B + '/admin/activity', { waitUntil: 'networkidle0' })
    await says(page, 'Le journal garde 180 jours')
    const shown = () => page.$$eval('[data-activity-line]', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))
    check((await shown()).length === 50 && (await page.evaluate(() => document.body.innerText)).includes('Aujourd\'hui'), 'première page : ' + (await shown()).length)
    await t.shot(page, 'activite')
    await clickText(page, 'button', 'Afficher les actions plus anciennes')
    await page.waitForFunction(() => document.querySelectorAll('[data-activity-line]').length > 50)

    await page.select('[data-activity-filters] select[aria-label="Personne"]', MARC.email)
    await page.waitForFunction(() => { const l = [...document.querySelectorAll('[data-activity-line]')]; return l.length > 0 && l.every(e => e.innerText.includes('Marc Petit')) })
    await page.type('[data-activity-filters] input[type=search]', 'couverture')
    await page.waitForFunction(() => document.querySelectorAll('[data-activity-line]').length === 2)
    check((await shown()).every(l => l.includes('couverture.png') && /^\d\d:\d\d Marc Petit a /.test(l)), 'lignes filtrées : ' + (await shown()).join(' / '))
    // Le fichier existe encore : la ligne propose de l'ouvrir. L'export reprend les filtres.
    check(await page.$eval('[data-activity-line] a', a => a.getAttribute('href')) === '/admin/media', 'lien vers l\'élément')
    const href = await page.$eval('[data-activity-export]', a => a.getAttribute('href'))
    check(href.includes('actor=marc%40example.com') && href.includes('q=couverture'), 'lien d\'export : ' + href)
    const kinds = await page.$$eval('[data-activity-filters] select[aria-label="Type d\'action"] option', os => os.map(o => o.textContent.trim()))
    check(kinds.includes('Contenu publié') && kinds.includes('Fichier supprimé') && kinds.includes('Connexion'), 'types d\'action : ' + kinds.slice(0, 8))
    await page.select('[data-activity-filters] select[aria-label="Type d\'action"]', 'c:auth')
    await says(page, 'Aucune action ne correspond à ces filtres.')
    await clickText(page, 'button', 'Tout afficher')
    await page.waitForFunction(() => document.querySelectorAll('[data-activity-line]').length === 50)

    await phone(page)
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'l\'écran Activité déborde en largeur de téléphone')
    await t.shot(page, 'activite-telephone')
    await page.setViewport({ width: 1400, height: 1100 })
  })
}
