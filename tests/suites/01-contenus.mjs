// Contenus : formulaires, médiathèque, références résolues par l'API publique, site public.
import { api, check, clickText, field, fieldset, find, json, login, parse, says, typeIn } from '../lib/harness.mjs'

export const meta = { title: 'contenus, médiathèque, API publique, site' }

const IMAGE = 'Photo du Cabinet.png'

export default async function (t) {
  const { B, step } = t
  const page = await t.newPage({ width: 1500, height: 1300 })
  const heading = text => page.waitForFunction(text => document.querySelector('h1')?.textContent === text, {}, text)
  const openNew = () => page.waitForFunction(() => location.pathname.endsWith('/new'))
  const pickImage = async () => {
    await clickText(page, 'button', 'Choisir une image')
    await page.waitForSelector(`.modal-open button[title="${IMAGE}"]`)
    await page.click(`.modal-open button[title="${IMAGE}"]`)
  }

  await step('connexion', () => login(page, B))

  await step('catégorie (sans brouillon)', async () => {
    await clickText(page, 'aside a', 'Catégories'); await heading('Catégories')
    await page.click('a.btn-primary'); await openNew()
    await typeIn(page, 'Nom', 'Entreprises')
    await clickText(page, 'button', 'Enregistrer'); await says(page, 'Enregistré. Le site est à jour.')
  })

  await step('médiathèque : import, refus d\'un type, texte alternatif', async () => {
    await clickText(page, 'aside a', 'Médiathèque'); await page.waitForSelector('input[type=file]')
    const input = await page.$('input[type=file]')
    await input.uploadFile(t.fixture('notes.txt')); await says(page, 'Type de fichier non accepté')
    await input.uploadFile(t.fixture(IMAGE)); await says(page, 'Fichier importé')
    await says(page, '320 × 240 px')
    const alt = await field(page, 'Texte alternatif (français)', 'textarea')
    // Le texte est enregistré quand on quitte le champ.
    await alt.type('Façade du cabinet'); await page.click('h1'); await says(page, 'Texte alternatif enregistré')
  })
  await t.shot(page, 'mediatheque')

  let serviceId
  await step('service : image, relation, texte riche, publication', async () => {
    await clickText(page, 'aside a', 'Services'); await heading('Services')
    await page.click('a.btn-primary'); await openNew()
    await typeIn(page, 'Titre', 'Droit des affaires')
    await page.click('.tiptap'); await page.keyboard.type('Nous accompagnons les ')
    await page.click('.cms-rich button[title="Gras"]'); await page.keyboard.type('dirigeants')
    await page.click('.cms-rich button[title="Gras"]'); await page.keyboard.type('.')
    await pickImage()
    await page.waitForFunction(() => !document.querySelector('.modal-open') && document.body.innerText.includes('Remplacer'))
    const category = await field(page, 'Catégorie', 'select')
    // Première catégorie proposée, après l'option vide.
    await page.waitForFunction(select => select.options.length > 1, {}, category) // la liste arrive après l'affichage du formulaire
    await category.select(await category.$eval('option:nth-child(2)', o => o.value))
    await (await (await find(page, 'label', 'Tarif sur devis')).$('input')).evaluate(el => el.click())
    await clickText(page, 'button', 'Publier'); await page.waitForFunction(() => /\/admin\/services\/[0-9a-f-]{36}$/.test(location.pathname))
    serviceId = page.url().split('/').pop()
  })
  await t.shot(page, 'service')

  await step('liste : vignette et catégorie', async () => {
    await page.waitForNetworkIdle({ idleTime: 400 })
    await clickText(page, 'aside a', 'Services'); await page.waitForSelector('table img')
    const row = await (await find(page, 'tbody tr', 'Droit des affaires')).evaluate(tr => tr.innerText)
    check(row.includes('Entreprises'), 'la colonne Catégorie devrait afficher le nom : ' + row)
  })

  await step('icônes : menu (dont celles de la configuration)', async () => {
    const menu = await page.$$eval('aside .menu a', as => as.map(a => `${a.textContent.trim()}=${[...(a.querySelector('svg')?.classList ?? [])].find(c => c.startsWith('lucide-') && c !== 'lucide-icon') ?? 'aucune'}`))
    const want = ['Accueil=lucide-house', 'Services=lucide-briefcase', 'Catégories=lucide-tags', 'Témoignages=lucide-message-square-quote', 'Médiathèque=lucide-images', 'Utilisateurs=lucide-users']
    for (const w of want) check(menu.includes(w), `menu : ${w} absent de ${menu.join(' | ')}`)
  })
  await t.shot(page, 'liste')

  await step('accueil : lien vers une page, relation multiple', async () => {
    await clickText(page, 'aside a', 'Accueil'); await page.waitForFunction(() => location.pathname === '/admin/home')
    await typeIn(page, 'Titre principal', 'Un conseil clair')
    const link = await fieldset(page, 'Bouton principal')
    const selects = () => link.$$('select')
    await (await selects())[0].select('services')
    // Le second menu (la page visée) apparaît puis se remplit.
    await page.waitForFunction(el => el.querySelectorAll('select').length === 2 && el.querySelectorAll('select')[1].options.length > 1, {}, link)
    await (await selects())[1].select(serviceId)
    await (await link.$('input.input')).type('Découvrir')
    await (await (await fieldset(page, 'Services mis en avant')).$('input[type=checkbox]')).evaluate(el => el.click())
    await pickImage()
    await clickText(page, 'button', 'Publier'); await says(page, 'Publié. Le site est à jour.')
    await page.waitForNetworkIdle({ idleTime: 400 })
    const after = await page.evaluate(() => ({
      text: document.body.innerText,
      link: [...document.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent.trim() === 'Bouton principal').querySelectorAll('select')[1]?.selectedOptions[0]?.textContent,
    }))
    check(!after.text.includes('n\'existe plus') && !after.text.includes('Aucun contenu à choisir'), 'la relation a perdu ses choix après enregistrement')
    check(after.link === 'Droit des affaires', 'le lien a perdu sa cible après enregistrement : ' + after.link)
  })
  await t.shot(page, 'accueil')

  await step('API publique : références résolues', async () => {
    const home = await json(page, '/api/content/home'), [service] = await json(page, '/api/content/services')
    const expect = (cond, what) => check(cond, () => what + ' → ' + JSON.stringify({ cta: home.cta, featured: home.featured, heroImage: home.heroImage, cover: service?.cover, category: service?.category, body: service?.body }))
    expect(home.cta?.href === '/services/droit-des-affaires' && home.cta.label === 'Découvrir', 'lien')
    expect(home.featured?.[0]?.title === 'Droit des affaires' && home.featured[0].slug === 'droit-des-affaires', 'relation multiple')
    expect(home.heroImage?.alt === 'Façade du cabinet' && home.heroImage.width === 320, 'image accueil')
    expect(service.category?.title === 'Entreprises', 'relation simple')
    expect(service.cover?.url?.startsWith('/media/') && service.cover.url.endsWith('/photo-du-cabinet.png'), 'image service')
    expect(service.body === '<p>Nous accompagnons les <strong>dirigeants</strong>.</p>', 'texte riche')
    const file = await api(page, service.cover.url)
    check(file.status === 200 && file.type === 'image/png', `fichier : ${file.status} ${file.type}`)
  })

  await step('nettoyage du HTML à l\'enregistrement', async () => {
    const r = await api(page, `/api/cms/entries/services/${serviceId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit des affaires', body: '<p onclick="x()">Texte</p><script>alert(1)</script><a href="javascript:alert(1)">lien</a><img src=x onerror=alert(1)>' } } } }),
    })
    const body = parse(r).locales.fr.values.body
    check(!/script|onclick|javascript:|onerror|<img/i.test(body), 'HTML non nettoyé : ' + body)
    t.info('HTML gardé : ' + body)
  })

  await step('suppression d\'un fichier utilisé : refusée sans confirmation', async () => {
    const [media] = await json(page, '/api/cms/media')
    const usage = await json(page, `/api/cms/media/${media.id}/usage`)
    check(usage.length === 2, 'usage attendu 2, reçu ' + JSON.stringify(usage))
    const r = await api(page, `/api/cms/media/${media.id}`, { method: 'DELETE' })
    check(r.status === 409, 'statut ' + r.status)
  })

  await step('accès sans session refusé', async () => {
    const context = await t.newContext()
    const anon = await t.newPage({ context }); await anon.goto(B + '/')
    const codes = await anon.evaluate(async () => Promise.all([fetch('/api/cms/media'), fetch('/api/cms/media', { method: 'POST', body: new FormData() }), fetch('/api/cms/entries/services')].map(async r => (await r).status)))
    await context.close()
    check(codes.every(c => c === 401), codes.join(','))
  })

  await step('images : plusieurs largeurs proposées, largeur hors liste redirigée', async () => {
    await page.goto(B + '/services/droit-des-affaires', { waitUntil: 'networkidle0' })
    const img = await page.$eval('main img', i => ({ src: i.getAttribute('src'), srcset: i.getAttribute('srcset'), alt: i.alt, w: i.getAttribute('width'), loaded: i.naturalWidth > 0 }))
    const base = img.src.replace('?w=320', '')
    check(img.loaded && /\?w=320$/.test(img.src) && img.srcset === `${base}?w=160 160w, ${img.src} 320w` && img.alt === 'Façade du cabinet' && img.w === '320', JSON.stringify(img))
    const odd = await page.evaluate(async (u) => { const r = await fetch(u + '?w=500', { redirect: 'manual' }); return r.type + ' ' + r.status }, base)
    const r = await page.evaluate(async (u) => { const a = await fetch(u + '?w=500'); return { url: a.url, status: a.status, type: a.headers.get('content-type'), cache: a.headers.get('cache-control') } }, base)
    check(r.url.endsWith('?w=640') && r.status === 200 && r.type.startsWith('image/') && r.cache.includes('immutable'), JSON.stringify(r) + ' ' + odd)
  })

  await step('site public', async () => {
    await page.goto(B + '/', { waitUntil: 'networkidle0' })
    const ok = await page.evaluate(() => !!document.querySelector('main img')?.naturalWidth && document.body.innerText.includes('Découvrir') && document.body.innerText.includes('Entreprises'))
    check(ok, 'image, lien ou catégorie absent')
  })
  await t.shot(page, 'site')
}
