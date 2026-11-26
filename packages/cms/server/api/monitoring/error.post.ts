import { MONITORING, cleanBrowserError } from '../../../shared/monitoring'
import { captureError } from '../../cms-modules/monitoring'

/**
 * Reçoit une erreur survenue dans le navigateur d'un visiteur (module `monitoring`). Route publique : ce qui arrive
 * est contrôlé et tronqué, le bruit (extensions, coupures de réseau, robots) est écarté, et le nombre d'envois par
 * visiteur est limité. La réponse est toujours vide : le navigateur n'en fait rien.
 */
export default defineEventHandler(async (event) => {
  await requireModule(event, 'monitoring')
  setResponseStatus(event, 204)
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > 20_000) return null
  const raw = (await readRawBody(event, 'utf8').catch(() => '')) ?? ''
  let body: unknown = null
  try { body = JSON.parse(raw) }
  catch { return null }
  const error = cleanBrowserError(body, getRequestHeader(event, 'user-agent'))
  if (!error) return null
  const key = `monitoring:${clientIp(event)}`
  // Au-delà de la limite, l'erreur est simplement ignorée : le visiteur n'a pas à le savoir.
  const allowed = await assertRateLimit(event, [{ key, max: MONITORING.maxPerWindow }], () => '').then(() => true, () => false)
  if (!allowed) return null
  await hitRateLimit(event, [key], MONITORING.windowMs)
  await captureError(event, error)
  return null
})
