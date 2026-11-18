import { canDeleteMedia, canEditRestricted, roleLabel } from '../../../shared/access'

/** La personne connectée, avec ses droits sur chaque type de contenu. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    /** Nom du rôle à afficher (celui du rôle personnalisé le cas échéant). */
    roleName: user.roleName ?? roleLabel(user.role),
    types: user.types,
    access: accessMap(user),
    restrictedFields: canEditRestricted(user),
    deleteMedia: canDeleteMedia(user),
  }
})
