/**
 * Droits d'accès aux contenus : qui peut modifier, publier ou supprimer quoi.
 * Fonctions sans dépendance, utilisées par le serveur (qui fait foi) et par l'interface (qui masque ce qui est interdit).
 */

/** Les trois rôles, du plus au moins étendu. */
export type CmsRole = 'admin' | 'editor' | 'writer'
export const CMS_ROLES: CmsRole[] = ['admin', 'editor', 'writer']

export const ROLE_LABELS: Record<CmsRole, string> = { admin: 'Administrateur', editor: 'Éditeur', writer: 'Rédacteur' }
export const ROLE_HELP: Record<CmsRole, string> = {
  admin: 'Tout : contenus, utilisateurs, apparence, workflows, structure.',
  editor: 'Modifie, publie et supprime les contenus ; gère la médiathèque.',
  writer: 'Prépare des brouillons. Ne publie pas, ne retire rien du site et ne supprime pas.',
}
export const roleLabel = (role?: string | null) => ROLE_LABELS[role as CmsRole] ?? ROLE_LABELS.editor

/** `edit` : voir et modifier le brouillon. `publish` : mettre en ligne, retirer du site, changer l'ordre. `delete` : supprimer. */
export type CmsAction = 'edit' | 'publish' | 'delete'
export const CMS_ACTIONS: CmsAction[] = ['edit', 'publish', 'delete']

/** Rôles auxquels on peut accorder un droit dans le fichier de collections. L'administrateur a toujours tous les droits. */
export type GrantableRole = Exclude<CmsRole, 'admin'>
export type AccessRules = Partial<Record<CmsAction, readonly GrantableRole[]>>

/** Sans réglage `access` : éditeurs et rédacteurs modifient, seuls les éditeurs publient et suppriment. */
export const DEFAULT_ACCESS: Record<CmsAction, readonly GrantableRole[]> = {
  edit: ['editor', 'writer'],
  publish: ['editor'],
  delete: ['editor'],
}

type Definition = { adminOnly?: boolean; drafts?: boolean; access?: AccessRules }

/** Ce qu'un rôle a le droit de faire sur un type de contenu, d'après le fichier de collections. */
export function roleCan(def: Definition, role: CmsRole, action: CmsAction): boolean {
  if (role === 'admin') return true
  if (def.adminOnly) return false
  const allowed = (a: CmsAction) => (def.access?.[a] ?? DEFAULT_ACCESS[a]).includes(role)
  // Publier ou supprimer suppose de pouvoir modifier.
  if (!allowed('edit')) return false
  // Sans brouillons, enregistrer c'est publier : qui ne peut pas publier ne peut donc pas modifier.
  if (def.drafts === false && !allowed('publish')) return false
  return allowed(action)
}

export type Who = {
  role: CmsRole
  /** Types de contenu auxquels la personne est limitée ; null ou absent : aucun limite au-delà de son rôle. */
  types?: readonly string[] | null
}

/** Droit effectif d'une personne : celui de son rôle, restreint aux contenus qui lui sont attribués. */
export function userCan(who: Who, type: string, def: Definition, action: CmsAction): boolean {
  if (who.role === 'admin') return true
  if (who.types && !who.types.includes(type)) return false
  return roleCan(def, who.role, action)
}
