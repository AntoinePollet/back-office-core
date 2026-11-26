import type { H3Event } from 'h3'
import { type AudiencePeriod, type AudienceStats, AudienceError } from '../../shared/analytics'
import type { CmsModuleDefinition, ModuleSettings } from '../utils/modules'

/**
 * Mesure d'audience : ce qui est commun aux modules qui la font (Cloudflare Web Analytics, Plausible, Google Analytics).
 * Chaque module apporte sa balise et sa lecture des statistiques (`audience` dans sa définition). Plusieurs peuvent être
 * actifs : chacun ajoute sa balise aux pages, et l'écran « Audience » lit le premier qui est réglé, ou celui qu'on y choisit.
 */

/** Modules de mesure actifs sur ce site. */
export async function audienceModules(event: H3Event) {
  return (await activeModules(event)).filter(m => m.audience)
}

/** Balises à ajouter aux pages du site : une par module de mesure actif et réglé. */
export async function audienceBeacons(event: H3Event) {
  const tags: string[] = []
  for (const definition of await audienceModules(event)) {
    const tag = definition.audience!.beacon(await moduleSettings(event, definition.id))
    if (tag) tags.push(tag)
  }
  return tags
}

/**
 * Le module dont l'écran « Audience » lit les statistiques : celui demandé s'il est réglé, sinon le premier actif et
 * réglé, sinon le premier actif. `sources` : tous ceux qui sont réglés, pour passer de l'un à l'autre.
 */
async function readerModule(event: H3Event, wanted?: string) {
  const all: { definition: CmsModuleDefinition; settings: ModuleSettings; ready: boolean }[] = []
  for (const definition of await audienceModules(event)) {
    const settings = await moduleSettings(event, definition.id)
    all.push({ definition, settings, ready: definition.audience!.ready(settings) })
  }
  const ready = all.filter(m => m.ready)
  const reader = ready.find(m => m.definition.id === wanted) ?? ready[0] ?? all[0]
  return reader ? { ...reader, sources: ready.map(m => ({ id: m.definition.id, label: m.definition.label })) } : null
}

// ───────────── Statistiques, gardées quelques minutes ─────────────

/**
 * Les statistiques ne changent pas à la seconde : elles sont gardées cinq minutes en mémoire, pour ne pas appeler
 * l'API à chaque affichage. La mémoire d'un Worker est propre à chaque instance et peut être vidée à tout moment :
 * c'est une économie, pas une garantie. La clé contient le module et ses réglages : un jeton changé repart de zéro.
 */
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; stats: AudienceStats }>()

async function cacheKey(id: string, settings: ModuleSettings, period: AudiencePeriod) {
  const raw = JSON.stringify([id, settings, period, new Date().toISOString().slice(0, 10)])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Un fournisseur réglé, proposé dans l'écran quand il y en a plusieurs. */
export type AudienceSource = { id: string; label: string }

/**
 * `source` : nom du module qui fournit les chiffres ; `module` : son identifiant, pour ouvrir ses réglages ;
 * `cookies` : il ne compte que les visiteurs qui ont donné leur accord ; `sources` : les fournisseurs réglés.
 */
export type AudienceAnswer =
  | { state: 'ok'; stats: AudienceStats; updatedAt: string; source: string; module: string; cookies: boolean; sources: AudienceSource[] }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string; source?: string; module?: string; sources?: AudienceSource[] }

/** Ce que l'écran « Audience » affiche : les statistiques, ou pourquoi elles manquent. */
export async function readAudience(event: H3Event, period: AudiencePeriod, wanted?: string): Promise<AudienceAnswer> {
  const reader = await readerModule(event, wanted)
  if (!reader?.ready) return { state: 'unconfigured', message: 'La mesure d\'audience n\'est pas encore réglée.', source: reader?.definition.label, module: reader?.definition.id }
  const { definition, settings, sources } = reader
  const cookies = definition.audience!.cookies === true
  const source = definition.label
  const module = definition.id
  const key = await cacheKey(definition.id, settings, period)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return { state: 'ok', stats: hit.stats, updatedAt: new Date(hit.at).toISOString(), source, module, cookies, sources }
  try {
    const stats = await definition.audience!.stats(event, settings, period)
    for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k)
    const at = Date.now()
    cache.set(key, { at, stats })
    return { state: 'ok', stats, updatedAt: new Date(at).toISOString(), source, module, cookies, sources }
  }
  catch (error) {
    if (error instanceof AudienceError) return { state: error.kind, message: error.message, source, module, sources }
    console.error('[cms] audience : lecture impossible', error)
    return { state: 'unavailable', message: 'Les statistiques n\'ont pas pu être lues pour le moment.', source, module, sources }
  }
}

/** « Vérifier la connexion » d'un module de mesure : réglages valides, puis lecture des 7 derniers jours. */
export async function testAudience(event: H3Event, definition: CmsModuleDefinition, settings: ModuleSettings) {
  const invalid = Object.values(definition.validate?.(settings) ?? {})
  if (invalid.length) throw new Error(invalid.join(' '))
  const stats = await definition.audience!.stats(event, settings, 7)
  cache.clear()
  if (!stats.totals.pageViews) return 'Connexion réussie. Aucune visite n\'est encore enregistrée : les premières apparaîtront quelques minutes après les premiers passages sur le site.'
  return `Connexion réussie : ${stats.totals.pageViews} page${stats.totals.pageViews > 1 ? 's' : ''} vue${stats.totals.pageViews > 1 ? 's' : ''} ces 7 derniers jours.`
}

/** L'écran « Audience » est ouvert aux administrateurs et aux éditeurs. */
export const canReadAudience = (user: { role: string }) => user.role === 'admin' || user.role === 'editor'
