import type { H3Event } from 'h3'
import {
  AudienceError, cloudflareAudienceRequest, cloudflareBeacon, cloudflareSettingsErrors, readCloudflareAudience,
} from '../../shared/analytics'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'
import { testAudience } from './audience'

/**
 * Mesure d'audience par Cloudflare Web Analytics (module `analytics`), sans cookie.
 * L'écran « Audience » et la balise des pages sont communs aux modules de mesure : voir ./audience.ts.
 */

/** Adresse de l'API Cloudflare. Ne se change que pour les tests (variable NUXT_CLOUDFLARE_API_URL). */
const cloudflareApi = (event: H3Event) => String(useRuntimeConfig(event).cloudflareApiUrl).replace(/\/$/, '')

const ready = (settings: ModuleSettings) =>
  ['siteToken', 'siteTag', 'accountId', 'apiToken'].every(k => !!settings[k]) && !Object.keys(cloudflareSettingsErrors(settings)).length

export const analyticsModule: CmsModuleDefinition = {
  id: 'analytics',
  category: 'audience',
  label: 'Cloudflare Web Analytics',
  description: 'Fréquentation du site (visites, pages vues, pages les plus vues, sites d\'origine) dans l\'écran « Audience », par Cloudflare Web Analytics : sans cookie, donc sans bandeau de consentement.',
  // Logo officiel de Cloudflare et sa couleur (tracé : Simple Icons).
  logo: { style: 'fill', color: '#F38020', paths: ['M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727'] },
  settings: [
    {
      key: 'siteToken', label: 'Jeton de la balise', type: 'text', required: true, placeholder: '32 lettres et chiffres',
      help: 'Tableau de bord Cloudflare → « Web Analytics » → « Ajouter un site » (ou « Gérer le site » s\'il existe déjà) : dans le code proposé, copiez la valeur qui suit "token": (sans les guillemets). La balise est ajoutée au site automatiquement.',
    },
    {
      key: 'siteTag', label: 'Identifiant du site', type: 'text', required: true, placeholder: '32 lettres et chiffres',
      help: 'Dans « Web Analytics », ouvrez les statistiques du site : l\'adresse de la page, dans le navigateur, contient « siteTag~in= » suivi de cet identifiant. Ce n\'est pas le même que le jeton de la balise.',
    },
    {
      key: 'accountId', label: 'Identifiant du compte', type: 'text', required: true, placeholder: '32 caractères',
      help: 'Page d\'accueil du tableau de bord Cloudflare : menu « ⋯ » à côté du nom du compte → « Copier l\'ID du compte » (Account ID). On le trouve aussi dans l\'adresse de la page : dash.cloudflare.com/<identifiant>/…',
    },
    {
      key: 'apiToken', label: 'Jeton d\'API (lecture des statistiques)', type: 'secret', required: true,
      help: 'Profil (en haut à droite) → « Jetons d\'API » → « Créer un jeton » → « Créer un jeton personnalisé » ; autorisation : Compte → « Account Analytics » → « Lecture » ; ressources du compte : ce compte. Ce jeton ne peut que lire des statistiques.',
    },
  ],
  adminPage: { to: '/admin/audience', label: 'Voir l\'audience' },
  affectsSite: true,
  validate: cloudflareSettingsErrors,
  test: (event, settings) => testAudience(event, analyticsModule, settings),

  audience: {
    ready,
    beacon: settings => cloudflareBeacon(settings.siteToken),
    async stats(event, settings, period) {
      const response = await fetch(`${cloudflareApi(event)}/graphql`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${settings.apiToken ?? ''}`, 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(cloudflareAudienceRequest({ accountId: settings.accountId ?? '', siteTag: settings.siteTag ?? '' }, period)),
        signal: AbortSignal.timeout(10_000),
      }).catch((error: Error) => {
        throw new AudienceError('unavailable', error.name === 'TimeoutError' ? 'Cloudflare n\'a pas répondu après 10 secondes.' : 'Cloudflare est injoignable pour le moment.')
      })
      const body = await response.json().catch(() => null)
      return readCloudflareAudience(response.status, body, period)
    },
  },
}
