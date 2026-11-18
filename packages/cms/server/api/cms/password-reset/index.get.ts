/**
 * Indique si ce site sait envoyer un lien de nouveau mot de passe par e-mail.
 * C'est un réglage du site, le même pour tous : le dire avant toute saisie ne révèle rien sur les comptes.
 */
export default defineEventHandler(async event => ({ available: (await mailStatus(event)).configured }))
