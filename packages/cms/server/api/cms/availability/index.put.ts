import { MODE_LABELS, parseAvailability } from '../../../../shared/availability'

/**
 * Enregistre la disponibilité du site et ses pages d'attente. Réservé aux administrateurs. Corps : `{ mode, pages? }`.
 * Un changement d'état vide le cache du site : les pages gardées sur le réseau ne doivent plus être servies
 * (fermeture), ou la page d'attente ne doit plus l'être (réouverture). Les pages d'attente elles-mêmes ne sont jamais
 * mises en cache : modifier leur texte vaut tout de suite.
 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readBody(event)
  const before = await readAvailability(event)
  // Une page d'attente absente du corps garde son réglage : changer l'état seul (`{ mode }`) ne l'efface pas.
  const value = parseAvailability({ ...body, pages: { ...before.pages, ...body?.pages } }, cmsConfig.site.locales)
  if (typeof value === 'string') throw createError({ statusCode: 400, message: value })
  await saveAvailability(event, value)
  const modeChanged = before.mode !== value.mode
  if (modeChanged) {
    logActivity(event, { action: 'availability.changed', actor: admin, details: { from: MODE_LABELS[before.mode], to: MODE_LABELS[value.mode] }, target: { kind: 'availability' } })
  }
  if (JSON.stringify(before.pages) !== JSON.stringify(value.pages)) {
    logActivity(event, { action: 'availability.pages_updated', actor: admin, target: { kind: 'availability' } })
  }
  return { availability: value, ...(modeChanged ? { purgeFailed: !(await purgeSiteCache(event)) } : {}) }
})
