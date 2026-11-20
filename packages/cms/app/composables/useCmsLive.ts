import type { MaybeRefOrGetter } from 'vue'
import { type LiveDraft, applyLiveDrafts } from '../../shared/live-preview'

/**
 * Aperçu en direct, côté page du site (voir `shared/live-preview.ts`).
 * Contenus en cours de saisie reçus du formulaire par cette fenêtre : elle est alors le cadre affiché à côté du formulaire.
 * La liste n'est remplie que dans le navigateur (par `plugins/cms-live-preview.client.ts`), jamais sur le serveur.
 */
const drafts = new Map<string, LiveDraft>()

/** Retient un contenu en cours de saisie ; le plus récent remplace le précédent. */
export function cmsLiveStore(draft: LiveDraft) {
  if (import.meta.client) drafts.set(`${draft.type}:${draft.id}:${draft.locale}`, draft)
}

/** Remplace, dans la réponse d'une lecture du site, les contenus en cours de saisie. Sans effet hors du cadre d'aperçu. */
export const cmsLiveApply = <T>(key: string, data: T): T => (drafts.size ? applyLiveDrafts(key, data, drafts.values()) : data)

/**
 * Option ajoutée aux lectures du site en aperçu : une réponse relue plus tard (navigation dans le cadre, changement de
 * page d'une liste) reçoit elle aussi les contenus en cours de saisie. Rien hors aperçu, rien sur le serveur.
 */
export function cmsLiveRead(key: MaybeRefOrGetter<string>): { transform?: (data: any) => any } {
  if (import.meta.server || !('preview' in useRoute().query)) return {}
  return { transform: data => cmsLiveApply(toValue(key), data) }
}
