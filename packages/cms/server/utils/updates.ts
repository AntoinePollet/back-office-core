import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { type UpdateCheckState, type UpdateStatus, isUpdateCheckDue, readLatestRelease, readUpdateCheckState, updateStatus } from '../../shared/updates'

/** Clé de la table cms_settings où l'on garde la dernière réponse de GitHub. */
const KEY = 'updateCheck'
/** GitHub a ce délai pour répondre ; au-delà, on fait comme s'il était en panne. */
const TIMEOUT_MS = 3000

/**
 * Version installée et, s'il y en a une, version plus récente du core.
 *
 * GitHub est interrogé une fois par jour au plus, réponse ou pas : la date de la tentative est écrite en base
 * *avant* l'appel, pour que plusieurs écrans ouverts en même temps ne l'interrogent pas chacun. Entre deux
 * interrogations, la réponse vient de la base. Rien ici ne lève d'erreur : sans réponse de GitHub (panne, délai
 * dépassé, quota), on garde ce qu'on savait, et le back-office n'affiche simplement aucun avis.
 *
 * Désactivation : `runtimeConfig: { cmsUpdateCheck: false }` dans nuxt.config.ts, ou variable NUXT_CMS_UPDATE_CHECK=false.
 */
export async function cmsUpdateStatus(event: H3Event): Promise<UpdateStatus> {
  const config = useRuntimeConfig(event)
  const current = String(config.public.cmsVersion)
  const url = String(config.cmsUpdateUrl ?? '').trim()
  const enabled = !['false', '0', ''].includes(String(config.cmsUpdateCheck).trim().toLowerCase())
  if (!enabled || !url) return updateStatus(current, null)
  let state: UpdateCheckState | null = null
  try {
    const db = useDb(event)
    const save = (value: UpdateCheckState) => db.insert(schema.settings).values({ key: KEY, value, updatedAt: new Date(value.checkedAt) })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date(value.checkedAt) } })
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY))
    state = readUpdateCheckState(row?.value)
    if (isUpdateCheckDue(state, Date.now())) {
      state = { checkedAt: Date.now(), latest: state?.latest ?? null }
      await save(state)
      const latest = await fetchLatestRelease(url)
      if (latest) {
        state = { ...state, latest }
        await save(state)
      }
    }
  }
  catch (error) {
    console.warn('[cms] vérification de la dernière version impossible', error)
  }
  return updateStatus(current, state)
}

/** Dernière version publiée, ou null si GitHub ne répond pas (ou pas ce qu'on attend). */
async function fetchLatestRelease(url: string) {
  try {
    const response = await fetch(url, {
      // GitHub refuse les appels sans en-tête User-Agent. Aucun jeton : le dépôt du core est public.
      headers: { 'accept': 'application/vnd.github+json', 'user-agent': 'backoffice-core' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn(`[cms] dernière version du core : GitHub a répondu ${response.status}`)
      return null
    }
    return readLatestRelease(await response.json())
  }
  catch (error) {
    console.warn('[cms] dernière version du core : GitHub ne répond pas', error)
    return null
  }
}
