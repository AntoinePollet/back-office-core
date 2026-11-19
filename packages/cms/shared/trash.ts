/**
 * Corbeille : règles sans dépendance, utilisées par le serveur (qui fait foi) et par l'interface.
 *
 * - Un contenu ou un fichier supprimé reste récupérable `TRASH_DAYS` jours, puis il est supprimé pour de bon.
 * - On ne voit et on ne restaure dans la corbeille que ce qu'on aurait le droit de supprimer : un contenu d'un type
 *   qu'on peut supprimer (et, avec « seulement ses contenus », qu'on a créé soi-même) ; un fichier si l'on peut
 *   supprimer des fichiers.
 * - Supprimer définitivement et vider la corbeille : administrateur seulement (c'est la seule action sans retour).
 */
import { type Who, canDeleteMedia, rightsOn } from './access'

/** Nombre de jours pendant lesquels un élément supprimé reste récupérable. */
export const TRASH_DAYS = 30
const DAY = 86_400_000

type When = Date | number | string
const ms = (when: When) => new Date(when).getTime()

/** Date à partir de laquelle l'élément est supprimé pour de bon. */
export const trashExpiresAt = (deletedAt: When) => new Date(ms(deletedAt) + TRASH_DAYS * DAY)
/** Vrai quand le délai de récupération est écoulé. */
export const trashExpired = (deletedAt: When, now: When = Date.now()) => ms(now) >= trashExpiresAt(deletedAt).getTime()
/** Jours restants avant la suppression définitive, arrondis au jour supérieur (0 : délai écoulé). */
export const trashDaysLeft = (deletedAt: When, now: When = Date.now()) =>
  Math.max(0, Math.ceil((trashExpiresAt(deletedAt).getTime() - ms(now)) / DAY))

/** « encore 12 jours », « dernier jour ». */
export const trashDaysLabel = (days: number) => (days <= 1 ? 'dernier jour' : `encore ${days} jours`)

export type TrashItemRef = { kind: 'entry' | 'media'; type?: string | null; ownerId?: string | null }
type Definition = Parameters<typeof rightsOn>[2]

/**
 * Peut-on voir et restaurer cet élément de la corbeille ? `def` : la définition du type de contenu, absente s'il a été
 * retiré de la configuration (seul l'administrateur voit alors l'élément).
 */
export function canSeeTrashItem(who: Who, item: TrashItemRef, def?: Definition | null): boolean {
  if (who.role === 'admin') return true
  if (item.kind === 'media') return canDeleteMedia(who)
  if (!def || !item.type) return false
  const rights = rightsOn(who, item.type, def)
  if (!rights.delete) return false
  return !rights.own || (!!who.id && item.ownerId === who.id)
}
export const canRestoreTrashItem = canSeeTrashItem

/** Supprimer définitivement un élément, ou vider la corbeille. */
export const canPurgeTrash = (who: Who) => who.role === 'admin'

/**
 * Une restauration remet-elle le contenu en ligne comme il l'était ? Oui pour qui peut publier ce type de contenu.
 * Sinon le contenu revient en brouillon : remettre une page sur le site demande le droit de publier.
 */
export const restoresPublished = (who: Who, type: string, def?: Definition | null) => who.role === 'admin' || (!!def && rightsOn(who, type, def).publish)

/** La corbeille a-t-elle quelque chose à montrer à cette personne (entrée du menu) ? */
export const canOpenTrash = (user: { role?: string; deleteMedia?: boolean; access?: Record<string, { delete: boolean }> } | null | undefined) =>
  !!user && (user.role === 'admin' || user.deleteMedia === true || Object.values(user.access ?? {}).some(r => r.delete))

/** Première adresse libre : « droit-social », sinon « droit-social-2 », « droit-social-3 »… */
export function freeSlug(wanted: string, taken: (slug: string) => boolean): string {
  if (!taken(wanted)) return wanted
  for (let n = 2; ; n++) if (!taken(`${wanted}-${n}`)) return `${wanted}-${n}`
}
