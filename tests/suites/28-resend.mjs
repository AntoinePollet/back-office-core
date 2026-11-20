// Module Resend : réglages, vérification de la clé et du domaine, envoi des e-mails à la place de Brevo.
import { check, clickText, login, says, until } from '../lib/harness.mjs'

export const meta = {
  title: 'module Resend : clé, domaine de l\'expéditeur, envoi',
  mock: true,
  env: ({ mock }) => ({ NUXT_RESEND_API_URL: `${mock}/resend`, NUXT_BREVO_API_URL: `${mock}/v3` }),
}

const KEY = 're_cle_complete_12345'
const M = '/api/cms/modules/resend'

export default async function (t) {
  const { B, step, calls } = t
  const claire = t.http(), visitor = t.http()
  const sent = () => calls().filter(c => c.url === '/resend/emails')
  const save = body => claire.json(M, { method: 'PUT', body })
  const verify = async () => (await claire.json(`${M}/test`, { method: 'POST', body: {} }))

  await step('préparation : connexion, Resend à régler, aucun envoi possible', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const list = await claire.json('/api/cms/modules')
    const resend = (list.items ?? list).find(m => m.id === 'resend')
    check(resend && !resend.configured && resend.logo?.color === '#000000', 'module : ' + JSON.stringify(resend))
    check((await visitor.get('/api/cms/password-reset')).json.available === false, 'mot de passe oublié proposé sans envoi possible')
  })

  await step('expéditeur mal écrit refusé à l\'enregistrement', async () => {
    const r = await claire.put(M, { values: { from: 'pas une adresse' } })
    check(r.status === 400 && r.json.message.includes('Expéditeur'), r.text)
  })

  await step('vérification : clé inconnue, clé d\'envoi seulement, domaine absent ou non vérifié, domaine vérifié', async () => {
    await save({ values: { from: 'Cabinet Durand <contact@cabinet-durand.fr>' }, secrets: { apiKey: 're_mauvaise' } })
    let r = await verify(); check(!r.ok && r.message === 'Resend ne reconnaît pas cette clé d\'API.', r.message)
    await save({ secrets: { apiKey: 're_envoi_seulement' } })
    r = await verify(); check(r.ok && r.message.includes('envoi seulement'), r.message)
    await save({ values: { from: 'contact@inconnu.fr' }, secrets: { apiKey: KEY } })
    r = await verify(); check(!r.ok && r.message.includes('« inconnu.fr » n\'est pas ajouté'), r.message)
    await save({ values: { from: 'contact@pas-encore.fr' } })
    r = await verify(); check(!r.ok && r.message.includes('pas encore vérifié') && r.message.includes('pending'), r.message)
    await save({ values: { from: 'onboarding@resend.dev' } })
    r = await verify(); check(r.ok && r.message.includes('n\'envoie qu\'à l\'adresse de votre compte'), r.message)
    await save({ values: { from: 'Cabinet Durand, avocats <contact@cabinet-durand.fr>' } })
    r = await verify(); check(r.ok && r.message === 'Connexion à Resend réussie : le domaine « cabinet-durand.fr » est vérifié.', r.message)
    const state = await claire.json(M)
    check(state.configured && !JSON.stringify(state).includes(KEY) && state.settings.find(s => s.key === 'apiKey').hint === '…2345', 'la clé ressort par l\'API')
  })

  await step('Brevo non réglé, Resend réglé : c\'est Resend qui envoie le lien de mot de passe', async () => {
    check((await visitor.get('/api/cms/password-reset')).json.available === true, 'mot de passe oublié non proposé')
    check((await visitor.post('/api/cms/password-reset', { email: t.admin.email })).status === 200, 'demande refusée')
    const mail = await until(() => sent()[0], 'appel à Resend')
    check(mail.key === KEY, 'clé utilisée : ' + mail.key)
    check(mail.body.from === '"Cabinet Durand, avocats" <contact@cabinet-durand.fr>', 'expéditeur : ' + mail.body.from)
    check(JSON.stringify(mail.body.to) === JSON.stringify([t.admin.email]) && mail.body.subject.startsWith('Votre nouveau mot de passe') && mail.body.html.includes('/admin/'), JSON.stringify(mail.body).slice(0, 300))
    check(!calls().some(c => c.url === '/v3/smtp/email'), 'Brevo a été appelé')
  })

  await step('écran Modules : Resend actif, logo, vérification depuis l\'interface', async () => {
    const page = await t.newPage()
    await login(page, B)
    await page.goto(B + '/admin/modules', { waitUntil: 'networkidle0' })
    const card = await page.$$eval('main a', links => links.find(a => a.textContent.includes('Resend'))?.textContent.replace(/\s+/g, ' ').trim())
    check(/^Resend ?Réglé/.test(card ?? ''), 'carte : ' + card)
    await page.goto(B + '/admin/modules/resend', { waitUntil: 'networkidle0' })
    await clickText(page, 'button', 'Vérifier la connexion')
    await says(page, 'le domaine « cabinet-durand.fr » est vérifié')
    await t.shot(page, 'resend')
  })

  await step('retrait de la clé : plus d\'envoi', async () => {
    const state = await save({ secrets: { apiKey: null } })
    check(!state.configured, JSON.stringify(state))
    check((await visitor.get('/api/cms/password-reset')).json.available === false, 'mot de passe oublié encore proposé')
  })
}
