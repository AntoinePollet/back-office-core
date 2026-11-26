import type { H3Event } from 'h3'
import { type ConsentConfig, type ConsentPurposeOptions, consentPurposes, isPolicyUrl } from '../../shared/consent'
import type { CmsModuleDefinition } from '../utils/modules'
import { googleAnalyticsMeasures } from './google-analytics'

/**
 * Consentement des visiteurs : le bandeau des pages du site (voir `shared/consent.ts`). Le serveur n'enregistre aucun
 * choix : il reste sur l'appareil du visiteur. Il envoie seulement aux pages ce qu'il faut pour afficher le bandeau.
 */
export const consentModule: CmsModuleDefinition = {
  id: 'consent',
  category: 'privacy',
  label: 'Consentement',
  // Icône « cookie » de Lucide.
  logo: { style: 'stroke', color: 'currentColor', paths: ['M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5', 'M8.5 8.5v.01', 'M16 15.5v.01', 'M12 12v.01', 'M11 17v.01', 'M7 14v.01'] },
  description: 'Bandeau de consentement sur les pages du site : le visiteur accepte, refuse ou choisit, et peut changer d\'avis à tout moment. Nécessaire pour garder la provenance d\'un visiteur d\'une visite à l\'autre ou la transmettre à une régie publicitaire. Nécessaire aussi à Google Analytics, qui dépose des cookies. Inutile pour la mesure d\'audience sans cookie (Cloudflare, Plausible).',
  settings: [
    {
      key: 'policyUrl', label: 'Page « politique de confidentialité »', type: 'text', placeholder: '/confidentialite',
      help: 'L\'adresse de la page du site qui explique l\'usage des données (ou une adresse complète). Le bandeau y renvoie. Laissée vide, le bandeau n\'affiche pas de lien.',
    },
  ],
  affectsSite: true,
  validate(values) {
    const errors: Record<string, string> = {}
    if (values.policyUrl && !isPolicyUrl(values.policyUrl.trim())) errors.policyUrl = 'Attendu une page du site (/confidentialite) ou une adresse complète (https://…).'
    return errors
  },
}

/** Ce que les pages reçoivent pour afficher le bandeau ; null si le module est inactif ou s'il n'y a rien à demander. */
export async function consentConfig(event: H3Event): Promise<ConsentConfig | null> {
  if (!(await activeModule(event, 'consent'))) return null
  const custom = moduleOptions<{ purposes?: ConsentPurposeOptions } | undefined>('consent')?.purposes
  // La finalité « publicité » n'a de sens que si le site relève la provenance des contacts.
  const purposes = consentPurposes(custom, (cmsConfig.site as { attribution?: unknown }).attribution !== false, await googleAnalyticsMeasures(event))
  if (!purposes.length) return null
  const settings = await moduleSettings(event, 'consent')
  const policyUrl = settings.policyUrl?.trim()
  return { purposes, policyUrl: policyUrl && isPolicyUrl(policyUrl) ? policyUrl : null, locales: [...cmsConfig.site.locales], defaultLocale: cmsConfig.site.defaultLocale }
}
