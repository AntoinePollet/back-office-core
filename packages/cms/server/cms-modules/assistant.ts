import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { z } from 'zod'
import {
  ASSISTANT, altPrompt, applyTranslations, assistantModel, assistantSettingsErrors, cleanAlt, cleanDescription, descriptionPrompt, isAssistantImage, translatableTexts, translationPrompt,
} from '../../shared/assistant'
import type { AnyField, CmsDefinition } from '../../shared/format'
import { contentTexts } from '../../shared/site-search'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/**
 * Assistant de rédaction : texte alternatif d'une image, description d'une page, traduction d'un contenu, demandés à
 * Claude par l'API d'Anthropic (voir `shared/assistant.ts`). L'assistant propose ; rien n'est enregistré ici.
 *
 * Les appels passent par le SDK officiel (`@anthropic-ai/sdk`), qui tourne sur Workers comme sur Node. La réponse
 * est demandée dans une forme imposée (sortie structurée) : elle se lit sans rien deviner.
 */

type User = Awaited<ReturnType<typeof requireUser>>

function client(event: H3Event, settings: ModuleSettings) {
  // Adresse de l'API. Ne se change que pour les tests : NUXT_ANTHROPIC_API_URL.
  const baseURL = String(useRuntimeConfig(event).anthropicApiUrl || '') || undefined
  return new Anthropic({ apiKey: settings.apiKey ?? '', baseURL, maxRetries: 1, timeout: 90_000 })
}
const modelOf = (settings: ModuleSettings) => assistantModel(settings.model) || ASSISTANT.defaultModel

/** Refus de l'API d'Anthropic, traduit pour la personne. Les classes d'erreur sont celles du SDK. */
function refusal(error: unknown): never {
  if (error instanceof Anthropic.AuthenticationError) throw createError({ statusCode: 502, message: 'Anthropic ne reconnaît pas la clé d\'API de l\'assistant. Elle se règle dans l\'écran « Modules ».' })
  if (error instanceof Anthropic.PermissionDeniedError) throw createError({ statusCode: 502, message: 'La clé d\'API de l\'assistant n\'a pas accès à ce modèle.' })
  if (error instanceof Anthropic.NotFoundError) throw createError({ statusCode: 502, message: 'Anthropic ne connaît pas le modèle réglé pour l\'assistant.' })
  if (error instanceof Anthropic.RateLimitError) throw createError({ statusCode: 503, message: 'Anthropic limite le nombre de demandes pour ce compte : réessayez dans une minute.' })
  if (error instanceof Anthropic.BadRequestError) {
    console.error('[cms] assistant : demande refusée par Anthropic :', error.message)
    throw createError({ statusCode: 502, message: /credit balance/i.test(error.message) ? 'Le compte Anthropic n\'a plus de crédit : rechargez-le dans la console d\'Anthropic.' : 'Anthropic a refusé cette demande. Le détail est dans le journal du serveur.' })
  }
  if (error instanceof Anthropic.APIConnectionError) throw createError({ statusCode: 503, message: 'L\'assistant n\'a pas répondu à temps. Réessayez dans un instant.' })
  if (error instanceof Anthropic.APIError) throw createError({ statusCode: 503, message: 'L\'assistant est indisponible pour le moment. Réessayez dans un instant.' })
  // La réponse est arrivée, mais elle ne suit pas la forme demandée : le plus souvent, elle a été coupée parce que trop longue.
  if (error instanceof Anthropic.AnthropicError) throw createError({ statusCode: 422, message: 'La réponse de l\'assistant est incomplète, sans doute parce qu\'elle est trop longue : traduisez ce contenu en plusieurs parties, ou réessayez.' })
  throw error
}

export const assistantModule: CmsModuleDefinition = {
  id: 'assistant',
  category: 'other',
  label: 'Assistant de rédaction',
  // Icône « étincelles » de Lucide.
  logo: { style: 'stroke', color: 'currentColor', paths: ['M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z', 'M20 2v4', 'M22 4h-4', 'M4 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'] },
  description: 'Propose, à la demande, le texte alternatif d\'une image, la description d\'une page pour les moteurs de recherche et la traduction d\'un contenu. La personne relit et enregistre elle-même. Les images et les textes concernés sont envoyés à Anthropic (Claude), le temps de la demande.',
  settings: [
    {
      key: 'apiKey', label: 'Clé d\'API Anthropic', type: 'secret', required: true, placeholder: 'sk-ant-…',
      help: 'Dans la console d\'Anthropic (platform.claude.com) : « API keys » → « Create key ». L\'usage est facturé par Anthropic au compte de cette clé, selon le texte envoyé et reçu.',
      env: { key: 'anthropicApiKey', name: 'NUXT_ANTHROPIC_API_KEY' },
    },
    {
      key: 'model', label: 'Modèle', type: 'text', placeholder: ASSISTANT.defaultModel,
      help: `Facultatif. Vide : ${ASSISTANT.defaultModel}. Un modèle plus petit (« claude-sonnet-5-5 », « claude-haiku-5-5 ») coûte moins cher par demande, pour des propositions un peu moins fines.`,
    },
  ],
  validate: assistantSettingsErrors,

  async test(event, settings) {
    const invalid = Object.values(assistantSettingsErrors(settings))
    if (invalid.length) throw new Error(invalid.join(' '))
    try {
      // Lire la fiche du modèle vérifie la clé et le nom du modèle sans rien faire rédiger : aucun coût.
      const model = await client(event, settings).models.retrieve(modelOf(settings))
      return `Connexion réussie à Anthropic. Modèle : ${model.display_name || model.id}.`
    }
    catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new Error('Anthropic ne reconnaît pas cette clé d\'API.')
      if (error instanceof Anthropic.NotFoundError) throw new Error(`Anthropic ne connaît pas le modèle « ${modelOf(settings)} ».`)
      if (error instanceof Anthropic.PermissionDeniedError) throw new Error('Cette clé n\'a pas accès à ce modèle.')
      if (error instanceof Anthropic.APIError) throw new Error(`Anthropic a répondu ${error.status ?? 'une erreur'}. Réessayez dans un instant.`)
      throw new Error('Anthropic est injoignable pour le moment.')
    }
  },
}

/**
 * L'assistant est ouvert à qui peut modifier un contenu ; chaque demande est comptée par personne, pour qu'une
 * erreur de manipulation (ou un script) ne fasse pas grimper la facture.
 */
export async function requireAssistant(event: H3Event) {
  await requireModule(event, 'assistant')
  const user = await requireUser(event)
  const settings = await moduleSettings(event, 'assistant')
  if (!settings.apiKey) throw createError({ statusCode: 503, message: 'L\'assistant n\'est pas encore réglé : il lui faut une clé d\'API (écran « Modules »).' })
  const limit = { key: `assistant:${user.id}`, max: ASSISTANT.maxPerWindow }
  await assertRateLimit(event, [limit], minutes => `Vous avez beaucoup sollicité l'assistant. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`)
  await hitRateLimit(event, [limit.key], ASSISTANT.windowMs)
  return { user, settings }
}

const site = () => {
  const description = (cmsConfig.site as { description?: string | Record<string, string> }).description
  return { name: cmsConfig.site.name, description: typeof description === 'string' ? description : description?.[cmsConfig.site.defaultLocale] }
}
const localeOf = (value: unknown) => (cmsConfig.site.locales.includes(String(value)) ? String(value) : cmsConfig.site.defaultLocale)

type Content = string | Anthropic.Beta.Messages.BetaContentBlockParam[]

/**
 * Une demande à Claude, dont la réponse suit la forme donnée. `effort` : `low` pour une phrase, `medium` pour une
 * traduction. Le modèle réfléchit de lui-même autant qu'il faut (réflexion adaptative, réglée par défaut).
 *
 * Refus : si le modèle décline une demande, l'API la rejoue d'elle-même sur un autre modèle (`fallbacks`). Si
 * personne ne répond, ou si la réponse est coupée, la personne reçoit un message clair plutôt qu'un texte tronqué.
 */
async function ask<Schema extends z.ZodType>(event: H3Event, settings: ModuleSettings, input: { system: string; content: Content; schema: Schema; effort: 'low' | 'medium'; maxTokens?: number }): Promise<z.infer<Schema>> {
  const model = modelOf(settings)
  const response = await client(event, settings).beta.messages.parse({
    model,
    max_tokens: input.maxTokens ?? 16_000,
    // Claude Haiku n'a pas de modèle de repli : la consigne y serait refusée.
    ...(model.includes('haiku') ? {} : { betas: ['server-side-fallback-2026-07-01' as const], fallbacks: 'default' as const }),
    system: input.system,
    messages: [{ role: 'user', content: input.content }],
    output_config: { effort: input.effort, format: betaZodOutputFormat(input.schema) },
  }).catch(refusal)
  if (response.stop_reason === 'refusal') throw createError({ statusCode: 422, message: 'L\'assistant a décliné cette demande. Rédigez ce texte vous-même, ou reformulez le contenu.' })
  if (response.stop_reason === 'max_tokens') throw createError({ statusCode: 422, message: 'La réponse de l\'assistant est trop longue pour être rendue en une fois : traduisez ce contenu en plusieurs parties.' })
  if (response.parsed_output == null) throw createError({ statusCode: 502, message: 'L\'assistant a rendu une réponse illisible. Réessayez.' })
  return response.parsed_output
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Propose le texte alternatif d'une image de la médiathèque, dans une langue du site. */
export async function suggestAlt(event: H3Event, settings: ModuleSettings, input: { id: string; locale: unknown }) {
  const [media] = await useDb(event).select().from(schema.media).where(eq(schema.media.id, input.id))
  if (!media) throw createError({ statusCode: 404, message: 'Fichier introuvable.' })
  if (!isAssistantImage(media.mime)) throw createError({ statusCode: 422, message: 'L\'assistant ne sait décrire que les images JPEG, PNG, GIF et WebP.' })
  if (media.size > ASSISTANT.maxImageBytes) throw createError({ statusCode: 422, message: 'Cette image est trop lourde pour l\'assistant (plus de 4,5 Mo). Allégez-la, ou décrivez-la vous-même.' })
  const object = await useBucket(event).get(media.key)
  if (!object) throw createError({ statusCode: 404, message: 'Le fichier de cette image est introuvable dans le stockage.' })
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
  const locale = localeOf(input.locale)
  const prompt = altPrompt({ site: site(), locale, fileName: media.name })
  const { alt } = await ask(event, settings, {
    system: prompt.system, effort: 'low', schema: z.object({ alt: z.string() }),
    content: [{ type: 'image', source: { type: 'base64', media_type: media.mime, data: toBase64(bytes) } }, { type: 'text', text: prompt.user }],
  })
  return { alt: cleanAlt(alt), locale }
}

function editableDef(user: User, type: unknown): CmsDefinition {
  const def = typeof type === 'string' ? findDef(type) : undefined
  if (!def) throw createError({ statusCode: 404, message: 'Type de contenu inconnu.' })
  assertAccess(user, type as string, 'edit')
  return def
}
const tooLong = (chars: number) => { if (chars > ASSISTANT.maxChars) throw createError({ statusCode: 413, message: `Ce contenu est trop long pour l'assistant (${chars.toLocaleString('fr-FR')} caractères, ${ASSISTANT.maxChars.toLocaleString('fr-FR')} au plus).` }) }
const asValues = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})

/** Propose la description d'une page pour les moteurs de recherche, d'après le contenu en cours de saisie. */
export async function suggestDescription(event: H3Event, user: User, settings: ModuleSettings, input: { type: unknown; locale: unknown; values: unknown }) {
  const def = editableDef(user, input.type)
  const values = asValues(input.values)
  const titleField = def.kind === 'collection' ? def.titleField : undefined
  const texts = contentTexts(def.fields as Record<string, AnyField>, values, titleField)
  const title = String((titleField ? values[titleField] : '') ?? '') || def.label
  if (!texts.length && !(titleField && values[titleField])) throw createError({ statusCode: 422, message: 'Cette page n\'a pas encore de texte : l\'assistant n\'a rien à résumer.' })
  tooLong(texts.join('').length)
  const locale = localeOf(input.locale)
  const prompt = descriptionPrompt({ site: site(), locale, title, texts })
  const { description } = await ask(event, settings, { system: prompt.system, effort: 'low', schema: z.object({ description: z.string() }), content: prompt.user })
  return { description: cleanDescription(description), locale }
}

/**
 * Traduit les textes d'un contenu (ceux de la langue de départ, tels qu'ils sont dans le formulaire) vers une autre
 * langue du site. Renvoie le contenu d'arrivée complet : textes traduits, le reste repris tel quel.
 */
export async function translateEntry(event: H3Event, user: User, settings: ModuleSettings, input: { type: unknown; from: unknown; to: unknown; values: unknown }) {
  const def = editableDef(user, input.type)
  const { locales } = cmsConfig.site
  const from = String(input.from), to = String(input.to)
  if (!locales.includes(from) || !locales.includes(to) || from === to) throw createError({ statusCode: 422, message: 'Langues de départ et d\'arrivée attendues, parmi celles du site.' })
  const fields = def.fields as Record<string, AnyField>
  const values = asValues(input.values)
  const items = translatableTexts(fields, values)
  if (!items.length) throw createError({ statusCode: 422, message: 'Il n\'y a aucun texte à traduire dans cette langue.' })
  tooLong(items.reduce((n, item) => n + item.text.length, 0))
  const prompt = translationPrompt({ site: site(), from, to, items })
  const { items: translated } = await ask(event, settings, {
    system: prompt.system, effort: 'medium', content: prompt.user, maxTokens: 32_000,
    schema: z.object({ items: z.array(z.object({ key: z.string(), text: z.string() })) }),
  })
  const done = new Set(translated.map(t => t.key))
  return { values: applyTranslations(fields, values, translated), translated: items.filter(item => done.has(item.key)).length, total: items.length }
}
