// Rôles et invitations : une administratrice et un invité, chacun dans son navigateur.
import { api, check, clickText, find, jsonInit, login, menuLabels, parse, says } from '../lib/harness.mjs'

export const meta = { title: 'rôles et invitations' }

export default async function (t) {
  const { B, step } = t
  const size = { width: 1400, height: 1000 }
  const admin = await t.newPage(size)
  const editor = await t.newPage({ context: await t.newContext(), ...size })
  const users = async () => parse(await api(admin, '/api/cms/users'))
  const marc = async () => (await users()).find(u => u.email === 'marc@example.com')
  // Adresse de l'API correspondant à un lien d'invitation.
  const inviteApi = link => link.replace(B + '/admin/invite/', '/api/cms/invite/')

  let link
  await step('admin : menu complet et invitation', async () => {
    await login(admin, B)
    const items = await menuLabels(admin)
    check(items.includes('Utilisateurs') && items.includes('Réglages du site'), items.join(','))
    await clickText(admin, 'aside a', 'Utilisateurs'); await says(admin, '1 compte')
    await clickText(admin, 'button', 'Inviter')
    await admin.type('.modal-open input:not([type])', 'Marc Petit'); await admin.type('.modal-open input[type=email]', 'Marc@Example.com')
    await clickText(admin, '.modal-open button', 'Créer l\'invitation'); await says(admin, 'Invitation créée')
    link = await admin.$eval('.modal-open input[readonly]', i => i.value)
    check(/\/admin\/invite\/[\w-]{40,}$/.test(link), 'lien : ' + link)
    await clickText(admin, '.modal-open button', 'Fermer'); await says(admin, 'Invitation en attente')
  })
  await t.shot(admin, 'utilisateurs')

  await step('invité : ne peut pas se connecter avant d\'avoir choisi son mot de passe', async () => {
    await editor.goto(B + '/')
    const r = await api(editor, '/api/auth/sign-in/email', jsonInit('POST', { email: 'marc@example.com', password: 'nimportequoi-123' }))
    check(r.status === 401, 'statut ' + r.status)
  })
  await step('invité : choisit son mot de passe et arrive connecté', async () => {
    await editor.goto(link, { waitUntil: 'networkidle0' }); await says(editor, 'Bonjour Marc Petit')
    const inputs = await editor.$$('input[type=password]'); await inputs[0].type('mot-de-passe-de-marc'); await inputs[1].type('mot-de-passe-de-marc')
    await editor.click('button.btn-primary'); await editor.waitForSelector('aside .menu'); await says(editor, 'Éditeur')
  })
  await step('éditeur : menu restreint', async () => {
    const items = await menuLabels(editor)
    check(!items.includes('Utilisateurs') && !items.includes('Réglages du site') && items.includes('Services') && items.includes('Médiathèque'), items.join(','))
  })
  await t.shot(editor, 'editeur')
  await step('éditeur : accès refusés côté serveur', async () => {
    const codes = [
      (await api(editor, '/api/cms/users')).status,
      (await api(editor, '/api/cms/users', jsonInit('POST', { name: 'X', email: 'x@example.com', role: 'admin' }))).status,
      (await api(editor, '/api/cms/entries/settings/settings', jsonInit('PUT', { shared: { phone: '0102030405' }, locales: {} }))).status,
    ]
    check(codes.join() === '403,403,403', codes.join())
    await editor.goto(B + '/admin/users', { waitUntil: 'networkidle0' })
    // La page renvoie l'éditeur ailleurs dès qu'elle connaît son rôle.
    await editor.waitForFunction(() => !location.pathname.endsWith('/admin/users')).catch(() => { throw new Error('la page Utilisateurs est restée accessible') })
  })
  await step('éditeur : peut modifier un contenu', async () => {
    const r = await api(editor, '/api/cms/entries/testimonials', jsonInit('POST', { shared: { author: 'Client' }, locales: { fr: { values: { quote: 'Très bien.' } } } }))
    check(r.status === 200, r.status + ' ' + r.body.slice(0, 200))
  })
  await step('lien d\'invitation : à usage unique', async () => {
    const r = await api(editor, inviteApi(link)); check(r.status === 404, 'statut ' + r.status)
  })
  await step('garde-fous : son propre rôle, son propre compte', async () => {
    const me = parse(await api(admin, '/api/cms/me'))
    const a = await api(admin, `/api/cms/users/${me.id}`, jsonInit('PATCH', { role: 'editor' })), b = await api(admin, `/api/cms/users/${me.id}`, { method: 'DELETE' })
    check(a.status === 400 && b.status === 400, a.status + ',' + b.status)
  })
  await step('admin : passe Marc administrateur, effet immédiat', async () => {
    await admin.reload({ waitUntil: 'networkidle0' })
    const select = await (await find(admin, 'tbody tr', 'Marc Petit')).$('select')
    await select.select('admin'); await says(admin, 'Marc Petit est maintenant administrateur')
    check((await api(editor, '/api/cms/users')).status === 200, 'le nouveau rôle n\'est pas pris en compte')
  })
  await step('nouveau mot de passe : lien, ancien mot de passe invalidé, session fermée', async () => {
    const reset = parse(await api(admin, `/api/cms/users/${(await marc()).id}/invite`, { method: 'POST' })).link
    const set = await api(editor, inviteApi(reset), jsonInit('POST', { password: 'nouveau-mot-de-passe-1' })); check(set.status === 200, 'reset ' + set.status)
    check((await api(editor, '/api/cms/me')).status === 401, 'la session aurait dû être fermée')
    const old = await api(editor, '/api/auth/sign-in/email', jsonInit('POST', { email: 'marc@example.com', password: 'mot-de-passe-de-marc' })); check(old.status === 401, 'ancien mot de passe encore valable')
    const fresh = await api(editor, '/api/auth/sign-in/email', jsonInit('POST', { email: 'marc@example.com', password: 'nouveau-mot-de-passe-1' })); check(fresh.status === 200, 'nouveau mot de passe refusé : ' + fresh.status)
  })
  await step('mon compte : changement de mot de passe', async () => {
    await editor.goto(B + '/admin/account', { waitUntil: 'networkidle0' }); const inputs = await editor.$$('input[type=password]')
    await inputs[0].type('nouveau-mot-de-passe-1'); await inputs[1].type('encore-un-autre-mdp'); await inputs[2].type('encore-un-autre-mdp')
    await clickText(editor, 'button', 'Modifier le mot de passe'); await says(editor, 'Mot de passe modifié')
  })
  await step('suppression : la session du compte supprimé ne fonctionne plus', async () => {
    const del = await api(admin, `/api/cms/users/${(await marc()).id}`, { method: 'DELETE' }); check(del.status === 200, 'suppression ' + del.status)
    check((await api(editor, '/api/cms/me')).status === 401, 'session encore valable')
    const left = await users(); check(left.length === 1, 'comptes restants : ' + left.length)
  })
}
