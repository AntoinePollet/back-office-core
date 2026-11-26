// Limitation des tentatives de connexion (packages/cms/server/utils/rate-limit.ts). Sans navigateur.
import { config } from '../lib/config.mjs'
import { check } from '../lib/harness.mjs'

export const meta = { title: 'limitation des tentatives de connexion' }

// Échecs tolérés par compte avant le blocage (MAX_FAILURES.email dans rate-limit.ts).
const MAX = 8
const MARC = { email: 'marc@example.com', password: 'mot-de-passe-de-marc' }
const LEA = { email: 'lea@example.com', password: 'mot-de-passe-de-lea' }

export default async function (t) {
  const { step, admin } = t
  // Un visiteur sans session : chaque tentative est indépendante des précédentes.
  const visitor = () => t.http()
  const attempt = (email, password) => visitor().signIn(email, password)

  await step('préparation : deux autres comptes', async () => {
    const claire = t.http()
    check((await claire.signIn(admin.email, admin.password)).status === 200, 'connexion de l\'administratrice refusée')
    for (const [name, who] of [['Marc Petit', MARC], ['Léa Fabre', LEA]]) {
      const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name, email: who.email, role: 'editor' } })
      const set = await visitor().post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: who.password })
      check(set.status === 200, `choix du mot de passe refusé (${name}) : ${set.status}`)
    }
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

  await step('rafale de tentatives simultanées : pas plus de tentatives essayées que la limite', async () => {
    // Comptées après coup, des tentatives lancées ensemble liraient toutes un compteur encore à zéro et seraient toutes
    // essayées. Une adresse IP à part : seul le compteur du compte joue ici.
    const headers = { [config.ipHeader]: '203.0.113.210' }
    const tries = Array.from({ length: 3 * MAX }, (_, i) => visitor().call('/api/auth/sign-in/email', { method: 'POST', body: { email: LEA.email, password: `mauvais-en-rafale-${i}` }, headers }))
    const codes = (await Promise.all(tries)).map(r => r.status)
    check(codes.every(c => c === 401 || c === 429), codes.join())
    const tried = codes.filter(c => c === 401).length
    check(tried === MAX, `${tried} tentatives essayées pour une limite de ${MAX} : ${codes.join()}`)
    // Le compte est bloqué, comme après autant d'échecs l'un après l'autre.
    const after = await visitor().call('/api/auth/sign-in/email', { method: 'POST', body: LEA, headers })
    check(after.status === 429, 'connexion après la rafale : ' + after.status)
  })
}
