import type { H3Event } from 'h3'
import { AudienceError } from '../../shared/analytics'
import {
  GA_SCOPE, gaCanMeasure, gaFailure, gaPropertyId, gaReady, gaReportsBody, gaSettingsErrors, gaTag, readGaAudience,
} from '../../shared/google-analytics'
import type { CmsModuleDefinition } from '../utils/modules'
import { testAudience } from './audience'
import { AdsError, accessToken, forgetAccessTokens } from './google-ads'

/**
 * Mesure d'audience par Google Analytics 4 (voir `shared/google-analytics.ts`).
 *
 * Google Analytics dépose des cookies : le script de Google n'est chargé qu'après l'accord du visiteur, demandé par
 * le module Consentement (finalité « Mesure d'audience »). Sans ce module, rien n'est mesuré.
 * La lecture des chiffres passe par la connexion Google de Google Ads et de Search Console : un client OAuth et un
 * jeton d'actualisation. L'écran « Audience » et la balise des pages sont communs aux modules de mesure.
 */

/** Adresse de l'API de données. Ne se change que pour les tests : NUXT_GOOGLE_ANALYTICS_API_URL. */
const apiUrl = (event: H3Event) => String(useRuntimeConfig(event).googleAnalyticsApiUrl).replace(/\/$/, '')

/** Google Analytics mesure-t-il sur ce site ? Module actif et identifiant de mesure valide. */
export async function googleAnalyticsMeasures(event: H3Event) {
  return !!(await activeModule(event, 'google-analytics')) && gaCanMeasure(await moduleSettings(event, 'google-analytics'))
}

export const googleAnalyticsModule: CmsModuleDefinition = {
  id: 'google-analytics',
  category: 'audience',
  label: 'Google Analytics',
  // Logo officiel de Google Analytics et sa couleur (tracé : Simple Icons).
  logo: { style: 'fill', color: '#E37400', paths: ['M22.84 2.9982v17.9987c.0086 1.6473-1.3197 2.9897-2.967 2.9984a2.9808 2.9808 0 01-.3677-.0208c-1.528-.226-2.6477-1.5558-2.6105-3.1V3.1204c-.0369-1.5458 1.0856-2.8762 2.6157-3.1 1.6361-.1915 3.1178.9796 3.3093 2.6158.014.1201.0208.241.0202.3619zM4.1326 18.0548c-1.6417 0-2.9726 1.331-2.9726 2.9726C1.16 22.6691 2.4909 24 4.1326 24s2.9726-1.3309 2.9726-2.9726-1.331-2.9726-2.9726-2.9726zm7.8728-9.0098c-.0171 0-.0343 0-.0514.0014-1.6495.0904-2.9293 1.474-2.891 3.1256v7.9846c0 2.167.9535 3.4825 2.3505 3.763 1.6118.3266 3.1832-.7152 3.5098-2.327.04-.1974.06-.3983.0593-.5998v-8.9585c.003-1.6474-1.33-2.9852-2.9773-2.9882z'] },
  description: 'Fréquentation du site par Google Analytics 4 : visites, pages vues, pages les plus vues et sources dans l\'écran « Audience ». Google Analytics dépose des cookies : il ne mesure que les visiteurs qui l\'acceptent dans le bandeau du module Consentement, à activer aussi.',
  settings: [
    {
      key: 'measurementId', label: 'Identifiant de mesure', type: 'text', required: true, placeholder: 'G-AB12CD34EF',
      help: 'Google Analytics → Administration → « Flux de données » → le flux web du site : « ID de mesure ». Le script de Google est ajouté au site automatiquement, après l\'accord du visiteur.',
    },
    {
      key: 'propertyId', label: 'Identifiant de la propriété', type: 'text', required: true, placeholder: '123456789',
      help: 'Google Analytics → Administration → « Détails de la propriété » : « ID de la propriété », en haut à droite. Des chiffres seulement.',
    },
    {
      key: 'clientId', label: 'Identifiant client OAuth', type: 'text', required: true, placeholder: '….apps.googleusercontent.com',
      help: 'Console Google Cloud : activer « Google Analytics Data API » dans un projet, puis « Identifiants » → « Créer des identifiants » → « ID client OAuth ». Le client des modules Google Ads et Search Console convient.',
      env: { key: 'googleAdsClientId', name: 'NUXT_GOOGLE_ADS_CLIENT_ID' },
    },
    {
      key: 'clientSecret', label: 'Secret du client OAuth', type: 'secret', required: true,
      help: 'Affiché à la création de l\'ID client OAuth, puis dans sa fiche.',
      env: { key: 'googleAdsClientSecret', name: 'NUXT_GOOGLE_ADS_CLIENT_SECRET' },
    },
    {
      key: 'refreshToken', label: 'Jeton d\'actualisation', type: 'secret', required: true,
      help: `Obtenu une fois, en se connectant avec un compte Google qui a accès à la propriété, pour l'autorisation « ${GA_SCOPE} » (voir le README du site). Un accès « Lecteur » suffit.`,
      env: { key: 'googleAnalyticsRefreshToken', name: 'NUXT_GOOGLE_ANALYTICS_REFRESH_TOKEN' },
    },
  ],
  adminPage: { to: '/admin/audience', label: 'Voir l\'audience' },
  affectsSite: true,
  validate: gaSettingsErrors,

  async test(event, settings) {
    forgetAccessTokens()
    const message = await testAudience(event, googleAnalyticsModule, settings)
    if (!(await activeModule(event, 'consent'))) return `${message} Attention : le module Consentement n'est pas actif. Sans lui, l'accord des visiteurs n'est pas demandé et Google Analytics ne mesure rien.`
    return message
  },

  audience: {
    cookies: true,
    ready: gaReady,
    beacon: settings => gaTag(settings.measurementId),
    stats: async (event, settings, period) => {
      for (let attempt = 0; ; attempt++) {
        // Le jeton d'accès vient du service de connexion de Google : ses refus sont ceux de Google Ads, déjà traduits.
        const token = await accessToken(event, settings).catch((error) => {
          throw error instanceof AdsError ? new AudienceError(error.failure.kind === 'unavailable' ? 'unavailable' : 'refused', error.failure.message) : error
        })
        const response = await fetch(`${apiUrl(event)}/properties/${gaPropertyId(settings.propertyId)}:batchRunReports`, {
          method: 'POST',
          headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify(gaReportsBody(period)),
          signal: AbortSignal.timeout(15_000),
        }).catch((error: Error) => {
          throw new AudienceError('unavailable', error.name === 'TimeoutError' ? 'Google Analytics n\'a pas répondu après 15 secondes.' : 'Google Analytics est injoignable pour le moment.')
        })
        const body = await response.json().catch(() => null)
        // Un jeton d'accès refusé est redemandé une fois.
        if (response.status === 401 && attempt === 0) { forgetAccessTokens(); continue }
        if (!response.ok) throw gaFailure(response.status, body)
        return readGaAudience(response.status, body, period)
      }
    },
  },
}
