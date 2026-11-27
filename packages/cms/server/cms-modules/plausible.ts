import type { H3Event } from 'h3'
import {
  AudienceError, PLAUSIBLE_DEFAULT_HOST, plausibleAudienceRequests, plausibleBeacon, plausibleHost, plausibleSettingsErrors,
  readPlausibleAudience,
} from '../../shared/analytics'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'
import { testAudience } from './audience'

/**
 * Mesure d'audience par Plausible (https://plausible.io, ou une instance hébergée par le client), sans cookie.
 * L'écran « Audience » et la balise des pages sont communs aux modules de mesure : voir ./audience.ts.
 */

/**
 * Adresse de l'API : l'instance saisie, sinon Plausible. NUXT_PLAUSIBLE_API_URL ne sert qu'aux tests : elle remplace
 * l'adresse de l'API, pas celle du script ajouté aux pages.
 */
function apiBase(event: H3Event, settings: ModuleSettings) {
  const forced = String(useRuntimeConfig(event).plausibleApiUrl ?? '')
  return (forced || plausibleHost(settings.host)).replace(/\/$/, '')
}

const ready = (settings: ModuleSettings) =>
  !!settings.domain && !!settings.apiKey && !Object.keys(plausibleSettingsErrors(settings)).length

export const plausibleModule: CmsModuleDefinition = {
  id: 'plausible',
  category: 'audience',
  label: 'Plausible',
  // Logo officiel de Plausible et sa couleur (tracé : Simple Icons).
  logo: { style: 'fill', color: '#5850EC', paths: ['M12.1835.0017c-.6378-.0097-1.2884.022-1.7246.0996C8.601.424 7.035 1.2116 5.7384 2.4782 4.406 3.7806 3.582 5.299 3.1818 7.1929l-.1387.6445c-.0118 5.3872-.0233 10.7744-.035 16.1617.2914.0081.591-.0392.8416-.0606 2.348-.2868 4.3442-1.7083 5.4315-3.8651.2749-.5497.472-1.182.6094-1.9707.1135-.6691.1195-.8915.1016-4.3807l-.0176-3.6737.1425-.3574c.1972-.49.7425-1.0352 1.2324-1.2324l.3574-.1426 3.3457-.0058c1.8401 0 3.4545-.025 3.58-.0489.5854-.1135 1.2118-.6027 1.4628-1.1464.0717-.1494.1671-.4415.209-.6387.0657-.3286.0604-.4186-.0352-.789-.2987-1.0993-1.3503-2.6234-2.4257-3.5136C16.6247 1.1638 15.2798.4887 13.828.1482c-.3824-.0866-1.0067-.1368-1.6445-.1465zm8.5369 6.8006c-.0506.1798-.098.3662-.172.5215-.3358.7278-1.0382 1.2776-1.8221 1.4296-3.6737.0566-2.5392.0561-3.6737.0566l-3.248.0059-.2695.1074c-.3135.1262-.827.6397-.9531.9531l-.1074.2676.0175 3.576c.0149 2.8888.007 3.5821-.0605 4.125a8.9918 8.9918 0 0 0 1.5683.1386c4.9662.0001 8.992-4.0258 8.992-8.992a8.9918 8.9918 0 0 0-.2715-2.1893Z'] },
  description: 'Fréquentation du site (visites, pages vues, pages les plus vues, sources) dans l\'écran « Audience », par Plausible : sans cookie, donc sans bandeau de consentement. Plausible hébergé par l\'éditeur, ou votre propre instance.',
  settings: [
    {
      key: 'domain', label: 'Domaine du site', type: 'text', required: true, placeholder: 'cabinet-durand.fr',
      help: 'Le nom du site tel qu\'il est enregistré dans Plausible (« Add a website »), sans https:// ni /. La balise est ajoutée au site automatiquement.',
    },
    {
      key: 'apiKey', label: 'Clé d\'API (lecture des statistiques)', type: 'secret', required: true,
      help: 'Dans Plausible : votre compte (en haut à droite) → « Settings » → « API Keys » → « New API Key », type « Stats API ». Cette clé ne peut que lire des statistiques.',
    },
    {
      key: 'host', label: 'Adresse de Plausible', type: 'text', placeholder: PLAUSIBLE_DEFAULT_HOST,
      help: 'À remplir seulement si vous hébergez votre propre Plausible (Community Edition) : son adresse, par exemple https://stats.mon-domaine.fr. Vide : plausible.io. Changer cette adresse demande de saisir à nouveau la clé d\'API.',
      // La clé d'API est envoyée à cette adresse.
      protects: ['apiKey'],
    },
  ],
  adminPage: { to: '/admin/audience', label: 'Voir l\'audience' },
  affectsSite: true,
  validate: plausibleSettingsErrors,
  test: (event, settings) => testAudience(event, plausibleModule, settings),

  audience: {
    ready,
    beacon: settings => plausibleBeacon(settings),
    async stats(event, settings, period) {
      const requests = plausibleAudienceRequests(settings.domain ?? '', period)
      const ask = async (body: unknown) => {
        const response = await fetch(`${apiBase(event, settings)}/api/v2/query`, {
          method: 'POST',
          headers: { 'authorization': `Bearer ${settings.apiKey ?? ''}`, 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        }).catch((error: Error) => {
          throw new AudienceError('unavailable', error.name === 'TimeoutError' ? 'Plausible n\'a pas répondu après 10 secondes.' : 'Plausible est injoignable pour le moment.')
        })
        return { status: response.status, body: await response.json().catch(() => null) }
      }
      const [total, days, pages, referrers] = await Promise.all([ask(requests.total), ask(requests.days), ask(requests.pages), ask(requests.referrers)])
      return readPlausibleAudience({ total, days, pages, referrers }, period)
    },
  },
}
