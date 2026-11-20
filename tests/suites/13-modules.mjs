// Modules : réglages et clés d'API dans le back-office, Brevo, formulaires du site et leurs messages.
import { check, clickText, field, json, login, menuLabels, parse, says, send, until } from '../lib/harness.mjs'

export const meta = {
  title: 'modules : clés d\'API, Brevo, formulaires',
  mock: true,
  // Aucune clé dans l'hébergement : elle sera saisie dans le back-office. Seule l'adresse de Brevo vise le faux service.
  env: ({ mock }) => ({ NUXT_BREVO_API_URL: `${mock}/v3` }),
}

const KEY = 'xkeysib-cle-du-back-office-12345'
const VISITOR = { name: 'Jeanne Martin', email: 'jeanne@example.com', subject: 'devis', message: 'Bonjour, je voudrais un devis.', consent: true }

export default async function (t) {
  const { B, step, calls } = t
  const page = await t.newPage()
  const claire = t.http(), marc = t.http(), lina = t.http(), visitor = t.http()
  const mails = () => calls().filter(c => c.url === '/v3/smtp/email')

  await step('menu et liste des modules : Brevo à régler, Formulaires actif', async () => {
    await login(page, B)
    const labels = await menuLabels(page)
    check(labels.includes('Modules') && labels.some(l => l.startsWith('Messages reçus')), 'menu : ' + labels.join(', '))
    await clickText(page, 'aside a', 'Modules'); await says(page, 'Les fonctions qu\'on peut ajouter à ce site')
    const cards = await page.$$eval('main [data-module] > a', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))
    // D'autres modules peuvent être actifs dans le playground (audience, anti-robots…) : on cherche ces deux-là par leur nom.
    check(cards.some(c => c.startsWith('Brevo À régler')) && cards.some(c => c.startsWith('Formulaires Actif')), cards.join(' | '))
    // Logo officiel de Brevo dans sa couleur, icône dessinée pour les formulaires.
    const logos = Object.fromEntries(await page.$$eval('main [data-module] > a', els => els.map(a => {
      const s = a.querySelector(':scope > span[aria-hidden] svg')
      return [a.querySelector('.font-semibold')?.textContent.trim(), s && s.getAttribute('fill') + '/' + s.getAttribute('stroke')]
    })))
    check(logos.Brevo === '#0B996E/none' && logos.Formulaires === 'none/currentColor', 'logos : ' + JSON.stringify(logos))
  })
  await t.shot(page, 'liste')
  await step('sans clé : les workflows le disent et renvoient vers le réglage', async () => {
    await page.goto(B + '/admin/workflows', { waitUntil: 'networkidle0' })
    await says(page, 'L\'envoi d\'e-mails n\'est pas configuré')
    await clickText(page, 'main a', 'Régler Brevo'); await says(page, 'À régler pour que le module fonctionne : Clé d\'API, Expéditeur.')
  })
  await step('mauvaise clé : enregistrée puis refusée à la vérification, avec un message clair', async () => {
    await page.type('input[aria-label="Clé d\'API"]', 'mauvaise-cle')
    await page.type('input[aria-label="Expéditeur"]', 'Cabinet Durand <contact@cabinet-durand.fr>')
    await clickText(page, 'button', 'Vérifier la connexion')
    await says(page, 'Brevo ne reconnaît pas cette clé d\'API.')
  })
  await step('bonne clé : remplacée, vérifiée, et plus jamais renvoyée par l\'API', async () => {
    await clickText(page, 'button', 'Remplacer')
    await page.type('input[aria-label="Clé d\'API"]', KEY)
    // « Vérifier » enregistre d'abord ce qui vient d'être saisi.
    await clickText(page, 'button', 'Vérifier la connexion'); await says(page, 'Connexion réussie au compte Brevo « Cabinet Durand ».')
    await says(page, 'Clé enregistrée')
    check(calls().filter(c => c.url === '/v3/account').pop().key === KEY, 'la vérification n\'a pas utilisé la nouvelle clé')
    const one = await page.evaluate(() => fetch('/api/cms/modules/brevo').then(r => r.text()))
    const all = await page.evaluate(() => fetch('/api/cms/modules').then(r => r.text()))
    check(!one.includes(KEY) && !all.includes(KEY) && !one.includes('cle-du-back-office'), 'la clé ressort par l\'API')
    const state = JSON.parse(one)
    const key = state.settings.find(s => s.key === 'apiKey')
    check(state.configured && key.saved && key.hint === '…2345' && key.value === undefined, JSON.stringify(key))
    check((await json(page, '/api/cms/workflows')).emailConfigured === true, 'les workflows ne voient pas l\'envoi configuré')
  })
  await t.shot(page, 'brevo')

  await step('formulaire : envoi invalide refusé champ par champ, formulaire inconnu, rien d\'enregistré', async () => {
    const r = await visitor.post('/api/forms/contact', { values: { name: ' ', email: 'pas-une-adresse', message: 'court', subject: 'inconnu' } })
    const errors = r.json?.data?.errors ?? {}
    check(r.status === 422 && Object.keys(errors).sort().join() === 'consent,email,message,name,subject', `${r.status} ${JSON.stringify(errors)}`)
    check(errors.email === 'Adresse e-mail invalide.' && errors.message === '10 caractères au minimum.', JSON.stringify(errors))
    check((await visitor.post('/api/forms/inconnu', { values: {} })).status === 404, 'formulaire inconnu accepté')
    // Champ piège rempli : réponse normale, mais rien n'est enregistré.
    const trapped = await visitor.post('/api/forms/contact', { values: VISITOR, website: 'http://spam.example' })
    check(trapped.status === 200 && trapped.json.ok === true, 'piège : ' + trapped.status)
    check((await json(page, '/api/cms/forms')).submissions.length === 0, 'un envoi refusé a été enregistré')
  })
  await step('workflow « formulaire envoyé » : proposé avec ses formulaires et les variables de leurs champs', async () => {
    const { events } = await json(page, '/api/cms/workflows')
    const event = events.find(e => e.name === 'form.submitted')
    check(event?.label === 'Un formulaire du site est envoyé' && event.targetsLabel === 'Pour quels formulaires' && event.targets.map(x => x.label).join() === 'Contact', JSON.stringify(event))
    const keys = event.variables.map(v => v.key)
    check(['form.summary', 'fields.email', 'fields.message', 'site.name'].every(k => keys.includes(k)) && !keys.includes('user.email'), keys.join())
    await page.goto(B + '/admin/workflows/new', { waitUntil: 'networkidle0' })
    await (await field(page, 'Nom')).type('Prévenir à chaque message')
    await page.select('main select', 'form.submitted'); await says(page, 'Pour quels formulaires')
    await clickText(page, 'label', 'Contact')
    await clickText(page, 'button', 'Envoyer un e-mail')
    await (await field(page, 'Destinataires')).type('equipe@example.com')
    const replyTo = await field(page, 'Répondre à (facultatif)'); await replyTo.click()
    await (await page.evaluateHandle(() => [...document.querySelectorAll('aside button')].find(b => b.textContent.includes('fields.email')))).asElement().click()
    check(await replyTo.evaluate(el => el.value) === '{{ fields.email }}', 'variable non insérée dans « Répondre à »')
    await (await field(page, 'Objet')).type('Nouveau message de {{ fields.name }}')
    await (await field(page, 'Message', 'textarea')).type('{{ form.summary }}\n\nVoir : {{ form.adminUrl }}')
    await clickText(page, 'button', 'Enregistrer'); await says(page, 'Workflow enregistré')
  })
  await step('un visiteur remplit la page de contact : erreurs affichées, puis message envoyé', async () => {
    const context = await t.newContext(); const site = await t.newPage({ context })
    await site.goto(B + '/contact', { waitUntil: 'networkidle0' })
    await site.type('input[name=name]', VISITOR.name)
    await site.type('input[name=email]', 'jeanne')
    await site.type('textarea[name=message]', VISITOR.message)
    await clickText(site, 'button', 'Envoyer'); await says(site, 'Adresse e-mail invalide.'); await says(site, 'Cette case doit être cochée.')
    await site.$eval('input[name=email]', (el) => { el.value = ''; el.dispatchEvent(new Event('input')) })
    await site.type('input[name=email]', VISITOR.email)
    await site.click('input[name=consent]')
    await clickText(site, 'button', 'Envoyer'); await says(site, 'Merci, votre message est bien parti.')
    await context.close()
  })
  let submission
  await step('e-mail parti par Brevo avec la clé du back-office, réponse adressée au visiteur', async () => {
    const mail = await until(() => mails()[0], 'appel Brevo')
    check(mail.key === KEY, 'clé utilisée : ' + mail.key)
    const b = mail.body
    check(b.to[0].email === 'equipe@example.com' && b.replyTo?.email === VISITOR.email && b.sender.email === 'contact@cabinet-durand.fr', JSON.stringify({ to: b.to, replyTo: b.replyTo, sender: b.sender }))
    check(b.subject === 'Nouveau message de Jeanne Martin', 'objet : ' + b.subject)
    submission = (await json(page, '/api/cms/forms')).submissions[0]
    check(b.htmlContent.includes('Nom : Jeanne Martin<br>E-mail : jeanne@example.com<br>Sujet : Demande de devis<br>Message : Bonjour, je voudrais un devis.') && b.htmlContent.includes(`/admin/forms?message=${submission.id}`), b.htmlContent)
    const run = await until(async () => (await json(page, '/api/cms/workflow-runs')).find(r => r.event === 'form.submitted'), 'journal')
    check(run.summary === 'Formulaire « Contact » envoyé' && run.status === 'success', JSON.stringify(run))
  })
  await step('messages reçus : pastille dans le menu, lecture, lien de réponse, marqué lu', async () => {
    await page.goto(B + '/admin', { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => [...document.querySelectorAll('aside .menu a')].some(a => a.textContent.includes('Messages reçus') && a.querySelector('.badge')?.textContent.trim() === '1'))
    await clickText(page, 'aside a', 'Messages reçus'); await says(page, 'Ce que les visiteurs envoient')
    await clickText(page, 'main li button', 'Jeanne Martin'); await says(page, 'Bonjour, je voudrais un devis.')
    const detail = await page.$eval('main aside', a => a.innerText)
    check(detail.includes('Demande de devis') && detail.includes('Oui'), detail)
    check(await page.$eval('main aside a.btn-primary', a => a.getAttribute('href')) === 'mailto:jeanne@example.com', 'lien de réponse')
    await until(async () => (await json(page, '/api/cms/forms/unread')).unread === 0, 'message marqué lu')
    await page.waitForFunction(() => ![...document.querySelectorAll('aside .menu a')].some(a => a.textContent.includes('Messages reçus') && a.querySelector('.badge')))
  })
  await t.shot(page, 'messages')
  await step('test du workflow depuis l\'éditeur : données d\'exemple du formulaire', async () => {
    const before = mails().length
    const { workflows } = await json(page, '/api/cms/workflows')
    const result = parse(await send(page, `/api/cms/workflows/${workflows[0].id}/test`, {}))
    check(result.status === 'success' && result.summary === 'Formulaire « Contact » envoyé', JSON.stringify(result))
    const mail = mails()[before]
    check(mail.body.replyTo.email === 'visiteur@example.com' && mail.body.subject === 'Nouveau message de Exemple', JSON.stringify(mail.body))
  })
  await step('droits : l\'éditeur lit les messages, le rédacteur non ; les réglages des modules restent aux administrateurs', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    for (const [who, client] of [[{ name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }, marc], [{ name: 'Lina Roux', email: 'lina@example.com', role: 'writer' }, lina]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: who })
      await visitor.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: 'motdepasse-test-2' })
      check((await client.signIn(who.email, 'motdepasse-test-2')).status === 200, 'connexion refusée pour ' + who.name)
    }
    const codes = async client => (await Promise.all(['/api/cms/forms', '/api/cms/modules', '/api/cms/modules/brevo'].map(u => client.get(u)))).map(r => r.status).join()
    check(await codes(marc) === '200,403,403', 'éditeur : ' + await codes(marc))
    check(await codes(lina) === '403,403,403', 'rédacteur : ' + await codes(lina))
    check(await codes(visitor) === '401,401,401', 'visiteur : ' + await codes(visitor))
    check((await lina.json('/api/cms/forms/unread')).unread === 0, 'le rédacteur voit un compteur')
    check((await lina.call(`/api/cms/forms/submissions/${submission.id}`, { method: 'DELETE' })).status === 403, 'le rédacteur supprime un message')
    check((await marc.call('/api/cms/modules/brevo', { method: 'PUT', body: { secrets: { apiKey: 'x' } } })).status === 403, 'l\'éditeur change une clé')
  })
  await step('envois répétés : limités par visiteur', async () => {
    const statuses = []
    for (let i = 0; i < 7; i++) statuses.push((await visitor.post('/api/forms/contact', { values: VISITOR })).status)
    const refused = statuses.indexOf(429)
    check(refused >= 3 && refused <= 5 && statuses.slice(refused).every(s => s === 429) && statuses.slice(0, refused).every(s => s === 200), statuses.join())
    const r = await visitor.post('/api/forms/contact', { values: VISITOR })
    check(/Trop de messages envoyés\. Réessayez dans \d+ minutes?\./.test(r.json.message), r.text)
  })
  await step('suppression d\'un message, puis retrait de la clé : l\'envoi n\'est plus configuré', async () => {
    check((await marc.call(`/api/cms/forms/submissions/${submission.id}`, { method: 'DELETE' })).status === 200, 'suppression refusée à l\'éditeur')
    check(!(await json(page, '/api/cms/forms')).submissions.some(s => s.id === submission.id), 'message toujours là')
    const state = await claire.json('/api/cms/modules/brevo', { method: 'PUT', body: { secrets: { apiKey: null } } })
    check(!state.configured && state.missing.join() === 'Clé d\'API' && state.settings.find(s => s.key === 'from').value === 'Cabinet Durand <contact@cabinet-durand.fr>', JSON.stringify(state))
    check((await claire.json('/api/cms/workflows')).emailConfigured === false, 'envoi encore annoncé comme configuré')
    check((await visitor.get('/api/cms/password-reset')).json.available === false, 'mot de passe oublié encore proposé')
  })
}
