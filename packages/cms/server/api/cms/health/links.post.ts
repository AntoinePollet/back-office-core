import { HEALTH_LIMITS } from '../../../../shared/health'

/**
 * Vérifie que des adresses d'autres sites répondent : `{ urls: ['https://…'] }`, quelques adresses par appel.
 * Réservé à qui est connecté ; le serveur n'appelle jamais une adresse de la machine ou d'un réseau privé (sauf en
 * développement, pour les tests), et ne renvoie que le verdict, jamais le contenu de la page.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = await readBody<{ urls?: unknown }>(event).catch(() => null)
  const urls = Array.isArray(body?.urls) ? body.urls.filter((u): u is string => typeof u === 'string' && u.length <= 2000) : []
  if (!urls.length || urls.length > HEALTH_LIMITS.externalBatch) throw createError({ statusCode: 400, message: `Entre 1 et ${HEALTH_LIMITS.externalBatch} adresses par appel.` })
  return { results: await Promise.all([...new Set(urls)].map(url => checkExternalLink(url, import.meta.dev))) }
})
