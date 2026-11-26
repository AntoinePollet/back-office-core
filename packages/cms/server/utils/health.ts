import type { H3Event } from 'h3'
import type { Who } from '../../shared/access'
import { adminEntryPath } from '../../shared/admin-paths'
import type { AnyField, CmsDefinition } from '../../shared/format'
import {
  HEALTH_LIMITS, type HealthFileIssue, type HealthReport, type HealthUse, type LinkVerdict, classifyHref, contentLinks, healthPathKey, isCorePath,
  isHeavyImage, isPrivateHost, lacksAlt, verdictForStatus,
} from '../../shared/health'
import { contentImageIds, seoMediaLink } from '../../shared/seo'

type Values = Record<string, unknown>

/**
 * Examine les contenus en ligne que la personne peut modifier (liens, images) et la médiathèque. Tout est lu en une
 * fois : c'est une vérification qu'on lance en ouvrant l'écran « Santé du site », pas une lecture du site.
 * Les liens vers d'autres adresses ne sont pas appelés ici : l'écran les fait vérifier ensuite, par paquets.
 */
export async function healthReport(event: H3Event, user: Who): Promise<HealthReport> {
  const { site } = cmsConfig
  const db = useDb(event)
  const [docs, locales, files, settings, trashed, autos, rules] = await Promise.all([
    db.select().from(schema.entries),
    db.select().from(schema.entryLocales),
    db.select().from(schema.media),
    db.select().from(schema.settings),
    db.select({ snapshot: schema.trash.snapshot }).from(schema.trash),
    db.select().from(schema.redirects),
    db.select({ source: schema.redirectRules.source }).from(schema.redirectRules),
  ])
  const docById = new Map(docs.map(d => [d.id, d]))
  const fileById = new Map(files.map(f => [f.id, f]))
  const fileKeys = new Set(files.map(f => healthPathKey(mediaUrl(f.key))))

  // Ce qui existe sur le site : les pages en ligne (par contenu et langue, et par adresse) et les anciennes adresses redirigées.
  const live = locales.filter(r => r.published != null && site.locales.includes(r.locale))
  const liveTargets = new Set<string>()
  const knownPaths = new Set<string>(rules.map(r => r.source))
  for (const row of live) {
    const def = findDef(row.type)
    const path = def && publicPath(def, row.locale, row.slug)
    if (!path) continue
    liveTargets.add(`${row.entryId}:${row.locale}`)
    knownPaths.add(healthPathKey(path))
  }
  for (const auto of autos) {
    const def = findDef(auto.type)
    const path = def && publicPath(def, auto.locale, auto.slug)
    if (path) knownPaths.add(healthPathKey(path))
  }

  const origins = [site.url ?? '', getRequestURL(event).origin]
  const report: HealthReport = {
    examined: 0,
    links: { missingPages: [], invalid: [], internal: [], external: [], total: 0 },
    images: { withoutAlt: [], heavy: [] },
    unused: { count: 0, size: 0, files: [] },
    seo: null,
  }
  const internal = new Map<string, HealthUse[]>()
  const external = new Map<string, HealthUse[]>()
  const imageUses = new Map<string, number>()
  const missingTargets = new Set<string>()

  for (const row of live) {
    const def = findDef(row.type)
    const doc = docById.get(row.entryId)
    if (!def || !doc || !can(user, row.type, 'edit') || !ownsOrFree(user, row.type, doc)) continue
    report.examined++
    const fields = def.fields as Record<string, AnyField>
    const values = { ...doc.sharedPublished, ...row.published } as Values
    const name = def.kind === 'collection' ? String(values[def.titleField] ?? '') || 'Sans titre' : def.label
    const to = adminEntryPath(row.type, row.entryId) + (row.locale === site.defaultLocale ? '' : `?lang=${row.locale}`)
    const use = (field: string): HealthUse => ({ type: row.type, id: row.entryId, locale: row.locale, name, typeLabel: def.label, field, to })

    for (const link of contentLinks(fields, values)) {
      report.links.total++
      if (link.kind === 'page') {
        if (!liveTargets.has(`${link.id}:${row.locale}`)) {
          missingTargets.add(link.id)
          report.links.missingPages.push({ ...use(link.field), target: link.id })
        }
        continue
      }
      const found = classifyHref(link.href, origins)
      if (found.kind === 'invalid') report.links.invalid.push({ ...use(link.field), href: link.href, reason: found.reason })
      else if (found.kind === 'external') external.set(found.url, [...(external.get(found.url) ?? []), use(link.field)])
      else if (found.kind === 'internal' && !isCorePath(found.path)) {
        const key = healthPathKey(found.path)
        if (!knownPaths.has(key) && !fileKeys.has(key)) internal.set(found.path, [...(internal.get(found.path) ?? []), use(link.field)])
      }
    }

    const shareImage = (values.seo as Values | undefined)?.image
    for (const id of [...contentImageIds(fields, values), ...(typeof shareImage === 'string' && shareImage ? [shareImage] : [])]) imageUses.set(id, (imageUses.get(id) ?? 0) + 1)
  }

  // Nom des contenus visés par un lien mort : leur titre s'ils existent encore (hors ligne), sinon « supprimé ».
  const titles = missingTargets.size ? await entryTitles(event, [...missingTargets]) : new Map<string, string>()
  for (const issue of report.links.missingPages) {
    const target = docById.get(issue.target)
    const def = target && findDef(target.type)
    issue.target = !target || !def ? 'un contenu supprimé'
      : `« ${titles.get(issue.target) || def.label} » (${def.label}), ${def.path ? 'qui n\'est pas en ligne dans cette langue' : 'qui n\'a pas de page sur le site'}`
  }
  report.links.internal = [...internal].map(([path, uses]) => ({ path, uses }))
  report.links.external = [...external].slice(0, HEALTH_LIMITS.maxExternal).map(([url, uses]) => ({ url, uses }))

  const issue = (id: string, uses: number): HealthFileIssue => {
    const file = fileById.get(id)!
    return { id, name: file.name, size: file.size, to: seoMediaLink(id), uses }
  }
  for (const [id, uses] of imageUses) {
    const file = fileById.get(id)
    if (!file) continue
    if (lacksAlt(file, site.defaultLocale)) report.images.withoutAlt.push(issue(id, uses))
    if (isHeavyImage(file)) report.images.heavy.push(issue(id, uses))
  }
  report.images.heavy.sort((a, b) => b.size - a.size)
  report.images.withoutAlt.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, 'fr'))

  // Fichiers que rien ne cite : ni un contenu (brouillon ou en ligne), ni la corbeille, ni un réglage (page d'attente…).
  const haystack = JSON.stringify([docs.map(d => [d.sharedDraft, d.sharedPublished]), locales.map(l => [l.draft, l.published]), settings.map(s => s.value), trashed.map(t => t.snapshot)])
  // Les polices envoyées se gèrent dans l'écran Apparence : elles ne sont pas des fichiers de la médiathèque à trier.
  const unused = files.filter(f => !isFontMime(f.mime) && !haystack.includes(f.id)).sort((a, b) => b.size - a.size)
  report.unused = { count: unused.length, size: unused.reduce((n, f) => n + f.size, 0), files: unused.slice(0, 50).map(f => issue(f.id, 0)) }

  const pages = await seoOverview(event, user)
  if (pages.length) {
    const has = (id: string) => pages.filter(p => p.tips.some(t => t.id === id)).length
    report.seo = { pages: pages.length, improve: pages.filter(p => p.state === 'improve').length, missingTitle: has('title-missing'), missingDescription: has('description-missing') }
  }
  return report
}

export type ExternalCheck = { url: string; verdict: LinkVerdict; status: number | null; detail: string }

/**
 * Appelle une adresse externe pour savoir si elle répond. D'abord sans télécharger la page (HEAD) ; certains sites
 * refusent cette forme d'appel, la page est alors demandée normalement. Ne lève jamais d'erreur.
 * `allowLocal` : en développement et dans les tests seulement, autorise une adresse de la machine.
 */
export async function checkExternalLink(raw: string, allowLocal = false): Promise<ExternalCheck> {
  let url: URL
  try { url = new URL(raw) }
  catch { return { url: raw, verdict: 'broken', status: null, detail: 'Adresse mal écrite.' } }
  if (!/^https?:$/.test(url.protocol)) return { url: raw, verdict: 'unknown', status: null, detail: 'Seules les adresses http et https sont vérifiées.' }
  if (!allowLocal && isPrivateHost(url.hostname)) return { url: raw, verdict: 'unknown', status: null, detail: 'Adresse d\'un réseau privé : non vérifiée.' }
  const call = (method: 'HEAD' | 'GET') => fetch(url, {
    method, redirect: 'follow', signal: AbortSignal.timeout(HEALTH_LIMITS.externalTimeoutMs),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; verification-de-liens)', 'accept': 'text/html,*/*;q=0.8' },
  })
  try {
    let response = await call('HEAD')
    // HEAD refusé ou mal géré : la réponse à une demande normale fait foi.
    if ([400, 403, 404, 405, 501].includes(response.status)) {
      await response.body?.cancel().catch(() => {})
      response = await call('GET')
    }
    await response.body?.cancel().catch(() => {})
    const verdict = verdictForStatus(response.status)
    return { url: raw, verdict, status: response.status, detail: verdict === 'ok' ? '' : `Réponse ${response.status}.` }
  }
  catch (error) {
    const timeout = (error as Error)?.name === 'TimeoutError'
    return { url: raw, verdict: 'down', status: null, detail: timeout ? `Pas de réponse en ${HEALTH_LIMITS.externalTimeoutMs / 1000} secondes.` : 'Site injoignable (nom de domaine inconnu, ou connexion refusée).' }
  }
}
