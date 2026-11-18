/**
 * Droits d'accès aux contenus : qui peut modifier, publier ou supprimer quoi.
 * Fonctions sans dépendance, utilisées par le serveur (qui fait foi) et par l'interface (qui masque ce qui est interdit).
 *
 * Trois sources se combinent :
 * - le rôle : trois rôles intégrés (administrateur, éditeur, rédacteur), ou un rôle personnalisé créé dans le back-office ;
 * - pour les rôles intégrés, l'option `access` de chaque contenu dans cms.config.ts ;
 * - les contenus attribués à la personne, qui restreignent encore.
 */

/** Les trois rôles intégrés, du plus au moins étendu. Un rôle personnalisé est désigné par son identifiant. */
export type CmsRole = 'admin' | 'editor' | 'writer'
export const CMS_ROLES: CmsRole[] = ['admin', 'editor', 'writer']
export const isBuiltinRole = (role: unknown): role is CmsRole => CMS_ROLES.includes(role as CmsRole)

export const ROLE_LABELS: Record<CmsRole, string> = { admin: 'Administrateur', editor: 'Éditeur', writer: 'Rédacteur' }
export const ROLE_HELP: Record<CmsRole, string> = {
  admin: 'Tout : contenus, utilisateurs, apparence, workflows, structure.',
  editor: 'Modifie, publie et supprime les contenus ; gère la médiathèque.',
  writer: 'Prépare des brouillons. Ne publie pas, ne retire rien du site et ne supprime pas.',
}
export const roleLabel = (role?: string | null) => ROLE_LABELS[role as CmsRole] ?? 'Rôle personnalisé'

/** `edit` : voir et modifier le brouillon. `publish` : mettre en ligne, retirer du site, changer l'ordre. `delete` : supprimer. */
export type CmsAction = 'edit' | 'publish' | 'delete'
export const CMS_ACTIONS: CmsAction[] = ['edit', 'publish', 'delete']

/** Rôles intégrés auxquels on peut accorder un droit dans le fichier de collections. L'administrateur a toujours tous les droits. */
export type GrantableRole = Exclude<CmsRole, 'admin'>
export type AccessRules = Partial<Record<CmsAction, readonly GrantableRole[]>> & {
  /** Rôles qui ne voient et ne modifient que les contenus qu'ils ont créés eux-mêmes. Collections seulement. */
  own?: readonly GrantableRole[]
}

/** Sans réglage `access` : éditeurs et rédacteurs modifient, seuls les éditeurs publient et suppriment. */
export const DEFAULT_ACCESS: Record<CmsAction, readonly GrantableRole[]> = {
  edit: ['editor', 'writer'],
  publish: ['editor'],
  delete: ['editor'],
}

/** Droits d'une personne sur un type de contenu. `own` : limités aux contenus qu'elle a créés. */
export type Rights = { edit: boolean; publish: boolean; delete: boolean; own: boolean }
const NONE: Rights = { edit: false, publish: false, delete: false, own: false }
const ALL: Rights = { edit: true, publish: true, delete: true, own: false }

/** Ce qu'un rôle personnalisé autorise : une ligne par type de contenu, plus deux droits généraux. */
export type CustomRights = {
  types: Record<string, Partial<Rights>>
  /** Modifier les champs marqués `restricted` dans cms.config.ts. */
  restrictedFields?: boolean
  /** Supprimer des fichiers de la médiathèque. */
  deleteMedia?: boolean
}

export type Who = {
  id?: string
  /** Rôle intégré, ou identifiant d'un rôle personnalisé. */
  role: string
  /** Types de contenu auxquels la personne est limitée ; null ou absent : aucune limite au-delà de son rôle. */
  types?: readonly string[] | null
  /** Droits du rôle personnalisé. Absent pour un rôle intégré ; null si le rôle a été supprimé (aucun droit). */
  custom?: CustomRights | null
}

type Definition = { kind?: string; adminOnly?: boolean; drafts?: boolean; access?: AccessRules }

/** Droits effectifs d'une personne sur un type de contenu. */
export function rightsOn(who: Who, type: string, def: Definition): Rights {
  if (who.role === 'admin') return ALL
  // Un contenu réservé aux administrateurs l'est pour tout autre rôle, intégré ou personnalisé.
  if (def.adminOnly) return NONE
  if (who.types && !who.types.includes(type)) return NONE

  let wanted: Rights
  if (isBuiltinRole(who.role)) {
    const role = who.role as GrantableRole
    const allowed = (a: CmsAction) => (def.access?.[a] ?? DEFAULT_ACCESS[a]).includes(role)
    wanted = { edit: allowed('edit'), publish: allowed('publish'), delete: allowed('delete'), own: !!def.access?.own?.includes(role) }
  }
  else {
    const row = who.custom?.types[type]
    wanted = { edit: !!row?.edit, publish: !!row?.publish, delete: !!row?.delete, own: !!row?.own }
  }
  // Publier ou supprimer suppose de pouvoir modifier.
  if (!wanted.edit) return NONE
  // Sans brouillons, enregistrer c'est publier : qui ne peut pas publier ne peut donc pas modifier.
  if (def.drafts === false && !wanted.publish) return NONE
  // « Seulement ses contenus » n'a pas de sens pour une page unique.
  return { ...wanted, own: wanted.own && def.kind !== 'singleton' }
}

export const userCan = (who: Who, type: string, def: Definition, action: CmsAction) => rightsOn(who, type, def)[action]

/** Peut modifier les champs marqués `restricted`. Rôles intégrés : tous sauf le rédacteur. */
export const canEditRestricted = (who: Who) => (isBuiltinRole(who.role) ? who.role !== 'writer' : !!who.custom?.restrictedFields)

/** Peut supprimer des fichiers de la médiathèque. Rôles intégrés : tous sauf le rédacteur. */
export const canDeleteMedia = (who: Who) => (isBuiltinRole(who.role) ? who.role !== 'writer' : !!who.custom?.deleteMedia)

/** Ne garde d'un rôle personnalisé que des droits bien formés, sur des types connus. */
export function cleanCustomRights(input: unknown, knownTypes: readonly string[]): CustomRights {
  const raw = (input ?? {}) as { types?: Record<string, Partial<Record<keyof Rights, unknown>>>; restrictedFields?: unknown; deleteMedia?: unknown }
  const types: CustomRights['types'] = {}
  for (const type of knownTypes) {
    const row = raw.types?.[type]
    if (!row?.edit) continue
    // Sans le droit de modifier, les autres droits n'ont pas d'effet : on ne les enregistre pas.
    types[type] = { edit: true, publish: !!row.publish, delete: !!row.delete, own: !!row.own }
  }
  return { types, restrictedFields: !!raw.restrictedFields, deleteMedia: !!raw.deleteMedia }
}
