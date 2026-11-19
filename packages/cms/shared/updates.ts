// Avis de nouvelle version du core : comparaison des numéros et lecture de la réponse de GitHub.
// Rien ici ne touche au réseau ni à la base (voir server/utils/updates.ts).

/** Délai minimal entre deux interrogations de GitHub, réussies ou non : une par jour au plus. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Dernière version publiée du core, telle que lue chez GitHub. */
export type LatestRelease = { version: string; url: string }

/** Ce que le back-office garde entre deux interrogations (table cms_settings, clé « updateCheck »). */
export type UpdateCheckState = { checkedAt: number; latest: LatestRelease | null }

/** Réponse de GET /api/cms/update. `latest` n'est renseigné que si une version plus récente existe. */
export type UpdateStatus = { current: string; latest: string | null; url: string | null }

/** « 0.5.1 » ou « v0.5.1 » → [0, 5, 1]. Toute autre forme (préversion, texte libre) → null. */
export function parseVersion(text: unknown): [number, number, number] | null {
  const m = typeof text === 'string' ? /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(text.trim()) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Négatif si a < b, nul si égales, positif si a > b. Une version illisible est considérée comme égale. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) return 0
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** `candidate` est-elle strictement plus récente que `current` ? Faux dès qu'un des deux numéros est illisible. */
export const isNewerVersion = (candidate: string, current: string) => compareVersions(candidate, current) > 0

/**
 * Lit la réponse de GitHub à « dernière version publiée » (GET /repos/<dépôt>/releases/latest).
 * Renvoie null pour tout ce qui n'est pas une version publiée lisible : brouillon, préversion, numéro inattendu.
 * L'adresse des notes n'est gardée que si c'est une adresse web ; elle est affichée telle quelle dans un lien.
 */
export function readLatestRelease(data: unknown): LatestRelease | null {
  if (!data || typeof data !== 'object') return null
  const release = data as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }
  if (release.draft === true || release.prerelease === true) return null
  const version = parseVersion(release.tag_name)
  if (!version || typeof release.html_url !== 'string' || !/^https?:\/\/[^\s"'<>]+$/.test(release.html_url)) return null
  return { version: version.join('.'), url: release.html_url }
}

/** Ce qui a été gardé en base est-il lisible ? (La valeur vient d'une colonne JSON : on ne lui fait pas confiance.) */
export function readUpdateCheckState(value: unknown): UpdateCheckState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as { checkedAt?: unknown; latest?: { version?: unknown; url?: unknown } | null }
  if (typeof state.checkedAt !== 'number' || !Number.isFinite(state.checkedAt)) return null
  const latest = state.latest && parseVersion(state.latest.version) && typeof state.latest.url === 'string'
    ? { version: String(state.latest.version), url: state.latest.url }
    : null
  return { checkedAt: state.checkedAt, latest }
}

/** Faut-il réinterroger GitHub ? Oui sans trace d'une interrogation, ou si la dernière a plus d'un jour. */
export function isUpdateCheckDue(state: UpdateCheckState | null, now: number): boolean {
  // Une date dans le futur (horloge déréglée) ne doit pas bloquer la vérification pour toujours.
  return !state || now - state.checkedAt >= UPDATE_CHECK_INTERVAL_MS || state.checkedAt > now
}

/** Ce qu'on montre à l'administrateur : la dernière version connue, seulement si elle dépasse la version installée. */
export function updateStatus(current: string, state: UpdateCheckState | null): UpdateStatus {
  const latest = state?.latest && isNewerVersion(state.latest.version, current) ? state.latest : null
  return { current, latest: latest?.version ?? null, url: latest?.url ?? null }
}
