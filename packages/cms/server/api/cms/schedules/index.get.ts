/**
 * Tout ce qui est programmé sur le site (mises en ligne et retraits, en attente ou en échec), pour les contenus que la
 * personne peut ouvrir. `timeZone` : le fuseau du site ; `trigger` : « missing » si le déclencheur fréquent ne passe pas
 * (les échéances sont alors rattrapées à la première visite du site).
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const [items, trigger] = await Promise.all([allSchedules(event, user), scheduleTrigger(event)])
  return { items, timeZone: siteTimeZone(), trigger }
})
