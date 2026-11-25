// Écran de chargement du back-office, et bouton bloqué pendant que son action s'exécute.
import { check, clickText, login, says, until } from '../lib/harness.mjs'

export const meta = { title: 'chargement : écran de démarrage, bouton bloqué pendant son action' }

/** Retient les écritures vers `path` et les fait attendre, pour avoir le temps de cliquer une seconde fois. */
async function slowDown(page, path, ms = 700) {
  const seen = []
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (request.method() === 'GET' || !request.url().includes(path)) return request.continue()
    seen.push(request.url())
    setTimeout(() => request.continue(), ms)
  })
  return seen
}
const busy = (page, sel) => page.$eval(sel, el => el.hasAttribute('data-cms-busy'))

export default async function (t) {
  const { B, step } = t
  const page = await t.newPage()

  await step('la réponse du serveur contient l\'écran de chargement, que le back-office retire une fois prêt', async () => {
    const r = await t.http().get('/admin/login')
    check(r.status === 200 && r.text.includes('class="cms-boot"') && r.text.includes('Chargement du back-office'), 'écran de chargement absent de la réponse')
    // Le site public, rendu sur le serveur, n'en a pas.
    const home = await t.http().get('/')
    check(!home.text.includes('cms-boot'), 'écran de chargement présent sur le site public')
    await page.goto(B + '/admin/login', { waitUntil: 'networkidle0' })
    await page.waitForSelector('form button')
    await until(() => page.evaluate(() => !document.querySelector('.cms-boot')), 'écran de chargement toujours affiché')
  })

  await step('connexion : cliquer deux fois n\'envoie qu\'une demande, le bouton est bloqué entre-temps', async () => {
    const seen = await slowDown(page, '/api/auth/sign-in/email')
    await page.type('form input[type=email]', t.admin.email)
    await page.type('form input[type=password]', t.admin.password)
    await clickText(page, 'form button', 'Se connecter')
    check(await busy(page, 'form button.btn-primary'), 'bouton non bloqué pendant la connexion')
    check(await page.$eval('form button.btn-primary', el => getComputedStyle(el, '::before').animationName === 'cms-busy-spin' && getComputedStyle(el).pointerEvents === 'none'), 'indicateur absent du bouton')
    await clickText(page, 'form button', 'Se connecter')
    // Touche Entrée dans un champ : même refus.
    await page.$eval('form', form => form.requestSubmit())
    await page.waitForSelector('aside .menu')
    check(seen.length === 1, `${seen.length} demandes de connexion envoyées`)
    await t.shot(page, 'connexion')
  })

  await step('changement de mot de passe : une seule demande, puis le bouton redevient utilisable', async () => {
    const other = await t.newPage()
    await login(other, B)
    await other.goto(B + '/admin/account', { waitUntil: 'networkidle0' })
    const seen = await slowDown(other, '/api/auth/change-password')
    const button = 'form button.btn-primary'
    const fill = async () => {
      const inputs = await other.$$('form input[type=password]')
      for (const [i, value] of ['un-mauvais-mot-de-passe', 'nouveau-mot-de-passe-1', 'nouveau-mot-de-passe-1'].entries()) {
        await inputs[i].evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input')) })
        await inputs[i].type(value)
      }
    }
    await fill()
    await clickText(other, 'form button', 'Modifier le mot de passe')
    check(await busy(other, button), 'bouton non bloqué')
    await clickText(other, 'form button', 'Modifier le mot de passe')
    await clickText(other, 'form button', 'Modifier le mot de passe')
    await says(other, 'Mot de passe actuel incorrect')
    check(seen.length === 1, `${seen.length} demandes envoyées`)
    await until(async () => !(await busy(other, button)), 'bouton resté bloqué après la réponse')
    // Un nouvel essai part normalement.
    await clickText(other, 'form button', 'Modifier le mot de passe')
    await until(() => seen.length === 2, 'le second essai n\'est pas parti')
    await until(async () => !(await busy(other, button)), 'bouton resté bloqué après le second essai')
    await other.close()
  })

  await step('un bouton sans requête, un lien du menu : jamais bloqués', async () => {
    await page.goto(B + '/admin/users', { waitUntil: 'networkidle0' })
    await clickText(page, 'button', 'Inviter')
    await page.waitForSelector('.modal-open')
    check(await page.evaluate(() => !document.querySelector('[data-cms-busy]')), 'un élément est bloqué sans action en cours')
    // Onglet « Référencement » d'un contenu : l'écran qu'il ouvre prépare un aperçu (une écriture), l'onglet reste libre.
    const claire = t.http()
    await claire.signIn(t.admin.email, t.admin.password)
    const { id } = await claire.json('/api/cms/entries/services', { method: 'POST', body: { values: { title: 'Droit immobilier', onQuote: true }, publish: ['fr'] } })
    await page.goto(B + '/admin/services/' + id, { waitUntil: 'networkidle0' })
    const sent = page.waitForRequest(r => r.url().includes('/live-preview'))
    await clickText(page, '[role=tab]', 'Référencement')
    check(await page.evaluate(() => !document.querySelector('[data-cms-busy]')), 'un onglet est bloqué par ce que charge son écran')
    await sent
    check(await page.evaluate(() => !document.querySelector('[data-cms-busy]')), 'la préparation de l\'aperçu bloque un élément')
  })
}
