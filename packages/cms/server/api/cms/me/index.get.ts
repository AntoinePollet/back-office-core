import { canDeleteMedia, canEditRestricted, canOrganizeMedia, roleLabel } from '../../../../shared/access'

/** La personne connectée, avec ses droits sur chaque type de contenu. */
export default defineEventHandler(async (event) => {
  // Seule route qui répond à un compte tenu d'activer la double authentification : l'interface l'y conduit.
  const user = await requireUser(event, { allowTwoFactorSetup: true })
  // Repli des sauvegardes : si le déclencheur planifié n'a rien fait depuis plus d'un jour, la visite d'un
  // administrateur lance la sauvegarde du jour, sans retarder la réponse.
  if (user.role === 'admin') event.waitUntil(runAutoBackup(event).catch(error => console.error('[cms] sauvegarde de repli impossible', error)))
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    /** Nom du rôle à afficher (celui du rôle personnalisé le cas échéant). */
    roleName: user.roleName ?? roleLabel(user.role),
    types: user.types,
    access: accessMap(user),
    restrictedFields: canEditRestricted(user),
    deleteMedia: canDeleteMedia(user),
    /** Peut créer, renommer, supprimer des dossiers de la médiathèque et y déplacer des fichiers. */
    organizeMedia: canOrganizeMedia(user),
    /** Peut créer un lien d'aperçu à partager. */
    sharePreview: canSharePreview(user),
    /** Double authentification : activée sur ce compte ; à activer avant toute autre chose (règle du site). */
    twoFactor: { enabled: !!user.twoFactorEnabled, setupRequired: user.twoFactorSetup },
  }
})
