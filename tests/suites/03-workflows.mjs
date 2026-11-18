// Workflows : e-mails (faux Brevo) et appels de services externes, journal, pause.
import { api, check, clickText, field, login, parse, retype, says, send, until, wait } from '../lib/harness.mjs'

export const meta = {
  title: 'workflows (faux service Brevo et webhooks)',
  mock: true,
  // Le serveur envoie ses e-mails au faux service.
  env: ({ mock }) => ({ NUXT_BREVO_API_KEY: 'cle-de-test', NUXT_BREVO_API_URL: `${mock}/v3`, NUXT_EMAIL_FROM: 'Cabinet Durand <contact@cabinet-durand.fr>' }),
}

// Temps laissé à un workflow pour se déclencher, quand on vérifie justement qu'il ne se déclenche pas.
const QUIET_MS = 1200

export default async function (t) {
  const { B, M, step, calls } = t
  const page = await t.newPage()
  const runs = async () => parse(await api(page, '/api/cms/workflow-runs'))
  const saved = async () => { await says(page, 'Workflow enregistré'); await page.waitForFunction(() => /workflows\/[0-9a-f-]{36}$/.test(location.pathname)) }

  await step('connexion et page vide avec modèles', async () => {
    await login(page, B)
    await clickText(page, 'aside a', 'Workflows'); await says(page, 'Partez d\'un modèle')
  })
  await step('modèle invitation : enregistré tel quel', async () => {
    await clickText(page, 'a', 'Envoyer les invitations par e-mail')
    await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('Voici le lien pour choisir votre mot de passe'))
    await clickText(page, 'button', 'Enregistrer'); await saved()
  })
  await step('invitation → e-mail envoyé à l\'invité avec son lien', async () => {
    const r = parse(await send(page, '/api/cms/users', { name: 'Marc Petit', email: 'marc@example.com', role: 'editor' }))
    const sent = await until(() => calls().find(c => c.url === '/v3/smtp/email'), 'appel Brevo')
    const b = sent.body
    check(sent.key === 'cle-de-test', 'clé : ' + sent.key)
    check(b.to[0].email === 'marc@example.com' && b.sender.email === 'contact@cabinet-durand.fr' && b.sender.name === 'Cabinet Durand', JSON.stringify({ to: b.to, sender: b.sender }))
    check(b.subject === 'Votre accès au back-office de Cabinet Durand', 'objet : ' + b.subject)
    check(b.htmlContent.includes(`<a href="${r.link}">${r.link}</a>`) && b.htmlContent.includes('Bonjour Marc Petit,<br>'), 'corps : ' + b.htmlContent)
  })
  await step('éditeur : variable insérée au curseur, deux actions, filtre par contenu', async () => {
    await page.goto(B + '/admin/workflows/new', { waitUntil: 'networkidle0' })
    await (await field(page, 'Nom')).type('Publication des services')
    await clickText(page, 'label', 'Services')
    await clickText(page, 'button', 'Appeler un service externe'); await (await field(page, 'Adresse à appeler')).type(M + '/echec')
    await clickText(page, 'button', 'Envoyer un e-mail')
    await (await field(page, 'Destinataires')).type('equipe@example.com, pas-une-adresse')
    const subject = await field(page, 'Objet'); await subject.type('Publié : ')
    // Clic à la souris : le champ Objet doit garder la position du curseur.
    await (await page.evaluateHandle(() => [...document.querySelectorAll('aside button')].find(b => b.textContent.includes('entry.title')))).asElement().click()
    const value = await subject.evaluate(el => el.value); check(value === 'Publié : {{ entry.title }}', 'insertion : ' + value)
    await (await field(page, 'Message', 'textarea')).type('<b>{{ entry.title }}</b> est en ligne : {{ entry.url }}')
    await clickText(page, 'button', 'Enregistrer'); await saved()
  })
  await t.shot(page, 'editeur')
  await step('publication d\'une catégorie : ne déclenche rien (filtre)', async () => {
    const before = (await runs()).length
    await send(page, '/api/cms/entries/categories', { locales: { fr: { values: { name: 'Entreprises' } } } }); await wait(QUIET_MS)
    check((await runs()).length === before, 'un workflow s\'est déclenché à tort')
  })
  await step('publication d\'un service : échec et adresse invalide inscrits au journal, les deux actions tentées', async () => {
    await send(page, '/api/cms/entries/services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Droit <fiscal>' } } }, publish: ['fr'] })
    const run = await until(async () => (await runs()).find(r => r.event === 'entry.published'), 'déclenchement')
    check(run.summary === 'Services : « Droit <fiscal> » publié (fr)' && run.status === 'error', JSON.stringify(run))
    check(run.steps.length === 2 && run.steps[0].status === 'error' && run.steps[0].detail.includes('500') && run.steps[1].detail.includes('pas-une-adresse'), JSON.stringify(run.steps))
    const hook = calls().find(c => c.url === '/echec')
    check(hook.body.entry.title === 'Droit <fiscal>' && hook.body.entry.url.endsWith('/services/droit-fiscal') && hook.body.user.email === 'claire@example.com', JSON.stringify(hook.body))
  })
  await step('correction puis test : e-mail envoyé, HTML du titre neutralisé', async () => {
    await retype(await field(page, 'Destinataires'), 'equipe@example.com')
    await retype(await field(page, 'Adresse à appeler'), M + '/ok')
    await clickText(page, 'button', 'Tester'); await says(page, 'Résultat du test')
    const text = await page.$eval('.modal-open', m => m.innerText); check(text.includes('E-mail envoyé à equipe@example.com') && text.includes('réponse 200'), text)
    const mail = calls().filter(c => c.url === '/v3/smtp/email').pop()
    check(mail.body.subject === 'Publié : Contenu d\'exemple' && mail.body.htmlContent.startsWith('&lt;b&gt;Contenu d&#39;exemple&lt;/b&gt;'), JSON.stringify(mail.body))
    await clickText(page, '.modal-open button', 'Fermer')
  })
  await step('pause : plus de déclenchement', async () => {
    await page.goto(B + '/admin/workflows', { waitUntil: 'networkidle0' })
    const row = await page.evaluateHandle(() => [...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'Publication des services'))
    await (await row.asElement().$('input.toggle')).evaluate(el => el.click()); await says(page, 'mis en pause')
    const before = (await runs()).length
    await send(page, '/api/cms/entries/services', { shared: { onQuote: true }, locales: { fr: { values: { title: 'Autre service' } } }, publish: ['fr'] }); await wait(QUIET_MS)
    check((await runs()).length === before, 'déclenché malgré la pause')
  })
  await step('journal lisible', async () => {
    await clickText(page, 'a.tab', 'Journal'); await says(page, 'Ce qui s\'est passé')
    await clickText(page, 'tbody td', 'Services : « Droit <fiscal> » publié (fr)'); await says(page, 'Adresse invalide : pas-une-adresse')
  })
  await t.shot(page, 'journal')
  await step('réservé aux administrateurs', async () => {
    const context = await t.newContext(); const anon = await t.newPage({ context }); await anon.goto(B + '/')
    const codes = await anon.evaluate(async () => Promise.all(['/api/cms/workflows', '/api/cms/workflow-runs'].map(async u => (await fetch(u)).status)))
    await context.close(); check(codes.join() === '401,401', codes.join())
  })
}
