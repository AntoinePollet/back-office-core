// Limitation des tentatives de connexion (packages/cms/server/utils/rate-limit.ts). Sans navigateur.
import { check } from '../lib/harness.mjs'

export const meta = { title: 'limitation des tentatives de connexion' }

// Échecs tolérés par compte avant le blocage (MAX_FAILURES.email dans rate-limit.ts).
const MAX = 8
const MARC = { email: 'marc@example.com', password: 'mot-de-passe-de-marc' }

export default async function (t) {
  const { step, admin } = t
  // Un visiteur sans session : chaque tentative est indépendante des précédentes.
  const visitor = () => t.http()
  const attempt = (email, password) => visitor().signIn(email, password)

  await step('préparation : un second compte', async () => {
    const claire = t.http()
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: 'Marc Petit', email: MARC.email, role: 'editor' } })
    const set = await visitor().post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: MARC.password })
    check(set.status === 200, 'choix du mot de passe refusé : ' + set.status)
  })

  await step(`${MAX} mauvais mots de passe : chacun refusé normalement (401)`, async () => {
    const codes = []
    for (let i = 0; i < MAX; i++) codes.push((await attempt(admin.email, 'mauvais-mot-de-passe-' + i)).status)
    check(codes.every(c => c === 401), codes.join())
  })

  await step('tentative suivante : bloquée (429), même avec le bon mot de passe', async () => {
    const r = await attempt(admin.email, admin.password)
    check(r.status === 429, 'statut ' + r.status)
    check(/^Trop de tentatives de connexion\. Réessayez dans \d+ minutes?\.$/.test(r.json?.message ?? ''), 'message : ' + r.text.slice(0, 200))
    check(Number(r.headers.get('retry-after')) > 0, 'en-tête retry-after : ' + r.headers.get('retry-after'))
  })

  await step('majuscules et espaces dans l\'e-mail : pas de contournement', async () => {
    const codes = []
    for (const email of ['CLAIRE@EXAMPLE.COM', 'Claire@Example.com', '  claire@example.com  ', ' CLAIRE@example.COM']) codes.push((await attempt(email, admin.password)).status)
    check(codes.every(c => c === 429), codes.join())
  })

  await step('un autre compte n\'est pas bloqué', async () => {
    const wrong = await attempt(MARC.email, 'mauvais-mot-de-passe')
    check(wrong.status === 401, 'mauvais mot de passe sur l\'autre compte : ' + wrong.status)
    const right = await attempt(MARC.email, MARC.password)
    check(right.status === 200, 'bon mot de passe sur l\'autre compte : ' + right.status)
  })

  await step('une connexion réussie remet le compteur du compte à zéro', async () => {
    // Deux séries d'échecs, chacune sous la limite, séparées par une connexion réussie : sans remise à zéro,
    // leur total dépasserait la limite et la dernière connexion serait bloquée.
    for (const round of [1, 2]) {
      const codes = []
      for (let i = 0; i < MAX - 1; i++) codes.push((await attempt(MARC.email, `mauvais-${round}-${i}`)).status)
      check(codes.every(c => c === 401), `série ${round} : ${codes.join()}`)
      const ok = await attempt(MARC.email, MARC.password)
      check(ok.status === 200, `connexion après la série ${round} : ${ok.status}`)
    }
  })

  await step('le compte bloqué l\'est toujours', async () => {
    const r = await attempt(admin.email, admin.password)
    check(r.status === 429, 'statut ' + r.status)
  })
}
