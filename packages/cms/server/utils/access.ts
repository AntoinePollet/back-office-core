import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { type CmsAction, type Who, CMS_ACTIONS, userCan } from '../../shared/access'
import type { AnyField, CmsDefinition } from '../../shared/format'

const REFUSAL: Record<CmsAction, (label: string) => string> = {
  edit: label => `Vous n'avez pas accès à « ${label} ».`,
  publish: label => `Vous pouvez préparer « ${label} » en brouillon, mais pas le publier, le retirer du site ni changer son adresse. Demandez à un éditeur.`,
  delete: label => `Vous ne pouvez pas supprimer dans « ${label} ». Demandez à un éditeur.`,
}

export const can = (who: Who, type: string, action: CmsAction) => userCan(who, type, getDef(type), action)

/** Répond 403 si la personne n'a pas ce droit sur ce type de contenu. */
export function assertAccess(who: Who, type: string, action: CmsAction) {
  const def = getDef(type)
  if (!userCan(who, type, def, action)) throw createError({ statusCode: 403, message: REFUSAL[action](def.label) })
}

const allDefinitions = () => [...Object.entries(cmsConfig.collections ?? {}), ...Object.entries(cmsConfig.singletons ?? {})] as [string, CmsDefinition][]

/** Droits de la personne sur chaque type de contenu, pour que l'interface masque ce qui lui est interdit. */
export function accessMap(who: Who) {
  return Object.fromEntries(allDefinitions().map(([type, def]) => [type, Object.fromEntries(CMS_ACTIONS.map(a => [a, userCan(who, type, def, a)])) as Record<CmsAction, boolean>]))
}

/**
 * Peut-on proposer à cette personne les titres d'une collection dans un champ relation ou lien ?
 * Oui si elle peut la modifier, si elle a une page publique (cible d'un lien), ou si un contenu qu'elle modifie y fait référence.
 * Elle n'en reçoit alors que les titres, jamais le contenu.
 */
export function canListTitles(who: Who, type: string) {
  const def = getDef(type)
  if (userCan(who, type, def, 'edit') || def.path) return true
  const pointsTo = (fields: Record<string, AnyField>): boolean => Object.values(fields).some(f =>
    (f.type === 'relation' && f.to === type) || (f.type === 'repeater' && pointsTo(f.fields as Record<string, AnyField>)))
  return allDefinitions().some(([other, d]) => userCan(who, other, d, 'edit') && pointsTo(d.fields as Record<string, AnyField>))
}

/** Types de contenu auxquels un compte est limité (null : aucune limite). Lu une fois par requête. */
export async function loadUserTypes(event: H3Event, userId: string): Promise<string[] | null> {
  const [row] = await useDb(event).select().from(schema.userAccess).where(eq(schema.userAccess.userId, userId))
  return row?.types ?? null
}
