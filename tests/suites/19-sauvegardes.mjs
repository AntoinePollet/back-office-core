// Sauvegardes et restauration (packages/cms/server/utils/backup.ts, shared/backup.ts, écran /admin/backups).
// Le déclencheur planifié de Cloudflare est joué par la route de développement /_cms/dev-scheduled, qui passe par le
// même chemin qu'en production (événement `cloudflare:scheduled`) ; `scheduledTime` y fixe l'heure du déclenchement.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { config } from '../lib/config.mjs'
import { check, clickText, login, menuLabels, says, until } from '../lib/harness.mjs'

/** Expression d'un déclencheur planifié dont les sauvegardes échouent exprès (voir runBackup). */
const FAILING_CRON = '59 23 31 12 *'
const KEY = 'xkeysib-cle-secrete-des-sauvegardes-98765'
const MARC = { name: 'Marc Petit', email: 'marc@example.com', password: 'mot-de-passe-de-marc', role: 'editor' }
const LINA = { name: 'Lina Roux', email: 'lina@example.com', password: 'mot-de-passe-de-lina', role: 'writer' }

export const meta = {
  title: 'sauvegardes : automatique, manuelle, conservation, alertes, téléchargement, restauration, droits',
  mock: true,
  env: ({ mock }) => ({ NUXT_BREVO_API_URL: `${mock}/v3`, CMS_DEV_SIMULATE_BACKUP_FAILURE: FAILING_CRON }),
}

const HOUR = 3600_000, DAY = 24 * HOUR
/** Attend la fin de l'animation d'ouverture d'une fenêtre (pour les captures d'écran). */
const opened = page => page.waitForFunction(() => getComputedStyle(document.querySelector('.modal-open .modal-box')).opacity === '1')

export default async function (t) {
  const { B, step, calls } = t
  const claire = t.http(), marc = t.http(), anon = t.http()
  const S = '/api/cms/entries/services'
  const ids = {}
  const state = () => claire.json('/api/cms/backups')
  const scheduled = (ago, cron = '17 3 * * *') => anon.json('/_cms/dev-scheduled', { method: 'POST', body: { cron, scheduledTime: Date.now() - ago } })
  const service = values => ({ values: { excerpt: 'Résumé.', audience: 'companies', onQuote: false, fromPrice: 150, ...values }, publish: ['fr'] })
  const titles = async () => (await anon.json('/api/content/services')).map(s => s.title).sort()
  /** Télécharge une sauvegarde et la lit : en-tête, lignes par table, texte complet. */
  const read = async (client, name) => {
    const r = await fetch(`${B}/api/cms/backups/${name}/download`, { headers: { cookie: client.cookie() } })
    check(r.status === 200, `téléchargement : statut ${r.status}`)
    check(r.headers.get('cache-control') === 'private, no-store', 'le téléchargement ne doit jamais être mis en cache : ' + r.headers.get('cache-control'))
    check(/attachment; filename="sauvegarde-/.test(r.headers.get('content-disposition') ?? ''), 'en-tête de téléchargement absent')
    const text = gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')
    const lines = text.trim().split('\n').map(l => JSON.parse(l))
    const tables = {}
    let current
    for (const line of lines.slice(1)) {
      if (Array.isArray(line)) current.rows.push(Object.fromEntries(current.columns.map((c, i) => [c.name, line[i]])))
      else if (line.table) current = tables[line.table] = { columns: line.columns, rows: [] }
    }
    return { text, header: lines[0], end: lines.at(-1), tables }
  }

  await step('préparation : contenus, clé d\'API d\'un module, un éditeur, un workflow « une sauvegarde a échoué »', async () => {
    check((await claire.signIn(t.admin.email, t.admin.password)).status === 200, 'connexion refusée')
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: MARC.name, email: MARC.email, role: MARC.role } })
    check((await anon.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: MARC.password })).status === 200, 'mot de passe refusé')
    check((await marc.signIn(MARC.email, MARC.password)).status === 200, 'connexion de l\'éditeur refusée')
    ids.social = (await claire.json(S, { method: 'POST', body: service({ title: 'Droit social' }) })).id
    ids.fiscal = (await claire.json(S, { method: 'POST', body: service({ title: 'Droit fiscal' }) })).id
    await claire.json('/api/cms/modules/brevo', { method: 'PUT', body: { values: { from: 'Cabinet Durand <contact@cabinet-durand.fr>' }, secrets: { apiKey: KEY } } })
    const catalog = (await claire.json('/api/cms/workflows')).events.map(e => e.name)
    check(catalog.includes('backup.failed') && catalog.includes('backup.succeeded'), 'déclencheurs proposés : ' + catalog.join(', '))
    await claire.json('/api/cms/workflows', { method: 'POST', body: {
      name: 'Prévenir si une sauvegarde échoue', trigger: { event: 'backup.failed', types: [] },
      actions: [{ kind: 'email', to: 'claire@example.com', subject: 'Sauvegarde en échec sur {{ site.name }}', body: '{{ event.label }} : {{ backup.error }}\n{{ backup.adminUrl }}' }],
    } })
    const first = await state()
    check(first.status.code === 'never' && first.status.level === 'warning' && first.items.length === 0, 'état de départ : ' + JSON.stringify(first.status))
    check(first.retentionDays === 30, 'durée de conservation : ' + first.retentionDays)
  })

  await step('déclencheur planifié : une sauvegarde automatique, datée de l\'heure prévue ; une seule par jour', async () => {
    await scheduled(40 * DAY)
    let s = await state()
    check(s.items.length === 1 && s.items[0].kind === 'auto' && s.items[0].size > 500, 'liste : ' + JSON.stringify(s.items))
    check(Math.abs(Date.now() - 40 * DAY - new Date(s.items[0].createdAt).getTime()) < 60_000, 'date : ' + s.items[0].createdAt)
    ids.old = s.items[0].name
    // Un second déclenchement le même jour (un site peut avoir d'autres tâches planifiées) ne refait pas de sauvegarde.
    await scheduled(40 * DAY - 3 * HOUR)
    s = await state()
    check(s.items.length === 1, 'une seconde sauvegarde a été faite le même jour')
    check(s.status.code === 'late' && s.status.level === 'error', 'une sauvegarde vieille de 40 jours doit alerter : ' + JSON.stringify(s.status))
  })

  await step('la route interne de la tâche planifiée n\'existe pas pour l\'extérieur', async () => {
    for (const client of [anon, claire]) check((await client.post('/_cms/scheduled', { cron: '* * * * *' })).status === 404, 'route interne atteignable')
    check((await state()).items.length === 1, 'une sauvegarde a été déclenchée de l\'extérieur')
  })

  await step('échec de la sauvegarde automatique : alerte claire, tentative dans la liste, e-mail du workflow', async () => {
    await scheduled(3 * DAY, FAILING_CRON)
    const s = await state()
    check(s.status.code === 'failed' && s.status.level === 'error', JSON.stringify(s.status))
    check(s.status.title === 'La dernière sauvegarde automatique a échoué' && s.status.message.includes('Échec simulé'), s.status.message)
    check(s.failures.length === 1 && s.failures[0].kind === 'auto' && s.items.length === 1, 'échecs : ' + JSON.stringify(s.failures))
    const mail = await until(() => calls().find(c => c.url === '/v3/smtp/email'), 'e-mail du workflow')
    check(mail.key === KEY, 'l\'e-mail n\'est pas parti avec la clé enregistrée')
    check(mail.body.subject === 'Sauvegarde en échec sur Cabinet Durand', 'objet : ' + mail.body.subject)
    check(mail.body.htmlContent.includes('La sauvegarde automatique a échoué : Échec simulé') && mail.body.htmlContent.includes('/admin/backups'), mail.body.htmlContent)
    // Pas de nouvelle tentative dans l'heure : un déclencheur fréquent n'envoie pas un e-mail par minute.
    await scheduled(3 * DAY - 10 * 60_000, FAILING_CRON)
    check((await state()).failures.length === 1 && calls().filter(c => c.url === '/v3/smtp/email').length === 1, 'nouvelle tentative trop tôt')
  })

  await step('la sauvegarde suivante réussit : plus d\'échec en cours, mais elle date de plus de 48 h → alerte « en retard »', async () => {
    await scheduled(3 * DAY - 2 * HOUR)
    const s = await state()
    check(s.items.length === 2 && s.items[0].kind === 'auto', 'liste : ' + JSON.stringify(s.items))
    check(s.status.code === 'late' && s.status.level === 'error' && s.status.title === 'Les sauvegardes automatiques sont en retard', JSON.stringify(s.status))
    check(s.status.message.includes('plus de 48 heures'), s.status.message)
    check(s.failures.length === 1, 'l\'échec doit rester dans l\'historique')
    check(calls().filter(c => c.url === '/v3/smtp/email').length === 1, 'une réussite ne déclenche pas le workflow d\'échec')
  })

  const page = await t.newPage()
  await step('sans déclencheur depuis plus d\'un jour : la visite d\'un administrateur lance la sauvegarde du jour', async () => {
    await login(page, B)
    check((await menuLabels(page)).includes('Sauvegardes'), 'menu : ' + (await menuLabels(page)).join(', '))
    const s = await until(async () => { const s = await state(); return s.status.code === 'ok' && s }, 'sauvegarde de repli')
    check(s.items.length === 3 && s.items[0].kind === 'auto' && Date.now() - new Date(s.items[0].createdAt).getTime() < 120_000, 'liste : ' + JSON.stringify(s.items))
    // Une seconde visite ne refait rien.
    await page.reload({ waitUntil: 'networkidle0' })
    check((await state()).items.length === 3, 'une seconde sauvegarde de repli a été faite')
  })

  await step('écran : état bien visible, liste (date, origine, taille, état), tentative échouée', async () => {
    await clickText(page, 'aside a', 'Sauvegardes')
    // Le tableau de bord dit aussi « Le site est sauvegardé » : c'est le bandeau de l'écran Sauvegardes qu'on attend.
    await page.waitForSelector('[data-test="backup-status"]')
    await says(page, 'Le site est sauvegardé')
    check(await page.$eval('[data-test="backup-status"]', e => e.dataset.code + '/' + e.className.includes('alert-success')) === 'ok/true', 'bandeau d\'état')
    const rows = await page.$$eval('main li[data-backup]', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))
    check(rows.length === 4, rows.join(' | '))
    check(rows[0].includes('Automatique') && rows[0].includes('Complète') && /\d+ Ko/.test(rows[0]) && rows[0].includes('Télécharger') && rows[0].includes('Restaurer'), rows[0])
    const failed = rows.find(r => r.includes('Échec'))
    check(failed?.includes('Échec simulé') && !failed.includes('Télécharger') && !failed.includes('Restaurer'), 'ligne de l\'échec : ' + failed)
    // Le déclencheur planifié n'a pas tourné depuis trois jours (c'est la visite qui a sauvegardé) : l'écran le dit.
    check((await page.$eval('[data-test="backup-cron-missing"]', e => e.innerText)).includes('La sauvegarde de nuit n\'est pas activée'), 'avertissement absent')
  })
  await t.shot(page, 'ecran')

  await step('« Sauvegarder maintenant » : une sauvegarde manuelle ; celle de plus de 30 jours est effacée', async () => {
    await clickText(page, 'main button', 'Sauvegarder maintenant')
    await says(page, 'Sauvegarde faite')
    const s = await state()
    check(s.items[0].kind === 'manual', 'liste : ' + JSON.stringify(s.items))
    ids.manual = s.items[0].name
    check(!s.items.some(i => i.name === ids.old), 'la sauvegarde de 40 jours aurait dû être effacée')
    check(s.items.length === 3, 'les sauvegardes de moins de 30 jours doivent rester : ' + s.items.map(i => i.name).join(', '))
    await page.waitForFunction(() => document.querySelectorAll('main li[data-backup]').length === 4)
    check((await page.$$eval('main li[data-backup]', els => els[0].innerText)).includes('Manuelle'), 'la nouvelle sauvegarde n\'est pas en tête de liste')
  })

  await step('contenu : tout ce qu\'il faut pour reconstruire le site, aucun secret lisible', async () => {
    const b = await read(claire, ids.manual)
    check(b.header.format === 'backoffice-sauvegarde' && b.header.kind === 'manual' && b.header.site.name === 'Cabinet Durand' && b.header.migrations.length > 5, JSON.stringify(b.header).slice(0, 300))
    check(b.end.end === true && b.end.rows > 10, 'fin du fichier : ' + JSON.stringify(b.end).slice(0, 200))
    // Les tables sont lues dans la base : celles-ci doivent y être, et toute table future y sera de la même façon.
    for (const table of ['cms_entries', 'cms_entry_locales', 'cms_revisions', 'cms_media', 'cms_media_folders', 'cms_settings', 'cms_workflows', 'cms_workflow_runs', 'cms_module_settings', 'cms_form_submissions', 'cms_payments', 'cms_roles', 'cms_user_access', 'cms_redirects', 'user', 'account'])
      check(b.tables[table], `table ${table} absente de la sauvegarde`)
    check(b.tables.cms_entries.rows.filter(e => e.type === 'services').length === 2 && b.tables.cms_entry_locales.rows.length >= 2 && b.tables.cms_revisions.rows.length >= 2 && b.text.includes('Droit social') && b.text.includes('Droit fiscal'), 'contenus absents')
    check(b.tables.user.rows.map(u => u.email).sort().join() === 'claire@example.com,marc@example.com', 'comptes : ' + b.tables.user.rows.map(u => u.email))
    check(b.tables.cms_workflows.rows.length === 1 && b.tables.cms_workflow_runs.rows.length === 1, 'workflows absents')
    // Connexions en cours, liens à usage unique : laissés hors de la sauvegarde.
    for (const table of ['session', 'verification', 'cms_invites', 'cms_rate_limits']) check(!b.tables[table], `table ${table} présente dans la sauvegarde`)
    check(b.header.excluded.includes('session'), 'l\'en-tête doit dire ce qui est laissé de côté')
    const token = decodeURIComponent(claire.cookie()).match(/session_token=([^.;]+)/)?.[1]
    check(token && !b.text.includes(token), 'un jeton de session est dans la sauvegarde')
    // Mots de passe : chiffrés (même hachés, ils ne sortent pas en clair). Clé d'API : jamais en clair.
    check(b.tables.account.rows.length === 2 && b.tables.account.rows.every(a => typeof a.password?.$sealed === 'string' && a.password.$sealed.length > 60), 'mots de passe : ' + JSON.stringify(b.tables.account.rows[0].password).slice(0, 80))
    for (const secret of [t.admin.password, MARC.password, KEY, 'cle-secrete-des-sauvegardes']) check(!b.text.includes(secret), `« ${secret} » est lisible dans la sauvegarde`)
    check(b.tables.cms_module_settings.rows.length === 1 && b.tables.cms_module_settings.rows[0].secrets.includes('"hint"'), 'réglages du module absents')
  })

  await step('jamais accessible publiquement : ni par l\'adresse des fichiers, ni sans compte administrateur', async () => {
    for (const url of [`/media/_sauvegardes/${ids.manual}`, `/media/%5Fsauvegardes/${ids.manual}`, `/media/_sauvegardes%2F${ids.manual}`, `/media//_sauvegardes/${ids.manual}`, `/media/_sauvegardes/${ids.manual}?w=800`])
      for (const client of [anon, claire]) check((await client.get(url)).status === 404, `${url} est servi`)
    check((await anon.get(`/api/cms/backups/${ids.manual}/download`)).status === 401, 'téléchargement sans connexion')
    check((await anon.get('/api/cms/backups')).status === 401 && (await anon.post('/api/cms/backups')).status === 401, 'liste ou sauvegarde sans connexion')
    check((await anon.post(`/api/cms/backups/${ids.manual}/restore`, { confirm: 'RESTAURER' })).status === 401, 'restauration sans connexion')
    // Un nom qui n'est pas celui d'une sauvegarde ne permet pas de lire autre chose dans le stockage.
    for (const name of ['inconnue.ndjson.gz', '..%2F..%2Fx', encodeURIComponent('../' + ids.manual), ids.manual.replace('manual', 'auto')])
      check((await claire.get(`/api/cms/backups/${name}/download`)).status === 404, `nom « ${name} » accepté`)
  })

  await step('droits : un éditeur ne voit pas l\'écran, ne liste, ne télécharge, ne sauvegarde ni ne restaure', async () => {
    check((await marc.get('/api/cms/backups')).status === 403, 'liste')
    check((await marc.get(`/api/cms/backups/${ids.manual}/download`)).status === 403, 'téléchargement')
    check((await marc.post('/api/cms/backups')).status === 403, 'sauvegarde')
    check((await marc.post(`/api/cms/backups/${ids.manual}/restore`, { confirm: 'RESTAURER' })).status === 403, 'restauration')
    const context = await t.newContext()
    const his = await t.newPage({ context })
    await login(his, B, MARC)
    check(!(await menuLabels(his)).includes('Sauvegardes'), 'le menu de l\'éditeur montre les sauvegardes')
    // Sa visite ne déclenche pas non plus de sauvegarde de repli.
    await his.goto(B + '/admin/backups', { waitUntil: 'networkidle0' })
    check(!(await his.evaluate(() => document.body.innerText)).includes('Sauvegarder maintenant'), 'l\'éditeur voit l\'écran')
    await his.close()
  })

  await step('depuis la sauvegarde : une modification, une suppression, une création, un compte, un fichier, un réglage', async () => {
    await claire.json(`${S}/${ids.social}`, { method: 'PUT', body: service({ title: 'Droit social MODIFIÉ' }) })
    check((await claire.del(`${S}/${ids.fiscal}`)).status === 200, 'suppression refusée')
    ids.after = (await claire.json(S, { method: 'POST', body: service({ title: 'Créé après la sauvegarde' }) })).id
    const { link } = await claire.json('/api/cms/users', { method: 'POST', body: { name: LINA.name, email: LINA.email, role: LINA.role } })
    check((await anon.post(link.replace(/^.*\/admin\/invite\//, '/api/cms/invite/'), { password: LINA.password })).status === 200, 'mot de passe refusé')
    // Un fichier envoyé depuis le navigateur (une image d'un pixel).
    ids.media = await page.evaluate(async () => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
      const form = new FormData()
      form.append('file', new File([png], 'apres-la-sauvegarde.png', { type: 'image/png' }))
      return (await (await fetch('/api/cms/media', { method: 'POST', body: form })).json()).id
    })
    check(ids.media, 'envoi du fichier refusé')
    await claire.json('/api/cms/modules/brevo', { method: 'PUT', body: { values: { from: 'Autre <autre@cabinet-durand.fr>' } } })
    check((await titles()).join() === 'Créé après la sauvegarde,Droit social MODIFIÉ', 'site avant restauration : ' + await titles())
  })

  await step('restauration : il faut écrire le mot demandé', async () => {
    await page.reload({ waitUntil: 'networkidle0' })
    const row = await page.waitForSelector(`main li[data-backup="${ids.manual}"]`)
    await (await row.$('button')).evaluate(b => b.click())
    await says(page, 'depuis cette date sera remplacé')
    const confirm = () => page.$eval('.modal-open button.btn-error', b => b.disabled)
    check(await confirm() === true, 'le bouton est actif avant la saisie')
    await page.type('.modal-open input[aria-label="Mot de confirmation"]', 'restaurer')
    check(await confirm() === true, 'un mot mal écrit est accepté')
    // Le serveur refuse lui aussi, quel que soit l'état du bouton.
    check((await claire.post(`/api/cms/backups/${ids.manual}/restore`, { confirm: 'restaurer' })).status === 400, 'le serveur accepte un mauvais mot')
    check((await claire.post(`/api/cms/backups/${ids.manual}/restore`, {})).status === 400, 'le serveur accepte sans mot')
    check((await claire.post('/api/cms/backups/2020-01-01T00-00-00Z_auto_aaaaaa.ndjson.gz/restore', { confirm: 'RESTAURER' })).status === 404, 'sauvegarde inconnue acceptée')
    check((await titles()).join() === 'Créé après la sauvegarde,Droit social MODIFIÉ', 'un refus a modifié le site')
  })
  await t.shot(page, 'confirmation')

  await step('restauration : le site revient à l\'état sauvegardé, l\'état d\'avant est sauvegardé, le compte rendu est clair', async () => {
    await page.$eval('.modal-open input[aria-label="Mot de confirmation"]', (i) => { i.value = ''; i.dispatchEvent(new Event('input')) })
    await page.type('.modal-open input[aria-label="Mot de confirmation"]', 'RESTAURER')
    await clickText(page, '.modal-open button', 'Restaurer cette sauvegarde')
    await page.waitForSelector('[data-test="restore-result"]')
    const said = await page.$eval('[data-test="restore-result"]', e => e.innerText)
    check(said.includes('Le site est revenu à la sauvegarde choisie') && said.includes('Avant restauration') && /\d+ éléments remis en place/.test(said), said)
    check(!said.includes('n\'existe') && !said.includes('une heure'), 'avertissement inattendu : ' + said)
    await opened(page); await t.shot(page, 'compte-rendu')
    check((await titles()).join() === 'Droit fiscal,Droit social', 'site après restauration : ' + await titles())
    const list = (await claire.json(S)).items ?? await claire.json(S)
    check(list.length === 2 && !list.some(e => e.id === ids.after), 'back-office après restauration : ' + JSON.stringify(list).slice(0, 300))
    check((await claire.json('/api/cms/modules/brevo')).settings.find(s => s.key === 'from').value === 'Cabinet Durand <contact@cabinet-durand.fr>', 'le réglage n\'est pas revenu')
    const s = await state()
    check(s.items[0].kind === 'pre-restore' && s.items.length === 4, 'liste : ' + s.items.map(i => i.kind).join())
    ids.safety = s.items[0].name
    // L'état des sauvegardes, lui, ne revient pas en arrière.
    check(s.status.code === 'ok' && s.failures.length === 1, 'état des sauvegardes après restauration : ' + JSON.stringify(s.status))
  })

  await step('après la restauration : l\'administratrice reste connectée, les comptes et les fichiers récents sont conservés', async () => {
    await clickText(page, '[data-test="restore-result"] button', 'Continuer')
    await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {})
    await says(page, 'Avant restauration')
    check(new URL(page.url()).pathname === '/admin/backups', 'renvoyée vers ' + page.url())
    check((await claire.get('/api/cms/me')).status === 200 && (await marc.get('/api/cms/me')).status === 200, 'une session a été fermée')
    const users = (await claire.json('/api/cms/users')).map(u => u.email).sort()
    check(users.join() === 'claire@example.com,lina@example.com,marc@example.com', 'comptes : ' + users)
    const lina = t.http()
    check((await lina.signIn(LINA.email, LINA.password)).status === 200, 'le compte créé depuis la sauvegarde ne peut plus se connecter')
    const again = t.http()
    check((await again.signIn(t.admin.email, t.admin.password)).status === 200, 'l\'administratrice ne peut plus se reconnecter')
    const media = await claire.json('/api/cms/media')
    const found = (media.items ?? media).find(m => m.id === ids.media)
    check(found, 'le fichier envoyé depuis la sauvegarde a disparu de la médiathèque')
    check((await anon.get(found.url)).status === 200, 'le fichier n\'est plus servi')
  })

  await step('export complet (backoffice-export) : base, fichiers, mode d\'emploi ; réimport dans une base neuve', async () => {
    const out = path.join(config.tmpDir, 'export')
    fs.rmSync(out, { recursive: true, force: true })
    const run = (args, env = {}) => new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(config.rootDir, 'packages/cms/bin/export.mjs'), ...args], {
        cwd: config.playgroundDir, env: { ...process.env, CMS_EMAIL: t.admin.email, CMS_PASSWORD: t.admin.password, CMS_URL: '', NUXT_AUTH_SECRET: '', ...env },
      })
      let text = ''
      child.stdout.on('data', d => text += d); child.stderr.on('data', d => text += d)
      child.on('close', code => resolve({ code, text }))
    })
    // Un éditeur ne peut pas exporter le site.
    const refused = await run(['--url', B, '--out', out], { CMS_EMAIL: MARC.email, CMS_PASSWORD: MARC.password })
    check(refused.code === 1 && refused.text.includes('n\'est pas administrateur') && !fs.existsSync(out), 'éditeur : ' + refused.text)
    // Le secret du serveur de test est celui du développement : avec lui, les mots de passe (hachés) sont repris.
    const done = await run(['--url', B, '--out', out], { NUXT_AUTH_SECRET: 'secret-de-developpement-a-ne-pas-utiliser-en-production' })
    check(done.code === 0 && done.text.includes('Export terminé') && done.text.includes('1 fichier de la médiathèque téléchargé sur 1'), done.text)
    for (const file of ['sauvegarde.ndjson.gz', 'restauration.sql', 'fichiers.json', 'envoyer-fichiers.sh', 'LISEZMOI.txt', `fichiers/${ids.media}/apres-la-sauvegarde.png`])
      check(fs.existsSync(path.join(out, file)), `${file} absent de l'export`)
    const files = JSON.parse(fs.readFileSync(path.join(out, 'fichiers.json'), 'utf8'))
    check(files.length === 1 && files[0].url === `${B}/media/${ids.media}/apres-la-sauvegarde.png` && files[0].mime === 'image/png', JSON.stringify(files))
    check(fs.readFileSync(path.join(out, 'envoyer-fichiers.sh'), 'utf8').includes(`r2 object put "$BUCKET"/'${ids.media}/apres-la-sauvegarde.png'`), 'script d\'envoi des fichiers')
    const readme = fs.readFileSync(path.join(out, 'LISEZMOI.txt'), 'utf8')
    check(readme.includes('wrangler d1 execute DB --remote --file') && readme.includes('les mots de passe (hachés) sont repris'), readme)
    const sql = fs.readFileSync(path.join(out, 'restauration.sql'), 'utf8')
    check(sql.includes('Droit social') && !sql.includes(KEY) && !sql.includes(t.admin.password), 'fichier SQL')

    // Réimport dans une base neuve, avec les commandes du mode d'emploi (en local).
    const fresh = path.join(config.tmpDir, 'export-base')
    fs.rmSync(fresh, { recursive: true, force: true })
    const wrangler = (...args) => {
      const r = spawnSync(path.join(config.playgroundDir, 'node_modules/.bin/wrangler'), ['d1', ...args, '--local', '--persist-to', fresh], { cwd: config.playgroundDir, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8' })
      check(r.status === 0, `wrangler d1 ${args.join(' ').slice(0, 80)} : ${(r.stderr || r.stdout).slice(-400)}`)
      return r.stdout
    }
    wrangler('migrations', 'apply', 'DB')
    wrangler('execute', 'DB', '--file', path.join(out, 'restauration.sql'))
    const query = sqlText => JSON.parse(wrangler('execute', 'DB', '--json', '--command', sqlText))[0].results
    const counts = query('SELECT (SELECT count(*) FROM cms_entries WHERE type = \'services\') AS services, (SELECT count(*) FROM user) AS users, (SELECT count(*) FROM cms_media) AS media, (SELECT count(*) FROM cms_workflows) AS workflows, (SELECT count(*) FROM session) AS sessions')[0]
    check(JSON.stringify(counts) === JSON.stringify({ services: 2, users: 3, media: 1, workflows: 1, sessions: 0 }), 'base réimportée : ' + JSON.stringify(counts))
    const accounts = query('SELECT u.email, a.password FROM account a JOIN user u ON u.id = a.user_id ORDER BY u.email')
    check(accounts.length === 3 && accounts.every(a => /^[0-9a-f]{16,}:[0-9a-f]{32,}$/.test(a.password)), 'mots de passe réimportés : ' + JSON.stringify(accounts).slice(0, 200))
    check(query('SELECT title FROM (SELECT json_extract(draft, \'$.title\') AS title FROM cms_entry_locales) WHERE title IS NOT NULL ORDER BY title').map(r => r.title).join() === 'Droit fiscal,Droit social', 'contenus réimportés')

    // Sans le secret du site d'origine : l'export se fait, les mots de passe ne sont pas repris, et c'est dit.
    const out2 = path.join(config.tmpDir, 'export-sans-secret')
    fs.rmSync(out2, { recursive: true, force: true })
    const offline = await run(['--from', path.join(out, 'sauvegarde.ndjson.gz'), '--out', out2, '--no-files'])
    check(offline.code === 0 && offline.text.includes('3 valeurs chiffrées non reprises'), offline.text)
    check(fs.readFileSync(path.join(out2, 'LISEZMOI.txt'), 'utf8').includes('account.password : 3'), 'le mode d\'emploi ne dit pas ce qui manque')
    check(!/[0-9a-f]{32}:[0-9a-f]{64}/.test(fs.readFileSync(path.join(out2, 'restauration.sql'), 'utf8')), 'un mot de passe haché est sorti sans le secret')
    for (const dir of [out, out2, fresh]) fs.rmSync(dir, { recursive: true, force: true })
  })

  await step('une restauration se défait : revenir à la sauvegarde « Avant restauration »', async () => {
    const r = await claire.json(`/api/cms/backups/${ids.safety}/restore`, { method: 'POST', body: { confirm: 'RESTAURER' } })
    check(r.restored === ids.safety && r.rows > 5 && r.purgeFailed === false && r.missingFiles.length === 0, JSON.stringify(r).slice(0, 300))
    check((await titles()).join() === 'Créé après la sauvegarde,Droit social MODIFIÉ', 'site : ' + await titles())
    check((await claire.get('/api/cms/me')).status === 200, 'session fermée')
  })

  await step('un fichier supprimé depuis la sauvegarde : sa fiche revient, le compte rendu dit qu\'il manque', async () => {
    const made = await claire.json('/api/cms/backups', { method: 'POST' })
    check((await claire.del(`/api/cms/media/${ids.media}?force=1`)).status === 200, 'suppression du fichier refusée')
    const r = await claire.json(`/api/cms/backups/${made.name}/restore`, { method: 'POST', body: { confirm: 'RESTAURER' } })
    // Si une corbeille garde les fichiers supprimés, il ne manque rien ; sinon le compte rendu le signale.
    const stillServed = (await anon.get(`/media/${ids.media}/apres-la-sauvegarde.png`)).status === 200
    check(stillServed ? r.missingFiles.length === 0 : r.missingFiles.join() === 'apres-la-sauvegarde.png', 'fichiers manquants : ' + JSON.stringify(r.missingFiles))
  })

  await step('largeur de téléphone : tout tient dans l\'écran, les actions restent accessibles', async () => {
    const phone = await t.newPage({ width: 390, height: 844 })
    await phone.goto(B + '/admin/backups', { waitUntil: 'networkidle0' })
    await says(phone, 'Sauvegarder maintenant')
    const fit = await phone.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, buttons: [...document.querySelectorAll('main li[data-backup] .btn')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth }) }))
    check(fit.doc <= fit.win && fit.buttons, 'débordement : ' + JSON.stringify(fit))
    await t.shot(phone, 'telephone')
    const row = await phone.$('main li[data-backup] button')
    await row.evaluate(b => b.click())
    await says(phone, 'Pour confirmer, écrivez RESTAURER')
    const box = await phone.$eval('.modal-open .modal-box', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth })
    check(box, 'la fenêtre de confirmation déborde')
    await opened(phone); await t.shot(phone, 'telephone-confirmation')
    await phone.close()
  })
}
