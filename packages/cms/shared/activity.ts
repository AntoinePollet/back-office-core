/**
 * Journal d'activité : les actions inscrites, leur phrase en français, l'export CSV. Fonctions sans dépendance.
 * L'écriture en base est dans server/utils/activity.ts (`logActivity`).
 */

/** Durée de conservation du journal, en jours. Les lignes plus anciennes sont effacées à l'occasion d'une écriture. */
export const ACTIVITY_DAYS = 180

/** Familles d'actions, pour le filtre de l'écran « Activité ». */
export const ACTIVITY_CATEGORIES = {
  content: 'Contenus',
  media: 'Médiathèque',
  users: 'Comptes et rôles',
  auth: 'Connexions',
  settings: 'Réglages du site',
} as const
export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES

/** Ce dont une phrase a besoin. Jamais de mot de passe, de jeton ni de valeur de clé d'API. */
export type ActivityDetails = {
  /** Titre du contenu, et libellé de son type (« Services ») ; `single` : page unique. */
  title?: string
  typeLabel?: string
  single?: boolean
  /** Codes des langues concernées (« fr », « en »). */
  locales?: string[]
  /** Nom d'un fichier, d'un dossier, d'une personne, d'un rôle, d'un workflow, d'un module… */
  name?: string
  email?: string
  role?: string
  from?: string
  to?: string
  count?: number
  list?: string[]
  days?: number
}

const quote = (text: unknown) => `« ${String(text ?? '').trim() || 'Sans titre'} »`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`
export const joinFr = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`)

/** Nom français d'une langue : « fr » → « français ». */
export function languageName(code: string) {
  try { return new Intl.DisplayNames(['fr'], { type: 'language' }).of(code) ?? code }
  catch { return code }
}

/** « Droit des affaires » (Services, français) — ou : la page « Accueil » (français). */
function content(d: ActivityDetails) {
  const langs = d.locales?.length ? joinFr(d.locales.map(languageName)) : ''
  if (d.single) return `la page ${quote(d.title)}${langs ? ` (${langs})` : ''}`
  const inside = [d.typeLabel, langs].filter(Boolean).join(', ')
  return `${quote(d.title)}${inside ? ` (${inside})` : ''}`
}
const person = (d: ActivityDetails) => `${d.name ?? 'quelqu\'un'}${d.email ? ` (${d.email})` : ''}`

type Meta = { category: ActivityCategory; label: string; phrase: (d: ActivityDetails) => string }
const action = (category: ActivityCategory, label: string, phrase: Meta['phrase']): Meta => ({ category, label, phrase })

/**
 * Les actions connues du core. `phrase` : ce que la personne a fait, à lire après son nom (« a publié … »).
 * Pour une action automatique (sans personne), la phrase se lit seule.
 */
export const ACTIVITY_ACTIONS = {
  // Contenus
  'entry.created': action('content', 'Contenu créé', d => `a créé ${content(d)}`),
  'entry.duplicated': action('content', 'Contenu dupliqué', d => `a créé ${content(d)} en dupliquant un contenu`),
  'entry.updated': action('content', 'Contenu modifié', d => `a modifié ${content(d)}`),
  'entry.published': action('content', 'Contenu publié', d => `a publié ${content(d)}`),
  'entry.unpublished': action('content', 'Contenu retiré du site', d => `a retiré du site ${content(d)}`),
  'entry.review_requested': action('content', 'Publication demandée', d => `a demandé la publication de ${content(d)}`),
  'entry.revision_restored': action('content', 'Version restaurée', d => `a restauré une version précédente de ${content(d)}`),
  'entry.reordered': action('content', 'Ordre changé', d => `a changé l'ordre des contenus de ${quote(d.typeLabel)}`),
  'entry.deleted': action('content', 'Contenu supprimé', d => `a supprimé ${content(d)} (mis à la corbeille)`),
  'entry.restored': action('content', 'Contenu restauré', d => `a restauré ${content(d)} depuis la corbeille`),
  'entry.purged': action('content', 'Contenu supprimé définitivement', d => `a supprimé définitivement ${content(d)}`),
  'migration.applied': action('content', 'Migration de contenu validée', d => `a validé une migration de contenu (${plural(d.count ?? 0, 'changement appliqué', 'changements appliqués')})`),
  // Corbeille
  'trash.emptied': action('content', 'Corbeille vidée', d => `a vidé la corbeille (${plural(d.count ?? 0, 'élément supprimé définitivement', 'éléments supprimés définitivement')})`),
  'trash.expired': action('content', 'Corbeille : délai écoulé', d => `Corbeille : ${plural(d.count ?? 0, 'élément supprimé définitivement', 'éléments supprimés définitivement')} après le délai de récupération`),
  // Médiathèque
  'media.uploaded': action('media', 'Fichier envoyé', d => `a envoyé le fichier ${quote(d.name)}`),
  'media.deleted': action('media', 'Fichier supprimé', d => `a supprimé le fichier ${quote(d.name)} (mis à la corbeille)`),
  'media.restored': action('media', 'Fichier restauré', d => `a restauré le fichier ${quote(d.name)} depuis la corbeille`),
  'media.purged': action('media', 'Fichier supprimé définitivement', d => `a supprimé définitivement le fichier ${quote(d.name)}`),
  'media.moved': action('media', 'Fichiers déplacés', d => `a déplacé ${d.count === 1 && d.name ? `le fichier ${quote(d.name)}` : plural(d.count ?? 0, 'fichier')} ${d.to ? `dans le dossier ${quote(d.to)}` : 'à la racine de la médiathèque'}`),
  'media.focus_changed': action('media', 'Point d\'intérêt réglé', d => (d.to ? `a réglé le point d'intérêt de l'image ${quote(d.name)} (${d.to})` : `a remis au centre le point d'intérêt de l'image ${quote(d.name)}`)),
  'folder.created': action('media', 'Dossier créé', d => `a créé le dossier ${quote(d.name)}`),
  'folder.renamed': action('media', 'Dossier renommé', d => `a renommé le dossier ${quote(d.from)} en ${quote(d.to)}`),
  'folder.moved': action('media', 'Dossier déplacé', d => `a déplacé le dossier ${quote(d.name)} ${d.to ? `dans ${quote(d.to)}` : 'à la racine de la médiathèque'}`),
  'folder.deleted': action('media', 'Dossier supprimé', d => `a supprimé le dossier ${quote(d.name)}`),
  // Comptes et rôles
  'user.setup': action('users', 'Premier compte créé', () => 'a créé le premier compte administrateur'),
  'user.invited': action('users', 'Compte invité', d => `a invité ${person(d)}${d.role ? ` avec le rôle ${quote(d.role)}` : ''}`),
  'user.link_created': action('users', 'Lien de mot de passe créé', d => `a créé un lien de mot de passe pour ${person(d)}`),
  'user.password_set': action('users', 'Mot de passe choisi', () => 'a choisi son mot de passe'),
  'user.renamed': action('users', 'Compte renommé', d => `a renommé le compte ${quote(d.from)} en ${quote(d.to)}`),
  'user.role_changed': action('users', 'Rôle changé', d => `a changé le rôle de ${person(d)} : ${d.from} → ${d.to}`),
  'user.types_changed': action('users', 'Contenus attribués', d => (d.list ? `a limité ${person(d)} à ${plural(d.list.length, 'contenu')} : ${d.list.join(', ')}` : `a donné à ${person(d)} l'accès à tous les contenus de son rôle`)),
  'user.deleted': action('users', 'Compte supprimé', d => `a supprimé le compte de ${person(d)}`),
  'role.created': action('users', 'Rôle personnalisé créé', d => `a créé le rôle ${quote(d.name)}`),
  'role.updated': action('users', 'Rôle personnalisé modifié', d => `a modifié le rôle ${quote(d.name)}`),
  'role.deleted': action('users', 'Rôle personnalisé supprimé', d => `a supprimé le rôle ${quote(d.name)}`),
  // Connexions
  'auth.login': action('auth', 'Connexion', () => 'a ouvert une session'),
  'auth.failures': action('auth', 'Échecs de connexion répétés', d => `${plural(d.count ?? 0, 'échec')} de connexion de suite pour le compte ${d.email}`),
  'auth.blocked': action('auth', 'Connexion bloquée', d => (d.email
    ? `Connexion bloquée un moment pour le compte ${d.email}, après ${plural(d.count ?? 0, 'échec')}`
    : `Connexions bloquées un moment depuis une même adresse, après ${plural(d.count ?? 0, 'échec')}`)),
  // Réglages
  'module.enabled': action('settings', 'Module activé', d => `a activé le module ${quote(d.name)}`),
  'module.disabled': action('settings', 'Module désactivé', d => `a désactivé le module ${quote(d.name)}`),
  'module.updated': action('settings', 'Réglages d\'un module modifiés', d => `a modifié les réglages du module ${quote(d.name)}`),
  'theme.updated': action('settings', 'Apparence modifiée', () => 'a modifié l\'apparence du site'),
  'theme.reset': action('settings', 'Apparence modifiée', () => 'a rétabli l\'apparence d\'origine du site'),
  'availability.changed': action('settings', 'Disponibilité du site modifiée', d => (d.to === 'En ligne'
    ? `a remis le site en ligne (il était « ${d.from} »)`
    : `a passé le site en « ${d.to} » : les visiteurs voient la page d'attente`)),
  'availability.pages_updated': action('settings', 'Pages d\'attente modifiées', () => 'a modifié les pages d\'attente du site (construction, maintenance)'),
  'admin_color.updated': action('settings', 'Apparence modifiée', () => 'a changé la couleur du back-office'),
  'workflow.created': action('settings', 'Workflow créé', d => `a créé le workflow ${quote(d.name)}`),
  'workflow.updated': action('settings', 'Workflow modifié', d => `a modifié le workflow ${quote(d.name)}`),
  'workflow.toggled': action('settings', 'Workflow modifié', d => `a ${d.to === 'on' ? 'activé' : 'mis en pause'} le workflow ${quote(d.name)}`),
  'workflow.deleted': action('settings', 'Workflow supprimé', d => `a supprimé le workflow ${quote(d.name)}`),
  'preview_link.created': action('settings', 'Lien d\'aperçu créé', d => `a créé un lien d'aperçu ${quote(d.name)}${d.days ? `, valable ${plural(d.days, 'jour')}` : ''}`),
  'preview_link.revoked': action('settings', 'Lien d\'aperçu révoqué', d => `a révoqué le lien d'aperçu ${quote(d.name)}`),
} satisfies Record<string, Meta>

export type ActivityAction = keyof typeof ACTIVITY_ACTIONS
const known = (code: string): Meta | undefined => (ACTIVITY_ACTIONS as Record<string, Meta>)[code]

export const activityCategory = (code: string): ActivityCategory | undefined => known(code)?.category
/** Ce qu'une action a fait, sans la personne : « a publié « Droit des affaires » (Services, français) ». */
export const activityPhrase = (code: ActivityAction, details: ActivityDetails = {}) => ACTIVITY_ACTIONS[code].phrase(details)

/**
 * La ligne du journal : « Claire Durand a publié « Droit des affaires » (Services, français) ».
 * Sans personne (action automatique, échec de connexion), la phrase se lit seule, avec une majuscule.
 */
export function activitySentence(actorName: string | null | undefined, phrase: string) {
  const text = phrase.trim()
  if (actorName?.trim()) return `${actorName.trim()} ${text}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ───────────── Événements des contenus → lignes du journal ─────────────

type EntryEvent = { name: string; type?: string; id?: string; title?: string; locale?: string }
export type EntryActivity = { action: ActivityAction; type: string; id: string; title: string; locales?: string[] }
/** Précision donnée par l'enregistrement : rien n'a changé, version restaurée depuis l'historique, ou copie. */
export type EntryActivityHint = 'unchanged' | 'revision' | 'duplicate'

const ENTRY_ACTIONS: Record<string, ActivityAction> = {
  'entry.created': 'entry.created', 'entry.updated': 'entry.updated', 'entry.published': 'entry.published',
  'entry.unpublished': 'entry.unpublished', 'entry.deleted': 'entry.deleted', 'entry.restored': 'entry.restored',
  'entry.review_requested': 'entry.review_requested',
}

/**
 * Traduit les événements d'un enregistrement (ceux des workflows) en lignes du journal, avec retenue :
 * une ligne « publié » ou « retiré du site » par contenu, toutes langues réunies ; pas de ligne « modifié » en plus
 * quand le même enregistrement publie ou retire ; rien du tout si l'enregistrement n'a rien changé.
 */
export function activityFromEvents(events: EntryEvent[], hint?: EntryActivityHint): EntryActivity[] {
  const out: EntryActivity[] = []
  const lines = new Map<string, EntryActivity>()
  for (const e of events) {
    const code = ENTRY_ACTIONS[e.name]
    if (!code || !e.type || !e.id) continue
    const key = `${code}:${e.id}`
    let line = lines.get(key)
    if (!line) {
      line = { action: code, type: e.type, id: e.id, title: e.title ?? '' }
      lines.set(key, line)
      out.push(line)
    }
    if (e.locale && (code === 'entry.published' || code === 'entry.unpublished')) (line.locales ??= []).push(e.locale)
  }
  const visible = (id: string) => out.some(l => l.id === id && (l.action === 'entry.published' || l.action === 'entry.unpublished'))
  return out.flatMap((line): EntryActivity[] => {
    if (line.action === 'entry.updated') {
      if (hint === 'revision') return [{ ...line, action: 'entry.revision_restored' }]
      if (hint === 'unchanged' || visible(line.id)) return []
    }
    if (line.action === 'entry.created' && hint === 'duplicate') return [{ ...line, action: 'entry.duplicated' }]
    return [line]
  })
}

// ───────────── Export ─────────────

/**
 * Une cellule de fichier CSV. Un texte qui commence par = + - @ (ou une tabulation) serait pris pour une formule
 * par le tableur : il est neutralisé par une apostrophe.
 */
export const csvCell = (value: unknown) => {
  const text = String(value ?? '')
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
}

export type ActivityCsvRow = { at: Date | number | string; actorName?: string | null; actorEmail?: string | null; action: string; category: string; summary: string; ip?: string | null }

/** Le journal en CSV lisible par un tableur français (séparateur « ; », marque d'encodage en tête). */
export function activityCsv(rows: ActivityCsvRow[], timeZone = 'Europe/Paris') {
  const when = (at: ActivityCsvRow['at']) => new Date(at).toLocaleString('fr-FR', { timeZone, dateStyle: 'short', timeStyle: 'medium' })
  const lines = [
    ['Date', 'Personne', 'E-mail', 'Type d\'action', 'Action', 'Adresse IP'],
    ...rows.map(r => [
      when(r.at), r.actorName ?? '', r.actorEmail ?? '',
      known(r.action)?.label ?? ACTIVITY_CATEGORIES[r.category as ActivityCategory] ?? r.action, r.summary, r.ip ?? '',
    ]),
  ]
  return '﻿' + lines.map(line => line.map(csvCell).join(';')).join('\r\n')
}
