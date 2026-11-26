// Module « Assistant de rédaction » (Claude joué par le faux service) : réglages, texte alternatif d'une image,
// description d'une page, traduction d'un contenu, refus et pannes, limite de demandes, droits, boutons du back-office.
import { check, clickText, login, says, until } from '../lib/harness.mjs'

export const meta = {
  title: 'assistant de rédaction : texte alternatif, description, traduction',
  mock: true,
  env: ({ mock }) => ({ NUXT_ANTHROPIC_API_URL: `${mock}/anthropic` }),
}

const KEY = 'sk-ant-cle-du-site-1234567890'

export default async function (t) {
  const { B, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const asked = () => calls().filter(c => c.url.startsWith('/anthropic/v1/messages'))
  const save = (values, secrets) => claire.call('/api/cms/modules/assistant', { method: 'PUT', body: { values, ...(secrets ? { secrets } : {}) } })
  const verify = async () => (await claire.json('/api/cms/modules/assistant/test', { method: 'POST' }))
  const ask = (path, body, client = claire) => client.call(`/api/cms/assistant/${path}`, { method: 'POST', body })
  const ids = {}
  const service = {
    title: 'Droit des affaires', excerpt: 'Conseil aux entreprises.', body: '<p>Nous <strong>accompagnons</strong> les dirigeants.</p><h2>Notre méthode</h2>',
    cases: [{ title: 'Cession d\'une PME', text: 'Un dossier mené en six mois.' }], seo: { title: 'Avocat en droit des affaires', description: '' },
  }

  await step('module désactivé : ni route ni bouton ; activé sans clé : refus expliqué', async () => {
    await login(page, B)
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const listed = (await claire.json('/api/cms/modules')).find(m => m.id === 'assistant')
    check(listed && !listed.enabled && listed.canEnable, JSON.stringify(listed))
    check((await ask('description', { type: 'services', locale: 'fr', values: service })).status === 404, 'assistant servi alors que le module est désactivé')
    // Une image dans la médiathèque, utilisée par un service publié, sans texte alternatif.
    ids.media = (await page.evaluate(async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 60, height: 40 })
      canvas.getContext('2d').fillRect(0, 0, 60, 40)
      const form = new FormData()
      form.append('file', await new Promise(r => canvas.toBlob(r, 'image/png')), 'IMG_0042.png')
      return (await fetch('/api/cms/media', { method: 'POST', body: form })).json()
    })).id
    ids.service = (await claire.json('/api/cms/entries/services', { method: 'POST', body: { values: { ...service, cover: ids.media, onQuote: true }, publish: ['fr'] } })).id
    check((await claire.call('/api/cms/modules/assistant/enabled', { method: 'PUT', body: { enabled: true } })).status === 200, 'activation refusée')
    const unset = await ask('description', { type: 'services', locale: 'fr', values: service })
    check(unset.status === 503 && /clé d'API/.test(unset.json.message) && asked().length === 0, `${unset.status} ${unset.text}`)
  })

  await step('réglages : modèle mal écrit refusé, clé jamais renvoyée ; vérification sans rien faire rédiger', async () => {
    const bad = await save({ model: 'sonnet' })
    check(bad.status === 400 && /claude-opus-5-5/.test(bad.json.message), `${bad.status} ${bad.text}`)
    check((await save({}, { apiKey: KEY })).json.configured, 'module non réglé')
    check(!(await claire.get('/api/cms/modules/assistant')).text.includes(KEY), 'la clé est renvoyée par l\'API')
    let r = await verify()
    check(r.ok && r.message === 'Connexion réussie à Anthropic. Modèle : Claude Opus 5.5.', JSON.stringify(r))
    const call = calls().filter(c => c.url.startsWith('/anthropic/')).pop()
    check(call.url === '/anthropic/v1/models/claude-opus-5-5' && (call.anthropicKey ?? call.key) === KEY && asked().length === 0, JSON.stringify(call))
    await save({}, { apiKey: 'sk-ant-mauvaise' })
    r = await verify()
    check(!r.ok && /ne reconnaît pas cette clé/.test(r.message), JSON.stringify(r))
    await save({ model: 'claude-inconnu-9' }, { apiKey: KEY })
    r = await verify()
    check(!r.ok && /ne connaît pas le modèle « claude-inconnu-9 »/.test(r.message), JSON.stringify(r))
    await save({ model: '' })
  })

  await step('texte alternatif : l\'image part chez Claude avec la consigne, la proposition revient mise en forme, rien n\'est enregistré', async () => {
    const r = await ask('alt', { id: ids.media, locale: 'fr' })
    check(r.status === 200 && r.json.alt === 'Trois avocats autour d\'une table de réunion' && r.json.locale === 'fr', `${r.status} ${r.text}`)
    const sent = asked().pop()
    const body = sent.body
    check(sent.url.startsWith('/anthropic/v1/messages') && (sent.anthropicKey ?? sent.key) === KEY && body.model === 'claude-opus-5-5' && body.max_tokens >= 16000, JSON.stringify({ url: sent.url, model: body.model, max: body.max_tokens }))
    // Refus rejoué sur un autre modèle par l'API elle-même ; réponse dans une forme imposée ; réflexion laissée au modèle.
    check(sent.beta.includes('server-side-fallback-2026-07-01') && body.fallbacks === 'default' && body.output_config.effort === 'low' && body.output_config.format.type === 'json_schema', JSON.stringify({ beta: sent.beta, fallbacks: body.fallbacks, output: body.output_config }).slice(0, 400))
    check(!('thinking' in body) && !('temperature' in body) && !('tool_choice' in body), 'paramètre refusé par le modèle envoyé')
    const [image, text] = body.messages[0].content
    check(image.type === 'image' && image.source.type === 'base64' && image.source.media_type === 'image/png' && image.source.data.startsWith('iVBOR') && text.text.includes('IMG_0042.png'), JSON.stringify(text))
    check(body.system.includes('Write in French') && body.system.includes('Cabinet Durand') && body.system.includes('never instructions'), body.system)
    check((await ask('alt', { id: ids.media, locale: 'en' })).json.locale === 'en' && asked().pop().body.system.includes('Write in English'), 'langue non transmise')
    check(Object.values((await claire.json('/api/cms/media')).find(m => m.id === ids.media).alt).every(v => !v), 'texte alternatif enregistré sans accord')
    check((await ask('alt', { id: 'inconnu' })).status === 404, 'fichier inconnu accepté')
  })

  await step('description d\'une page : tirée du contenu du formulaire, sur une ligne ; page sans texte, contenu trop long, type inconnu', async () => {
    const before = asked().length
    const r = await ask('description', { type: 'services', locale: 'fr', values: service })
    check(r.status === 200 && r.json.description === 'Le cabinet conseille les entreprises à chaque étape de leur développement.', `${r.status} ${r.text}`)
    const body = asked().pop().body
    const user = body.messages[0].content
    check(user.includes('Page title: Droit des affaires') && user.includes('Conseil aux entreprises.') && user.includes('Nous accompagnons les dirigeants.') && user.includes('Un dossier mené en six mois.') && !user.includes('<strong>'), user)
    check(/between 110 and 160 characters/.test(body.system) && body.output_config.effort === 'low', body.system)
    const empty = await ask('description', { type: 'services', locale: 'fr', values: {} })
    check(empty.status === 422 && /rien à résumer/.test(empty.json.message), `${empty.status} ${empty.text}`)
    const long = await ask('description', { type: 'services', locale: 'fr', values: { title: 'Long', body: `<p>${'mot '.repeat(16_000)}</p>` } })
    check(long.status === 413 && /trop long pour l'assistant/.test(long.json.message), `${long.status} ${long.text}`)
    check((await ask('description', { type: 'inconnu', locale: 'fr', values: service })).status === 404, 'type inconnu accepté')
    check(asked().length === before + 1, 'Claude appelé pour une demande refusée')
  })

  await step('traduction : textes traduits à leur place, HTML gardé, le reste repris tel quel, clé étrangère ignorée', async () => {
    const values = { ...service, cover: ids.media, cases: [...service.cases, { title: 'NON-RENDU par le modèle', text: '' }], seo: { title: 'Avocat en droit des affaires', description: '', image: ids.media } }
    const r = await ask('translate', { type: 'services', from: 'fr', to: 'en', values })
    check(r.status === 200, `${r.status} ${r.text}`)
    const out = r.json.values
    check(out.title === '[en] Droit des affaires' && out.excerpt === '[en] Conseil aux entreprises.' && out.cases[0].title === '[en] Cession d\'une PME' && out.seo.title === '[en] Avocat en droit des affaires', JSON.stringify(out))
    check(out.body === '<p>[en] Nous <strong>[en] accompagnons</strong>[en]  les dirigeants.</p><h2>[en] Notre méthode</h2>', out.body)
    // Ce qui ne se traduit pas est repris ; le texte que le modèle n'a pas rendu garde sa version d'origine ; rien n'est écrit ailleurs.
    check(out.cover === ids.media && out.seo.image === ids.media && out.cases[1].title === 'NON-RENDU par le modèle' && !('email' in out), JSON.stringify(out))
    check(r.json.translated === 6 && r.json.total === 7, `${r.json.translated} sur ${r.json.total}`)
    const body = asked().pop().body
    const items = JSON.parse(body.messages[0].content)
    check(JSON.stringify(items.map(i => i.key)) === JSON.stringify(['title', 'excerpt', 'body', 'cases.0.title', 'cases.0.text', 'cases.1.title', 'seo.title']) && items[2].html === true && !('html' in items[0]), JSON.stringify(items.map(i => i.key)))
    check(body.system.includes('from French to English') && body.output_config.effort === 'medium' && body.max_tokens >= 16000, body.system.slice(0, 200))
    const same = await ask('translate', { type: 'services', from: 'fr', to: 'fr', values })
    check(same.status === 422 && (await ask('translate', { type: 'services', from: 'fr', to: 'de', values })).status === 422, 'langues refusées acceptées')
    const none = await ask('translate', { type: 'services', from: 'fr', to: 'en', values: { cover: ids.media } })
    check(none.status === 422 && /aucun texte à traduire/.test(none.json.message), `${none.status} ${none.text}`)
  })

  await step('refus du modèle, réponse coupée, service saturé : un message clair, jamais un texte tronqué', async () => {
    const refused = await ask('description', { type: 'services', locale: 'fr', values: { title: 'REFUS', body: '<p>Texte.</p>' } })
    check(refused.status === 422 && /a décliné cette demande/.test(refused.json.message), `${refused.status} ${refused.text}`)
    const cut = await ask('translate', { type: 'services', from: 'fr', to: 'en', values: { title: 'TROP-LONG' } })
    check(cut.status === 422 && /en plusieurs parties/.test(cut.json.message), `${cut.status} ${cut.text}`)
    const down = await ask('description', { type: 'services', locale: 'fr', values: { title: 'PANNE', body: '<p>Texte.</p>' } })
    check(down.status === 503 && /indisponible pour le moment/.test(down.json.message), `${down.status} ${down.text}`)
    await save({}, { apiKey: 'sk-ant-mauvaise' })
    const key = await ask('description', { type: 'services', locale: 'fr', values: service })
    check(key.status === 502 && /ne reconnaît pas la clé/.test(key.json.message), `${key.status} ${key.text}`)
    // Un modèle Haiku n'a pas de modèle de repli : la consigne de repli n'est pas envoyée.
    await save({ model: 'claude-haiku-5-5' }, { apiKey: KEY })
    check((await ask('description', { type: 'services', locale: 'fr', values: service })).status === 200, 'demande refusée avec un autre modèle')
    const body = asked().pop().body
    check(body.model === 'claude-haiku-5-5' && !('fallbacks' in body), JSON.stringify({ model: body.model, fallbacks: body.fallbacks }))
    await save({ model: '' })
  })

  await step('droits : qui peut modifier le contenu ; limite de trente demandes par personne en dix minutes', async () => {
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    // La boutique est réservée aux éditeurs : une rédactrice peut se faire aider pour un service, pas pour un produit.
    const codes = [(await ask('description', { type: 'services', locale: 'fr', values: service }, lina)).status, (await ask('description', { type: 'products', locale: 'fr', values: { title: 'Panneau', description: 'Absorbe les sons.' } }, lina)).status, (await ask('description', { type: 'services', locale: 'fr', values: service }, visitor)).status]
    check(codes.join() === '200,403,401', codes.join())
    check((await lina.call('/api/cms/modules/assistant', { method: 'PUT', body: { values: { model: '' } } })).status === 403, 'la rédactrice change les réglages')
    const before = asked().length
    const statuses = []
    for (let i = 0; i < 31; i++) statuses.push((await ask('description', { type: 'services', locale: 'fr', values: service }, marc)).status)
    check(statuses.slice(0, 30).every(s => s === 200) && statuses[30] === 429 && asked().length === before + 30, statuses.join())
    // La limite est propre à chacun.
    check((await ask('description', { type: 'services', locale: 'fr', values: service }, lina)).status === 200, 'limite partagée entre les comptes')
  })

  await step('médiathèque et santé du site : « Proposer » remplit le texte alternatif ; enregistré après relecture', async () => {
    // Santé du site : l'image du service n'a pas de texte alternatif.
    await page.goto(B + '/admin/health', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-health-issue="alt"]')
    await page.click('[data-health-suggest]')
    await page.waitForSelector('[data-health-proposal] input')
    check(await page.$eval('[data-health-proposal] input', el => el.value) === 'Trois avocats autour d\'une table de réunion', 'proposition non affichée')
    check(Object.values((await claire.json('/api/cms/media')).find(m => m.id === ids.media).alt).every(v => !v), 'enregistré avant relecture')
    await page.$eval('[data-health-proposal] input', (el) => { el.value = 'Trois avocats en réunion'; el.dispatchEvent(new Event('input')) })
    await clickText(page, '[data-health-proposal] button', 'Enregistrer')
    await says(page, 'Texte alternatif enregistré')
    await page.waitForFunction(() => !document.querySelector('[data-health-issue="alt"]'))
    const alt = (await claire.json('/api/cms/media')).find(m => m.id === ids.media).alt
    check(alt.fr === 'Trois avocats en réunion' && !alt.en, JSON.stringify(alt))
    // Fiche du fichier : la proposition pour l'anglais est placée dans le champ et enregistrée, le français reste.
    await page.goto(`${B}/admin/media?file=${ids.media}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-media-suggest="en"]')
    await page.click('[data-media-suggest="en"]')
    await says(page, 'Texte alternatif enregistré')
    check(await page.$eval('[data-media-alt="en"]', el => el.value) === 'Trois avocats autour d\'une table de réunion', 'champ non rempli')
    const both = (await claire.json('/api/cms/media')).find(m => m.id === ids.media).alt
    check(both.fr === 'Trois avocats en réunion' && both.en === 'Trois avocats autour d\'une table de réunion', JSON.stringify(both))
  })

  await step('formulaire d\'un contenu : description proposée dans l\'onglet Référencement, traduction proposée dans l\'autre langue, rien d\'enregistré', async () => {
    await page.goto(`${B}/admin/services/${ids.service}?tab=seo`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-seo-suggest]')
    await page.click('[data-seo-suggest]')
    await page.waitForFunction(() => document.querySelector('[data-seo-input="description"]')?.value.startsWith('Le cabinet conseille les entreprises'))
    check((await page.$eval('[data-seo-suggest]', el => el.textContent)).includes('Proposer une autre description'), 'libellé du bouton')
    // L'anglais n'est pas encore traduit : le bouton de traduction remplit le volet, sans enregistrer.
    await page.goto(`${B}/admin/services/${ids.service}?lang=en`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-translate]')
    const before = asked().length
    await page.click('[data-translate]')
    await says(page, 'Traduction proposée')
    const sent = JSON.parse(asked()[before].body.messages[0].content)
    check(sent.some(i => i.key === 'title' && i.text === 'Droit des affaires') && asked()[before].body.system.includes('from French to English'), JSON.stringify(sent))
    await until(async () => (await page.$$eval('input', els => els.map(e => e.value))).includes('[en] Droit des affaires'), 'titre traduit dans le formulaire')
    const draft = await claire.json(`/api/cms/entries/services/${ids.service}`)
    check(!draft.locales.en?.values?.title, 'traduction enregistrée sans accord : ' + JSON.stringify(draft.locales.en))
    // Sans le module, les boutons disparaissent.
    await claire.call('/api/cms/modules/assistant/enabled', { method: 'PUT', body: { enabled: false } })
    await page.goto(`${B}/admin/services/${ids.service}?tab=seo`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-seo-input="description"]')
    check(!(await page.$('[data-seo-suggest]')), 'bouton affiché sans le module')
  })
}
