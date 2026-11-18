// Règles de validation des réponses : les mêmes pour les questions et pour les arguments.
// Chaque fonction renvoie un message d'erreur, ou `undefined` quand la valeur convient.

import { existsSync, readdirSync, statSync } from 'node:fs'

/** Même règle que le core (shared/format.ts) : 'fr', 'en', 'pt-BR'. */
const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
/** Le bucket s'appelle « identifiant-media » et Cloudflare limite les noms à 63 caractères. */
export const ID_MAX = 50

/** « Cabinet Durand & Fils » → « cabinet-durand-fils ». */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-0-9]+|-+$/g, '')
    .slice(0, ID_MAX)
    .replace(/-+$/, '')
}

export function checkName(value) {
  const name = String(value ?? '').trim()
  if (!name) return 'Le nom du site est obligatoire.'
  if (name.length > 80) return 'Le nom du site ne doit pas dépasser 80 caractères.'
  if (/[\r\n]/.test(name)) return 'Le nom du site tient sur une seule ligne.'
}

export function checkId(value) {
  const id = String(value ?? '')
  if (!id) return 'L\'identifiant est obligatoire.'
  if (!ID.test(id)) return 'Identifiant invalide : lettres minuscules sans accent, chiffres et tirets, en commençant par une lettre (exemple : cabinet-durand).'
  if (id.length < 3) return 'Identifiant trop court : 3 caractères au minimum.'
  if (id.length > ID_MAX) return `Identifiant trop long : ${ID_MAX} caractères au maximum.`
}

/** Adresse du site en production. Vide : pas encore connue. */
export function checkUrl(value) {
  const text = String(value ?? '').trim()
  if (!text) return
  let url
  try {
    url = new URL(text)
  }
  catch {
    return 'Adresse invalide : attendu une adresse complète, comme https://cabinet-durand.fr (ou laisser vide).'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'L\'adresse doit commencer par https://'
  if (url.pathname !== '/' || url.search || url.hash) return 'Indiquer seulement le domaine, sans chemin : https://cabinet-durand.fr'
}

/** « https://cabinet-durand.fr/ » → « https://cabinet-durand.fr » ; vide → undefined. */
export function normalizeUrl(value) {
  const text = String(value ?? '').trim()
  return text ? new URL(text).origin : undefined
}

/** « fr, en » → ['fr', 'en']. */
export function parseLocales(value) {
  return String(value ?? '').split(/[\s,;]+/).map(l => l.trim()).filter(Boolean)
}

export function checkLocales(value) {
  const locales = parseLocales(value)
  if (!locales.length) return 'Indiquer au moins une langue (exemple : fr).'
  for (const l of locales) if (!LOCALE.test(l)) return `Langue « ${l} » invalide : attendu un code comme fr, en ou pt-BR, séparés par des virgules.`
  if (new Set(locales).size !== locales.length) return 'La même langue est citée deux fois.'
}

export function checkDefaultLocale(value, locales) {
  const locale = String(value ?? '').trim()
  if (!locales.includes(locale)) return `La langue par défaut doit faire partie des langues du site (${locales.join(', ')}).`
}

/** Le dossier de destination doit être libre : absent, ou vide. `dir` est un chemin absolu. */
export function checkTargetDir(dir) {
  if (!dir) return 'Le dossier de destination est obligatoire.'
  if (!existsSync(dir)) return
  if (!statSync(dir).isDirectory()) return `${dir} existe déjà et n'est pas un dossier.`
  if (readdirSync(dir).length) return `Le dossier ${dir} existe déjà et n'est pas vide. Choisir un autre dossier, ou le supprimer d'abord.`
}

/** Dossier local du core : il doit contenir le paquet `backoffice-core`. `dir` est un chemin absolu. */
export function checkCorePath(dir, readJson) {
  if (!dir) return 'Le dossier du core est obligatoire.'
  let pkg
  try {
    pkg = readJson(`${dir}/package.json`)
  }
  catch {
    return `Aucun package.json dans ${dir} : indiquer le dossier packages/cms du dépôt du core.`
  }
  if (pkg?.name !== 'backoffice-core') return `${dir} ne contient pas le paquet backoffice-core (trouvé : ${pkg?.name ?? 'sans nom'}).`
}

/** Branche, étiquette ou commit git. */
export function checkGitRef(value) {
  if (!/^[\w./-]+$/.test(String(value ?? ''))) return 'Référence git invalide : attendu une branche, une étiquette ou un commit (exemple : main).'
}
