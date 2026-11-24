/**
 * Provenance des contacts : d'où venait le visiteur qui a envoyé un formulaire ou payé (annonce Google Ads, autre
 * publicité, e-mail, réseau social, moteur de recherche, autre site, accès direct).
 *
 * Sur le site, à l'arrivée d'un visiteur, le core lit l'adresse de la page (paramètres `utm_*` et identifiants de clic
 * ajoutés par les régies : `gclid` pour Google Ads…) et le site d'où il vient (seulement son nom de domaine). Cette
 * « provenance » part avec le formulaire ou le paiement ; le serveur la contrôle, la classe dans un canal et
 * l'enregistre avec le message. Aucun appel à Google : c'est le site qui compte ses contacts.
 *
 * Par défaut, la provenance n'est gardée qu'en mémoire, le temps de la visite (navigation dans le site comprise) :
 * rien n'est écrit sur l'appareil du visiteur. La garder d'une visite à l'autre demande son accord (voir
 * `site.attribution.rememberDays` et `cmsAttributionConsent`).
 *
 * Ce fichier porte la logique pure, partagée par le site (lecture) et le serveur (contrôle, canal, comptes).
 */

/** Ce que le site a retenu de l'arrivée d'un visiteur. Tous les champs sont facultatifs, sauf `at`. */
export type VisitOrigin = {
  /** `utm_source` (« google », « newsletter »…), sinon le domaine du site d'où vient le visiteur. */
  source?: string
  /** `utm_medium` (« cpc », « email »…). */
  medium?: string
  /** `utm_campaign` : nom de la campagne. */
  campaign?: string
  /**
   * `utm_id` : identifiant de la campagne chez la régie. Google Ads le remplit tout seul avec le suffixe d'URL finale
   * `utm_id={campaignid}` ; à défaut, le serveur le retrouve à partir du `gclid` (module Google Ads).
   */
  campaignId?: string
  /** `utm_term` : mot-clé de l'annonce. */
  term?: string
  /** `utm_content` : variante de l'annonce. */
  content?: string
  /** Identifiant de clic présent dans l'adresse, et sa valeur (elle servira à renvoyer la conversion à la régie). */
  click?: ClickParam
  clickId?: string
  /** Domaine du site d'où vient le visiteur (« www.google.com »), sans le reste de l'adresse. */
  referrer?: string
  /** Page d'arrivée sur le site, sans ses paramètres. */
  landing?: string
  /** Moment de l'arrivée (millisecondes). */
  at: number
  /**
   * Le visiteur avait accepté la mesure de la publicité (module `consent`) au moment de l'envoi. Sans cet accord,
   * le contact n'est jamais transmis à une régie publicitaire.
   */
  consent?: boolean
}

/** Identifiants de clic ajoutés par les régies publicitaires à l'adresse de la page. */
export const CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'li_fat_id'] as const
export type ClickParam = typeof CLICK_PARAMS[number]

/** Canal d'un contact, du plus précis au plus général. */
export const CHANNELS = {
  'google-ads': 'Google Ads',
  'microsoft-ads': 'Microsoft Ads (Bing)',
  'meta-ads': 'Publicité Facebook / Instagram',
  'linkedin-ads': 'Publicité LinkedIn',
  'tiktok-ads': 'Publicité TikTok',
  'other-ads': 'Autre publicité',
  'email': 'E-mail',
  'social': 'Réseaux sociaux',
  'search': 'Moteur de recherche',
  'campaign': 'Autre campagne',
  'referral': 'Lien depuis un autre site',
  'direct': 'Accès direct',
} as const
export type Channel = keyof typeof CHANNELS

/** Canaux payants : ce sont eux que l'on compare à ce que coûtent les annonces. */
export const PAID_CHANNELS: Channel[] = ['google-ads', 'microsoft-ads', 'meta-ads', 'linkedin-ads', 'tiktok-ads', 'other-ads']

/** Ce qui est enregistré avec un message ou un paiement : la provenance contrôlée, et son canal. */
export type StoredOrigin = Omit<VisitOrigin, 'at'> & {
  at?: number
  channel: Channel
  /** Le module Google Ads a déjà cherché la campagne de ce clic sans la trouver : il ne la redemande plus. */
  clickChecked?: boolean
}

const UTM = { source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign', campaignId: 'utm_id', term: 'utm_term', content: 'utm_content' } as const
/** Longueur gardée d'un texte de provenance (un nom de campagne, un identifiant de clic tiennent largement). */
export const ORIGIN_MAX_TEXT = 200

const text = (value: unknown, max = ORIGIN_MAX_TEXT) => {
  if (typeof value !== 'string') return undefined
  // Caractères de contrôle retirés : la valeur finit dans un tableau, un e-mail, un fichier CSV.
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return clean || undefined
}
const hostOf = (url: string) => {
  try { return new URL(url).hostname.toLowerCase() }
  catch { return '' }
}

/**
 * Sites par lesquels un visiteur ne fait que passer avant de revenir (page de paiement, connexion) : en revenir n'est
 * pas une nouvelle arrivée.
 */
const PASSAGE_HOSTS = /(^|\.)(stripe\.com|paypal\.com|accounts\.google\.com|appleid\.apple\.com|login\.microsoftonline\.com)$/

/** Une provenance qui dit plus que le site précédent : campagne, paramètres utm ou clic d'annonce. */
export const isCampaignOrigin = (origin: Omit<VisitOrigin, 'at'> | null | undefined) =>
  !!origin && !!(origin.source || origin.medium || origin.campaign || origin.campaignId || origin.click)

/**
 * Provenance d'une arrivée sur le site, lue dans l'adresse de la page et le site précédent (`document.referrer`).
 * Null quand il n'y a rien à retenir : pas de paramètre de campagne, pas d'identifiant de clic, et un visiteur
 * qui arrive directement ou depuis une autre page du site lui-même.
 */
export function readVisitOrigin(href: string, referrer: string, now = Date.now()): VisitOrigin | null {
  let url: URL
  try { url = new URL(href) }
  catch { return null }
  const params = url.searchParams
  const out: VisitOrigin = { at: now }
  for (const [key, param] of Object.entries(UTM)) {
    const value = text(params.get(param))
    if (value) out[key as keyof typeof UTM] = value
  }
  const click = CLICK_PARAMS.find(p => text(params.get(p)))
  if (click) { out.click = click; out.clickId = text(params.get(click)) }
  const from = hostOf(referrer)
  if (from && from !== url.hostname.toLowerCase() && !PASSAGE_HOSTS.test(from)) out.referrer = from
  if (!out.source && !out.medium && !out.campaign && !out.campaignId && !out.click && !out.referrer) return null
  out.landing = url.pathname.slice(0, ORIGIN_MAX_TEXT)
  return out
}

/**
 * Contrôle une provenance reçue du navigateur : seuls les champs connus sont gardés, en texte court.
 * Null si elle est absente ou ne dit rien. Le canal est toujours recalculé ici, jamais repris du navigateur.
 */
export function cleanOrigin(input: unknown, now = Date.now()): StoredOrigin | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const out: Omit<VisitOrigin, 'at'> & { at?: number } = {}
  for (const key of ['source', 'medium', 'campaign', 'campaignId', 'term', 'content'] as const) {
    const value = text(raw[key])
    if (value) out[key] = value
  }
  if ((CLICK_PARAMS as readonly unknown[]).includes(raw.click)) {
    const id = text(raw.clickId)
    if (id) { out.click = raw.click as ClickParam; out.clickId = id }
  }
  const referrer = text(raw.referrer)?.toLowerCase()
  if (referrer && /^[a-z0-9.-]+$/.test(referrer)) out.referrer = referrer
  const landing = text(raw.landing)
  if (landing?.startsWith('/')) out.landing = landing
  // Arrivée datée de plus d'un an, ou dans le futur : la date est ignorée, le reste est gardé.
  if (typeof raw.at === 'number' && raw.at > now - 400 * 86_400_000 && raw.at < now + 86_400_000) out.at = Math.round(raw.at)
  if (!out.source && !out.medium && !out.campaign && !out.campaignId && !out.click && !out.referrer) return null
  if (raw.consent === true || raw.consent === 'true') out.consent = true
  return { ...out, channel: channelOf(out) }
}

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search', 'paidsocial', 'paid_social', 'paid-social', 'display', 'cpm', 'cpv', 'banner', 'ads', 'sea', 'retargeting'])
const EMAIL_MEDIUMS = new Set(['email', 'e-mail', 'mail', 'newsletter'])
const SOCIAL_MEDIUMS = new Set(['social', 'social-network', 'social_network', 'social-media', 'sm'])
const SEARCH_MEDIUMS = new Set(['organic', 'seo'])
const ADS_BY_SOURCE: [RegExp, Channel][] = [
  [/^(google|adwords|googleads|google-ads|youtube)$/, 'google-ads'],
  [/^(bing|microsoft|msn)$/, 'microsoft-ads'],
  [/^(facebook|fb|instagram|ig|meta)$/, 'meta-ads'],
  [/^(linkedin|li)$/, 'linkedin-ads'],
  [/^tiktok$/, 'tiktok-ads'],
]
// Google et Yandex : le moteur seulement (google.fr, www.google.com), pas docs.google.com ni sites.google.com.
const SEARCH_HOSTS = /^(www\.)?(google|yandex)\.[a-z]{2,3}(\.[a-z]{2})?$|(^|\.)(bing\.com|duckduckgo\.com|qwant\.com|ecosia\.org|search\.yahoo\.com|baidu\.com|startpage\.com|search\.brave\.com|lilo\.org)$/
const SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.me|instagram\.com|linkedin\.com|lnkd\.in|t\.co|twitter\.com|x\.com|youtube\.com|pinterest\.[a-z.]+|tiktok\.com|reddit\.com|threads\.net|bsky\.app|mastodon\.social|whatsapp\.com)$/
const SOCIAL_SOURCES = /^(facebook|fb|instagram|ig|linkedin|twitter|x|youtube|pinterest|tiktok|reddit|threads|bluesky|mastodon|whatsapp)$/
const MAIL_HOSTS = /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com)$|^(webmail|mail)\.[a-z0-9.-]+$/

/** Canal d'une provenance, d'après les identifiants de clic, puis les paramètres `utm_*`, puis le site précédent. */
export function channelOf(origin: Omit<VisitOrigin, 'at'>): Channel {
  const source = (origin.source ?? '').toLowerCase()
  const medium = (origin.medium ?? '').toLowerCase()
  if (origin.click === 'gclid' || origin.click === 'gbraid' || origin.click === 'wbraid') return 'google-ads'
  if (origin.click === 'msclkid') return 'microsoft-ads'
  if (origin.click === 'ttclid') return 'tiktok-ads'
  if (origin.click === 'li_fat_id') return 'linkedin-ads'
  if (PAID_MEDIUMS.has(medium)) return ADS_BY_SOURCE.find(([re]) => re.test(source))?.[1] ?? 'other-ads'
  // Facebook ajoute `fbclid` à tous les liens qui en sortent, publicité ou non : sans `utm_medium` payant, c'est du social.
  if (EMAIL_MEDIUMS.has(medium)) return 'email'
  if (SOCIAL_MEDIUMS.has(medium) || SOCIAL_SOURCES.test(source) || origin.click === 'fbclid') return 'social'
  if (SEARCH_MEDIUMS.has(medium)) return 'search'
  if (origin.source || origin.medium || origin.campaign || origin.campaignId) return 'campaign'
  const host = origin.referrer ?? ''
  // Messagerie d'abord : mail.google.com n'est pas le moteur de recherche.
  if (MAIL_HOSTS.test(host)) return 'email'
  if (SEARCH_HOSTS.test(host)) return 'search'
  if (SOCIAL_HOSTS.test(host)) return 'social'
  return host ? 'referral' : 'direct'
}

/** Canal d'une ligne enregistrée : sans provenance, c'est un accès direct (ou une provenance non retenue). */
export const channelOfRow = (origin: StoredOrigin | null | undefined): Channel => origin?.channel && origin.channel in CHANNELS ? origin.channel : 'direct'

/** Résumé d'une provenance en une ligne : « Google Ads · campagne « printemps » · mot-clé « avocat lyon » ». */
export function originSummary(origin: StoredOrigin | null | undefined): string {
  const channel = channelOfRow(origin)
  const parts: string[] = [CHANNELS[channel]]
  if (origin?.campaign) parts.push(`campagne « ${origin.campaign} »`)
  if (origin?.term) parts.push(`mot-clé « ${origin.term} »`)
  const from = origin?.source ?? origin?.referrer
  if (from && !PAID_CHANNELS.includes(channel)) parts.push(`depuis ${from}`)
  return parts.join(' · ')
}

/** Une ligne du tableau de provenance : un canal, et le détail par campagne. */
export type OriginStat = { channel: Channel; label: string; count: number; paid: boolean; campaigns: { name: string; count: number }[] }

/**
 * Comptes par canal (du plus fréquent au moins fréquent), avec, pour chacun, les campagnes nommées. Un contact sans
 * provenance compte en « Accès direct ».
 */
export function originStats(rows: { origin?: StoredOrigin | null }[]): OriginStat[] {
  const byChannel = new Map<Channel, { count: number; campaigns: Map<string, number> }>()
  for (const row of rows) {
    const channel = channelOfRow(row.origin)
    const stat = byChannel.get(channel) ?? { count: 0, campaigns: new Map() }
    stat.count++
    const name = row.origin?.campaign ?? ''
    if (name) stat.campaigns.set(name, (stat.campaigns.get(name) ?? 0) + 1)
    byChannel.set(channel, stat)
  }
  return [...byChannel].map(([channel, s]) => ({
    channel, label: CHANNELS[channel], count: s.count, paid: PAID_CHANNELS.includes(channel),
    campaigns: [...s.campaigns].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

// ───────────── Paiements : la provenance passe par les métadonnées de Stripe ─────────────

/** Clés des métadonnées Stripe (500 caractères au plus par valeur, d'où une clé par champ). */
const META = { source: 'cms_o_source', medium: 'cms_o_medium', campaign: 'cms_o_campaign', campaignId: 'cms_o_campaign_id', term: 'cms_o_term', content: 'cms_o_content', click: 'cms_o_click', clickId: 'cms_o_click_id', referrer: 'cms_o_referrer', landing: 'cms_o_landing', at: 'cms_o_at', consent: 'cms_o_consent' } as const

export function originToMetadata(origin: StoredOrigin | null): Record<string, string> {
  if (!origin) return {}
  const out: Record<string, string> = {}
  for (const [key, meta] of Object.entries(META)) {
    const value = origin[key as keyof typeof META]
    if (value !== undefined && value !== '') out[meta] = String(value)
  }
  return out
}

export function originFromMetadata(metadata: Record<string, unknown> | null | undefined): StoredOrigin | null {
  if (!metadata) return null
  const raw: Record<string, unknown> = {}
  for (const [key, meta] of Object.entries(META)) if (typeof metadata[meta] === 'string') raw[key] = key === 'at' ? Number(metadata[meta]) : metadata[meta]
  return cleanOrigin(raw)
}

// ───────────── Écrans du back-office : période et filtre ─────────────

/** Périodes proposées au-dessus des messages et des paiements ; `null` : tout ce qui est conservé. */
export const ORIGIN_PERIODS = [
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 90, label: '90 jours' },
  { days: null, label: 'Tout' },
] as const
export type OriginPeriod = typeof ORIGIN_PERIODS[number]['days']

/** Les lignes de la période et, si un canal est choisi, de ce canal seulement. */
export function filterByOrigin<T extends { origin?: StoredOrigin | null; createdAt: string | Date }>(rows: T[], days: OriginPeriod, channel: Channel | null, now = Date.now()): T[] {
  const since = days === null ? -Infinity : now - days * 86_400_000
  return rows.filter(r => new Date(r.createdAt).getTime() >= since && (!channel || channelOfRow(r.origin) === channel))
}
