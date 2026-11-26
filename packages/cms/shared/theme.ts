/** Thème du site : les réglages modifiables depuis l'écran Apparence, traduits en variables daisyUI. */
import { type CustomFont, type Typography, isDefaultTypography, parseTypography, typographyCss } from './fonts'

export type CmsTheme = {
  primary: string
  secondary: string
  accent: string
  neutral: string
  /** Couleur de fond des pages. Un fond sombre donne un thème sombre. */
  base: string
  /** Arrondi des boutons et des champs, en rem. */
  radius: number
  /** Épaisseur des bordures, en px. */
  border: number
  /** Léger relief sur les boutons et les champs. */
  depth: boolean
  /** Texture (grain) sur les surfaces colorées. */
  noise: boolean
  /** Polices et tailles du texte et des titres (voir shared/fonts.ts). Absente : le site garde celles de son code. */
  typography?: Typography
}

export const DEFAULT_THEME: CmsTheme = {
  primary: '#4f46e5', secondary: '#db2777', accent: '#0d9488', neutral: '#1f2937', base: '#ffffff',
  radius: 0.5, border: 1, depth: true, noise: false,
}

const COLORS = ['primary', 'secondary', 'accent', 'neutral', 'base'] as const
const HEX = /^#[0-9a-f]{6}$/i

/** Vérifie un thème reçu. Renvoie le thème nettoyé, ou un message d'erreur. `families` : familles de polices envoyées sur ce site. */
export function parseTheme(input: any, families: string[] = []): CmsTheme | string {
  for (const key of COLORS) if (typeof input?.[key] !== 'string' || !HEX.test(input[key])) return `Couleur invalide : ${key}.`
  const radius = Number(input.radius)
  const border = Number(input.border)
  if (!(radius >= 0 && radius <= 2)) return 'Arrondi invalide.'
  if (!(border >= 0.5 && border <= 2)) return 'Épaisseur de bordure invalide.'
  const typography = parseTypography(input.typography, families)
  if (typeof typography === 'string') return typography
  return {
    ...Object.fromEntries(COLORS.map(k => [k, input[k].toLowerCase()])) as Pick<CmsTheme, typeof COLORS[number]>,
    radius, border, depth: !!input.depth, noise: !!input.noise,
    // Une typographie qui ne règle rien n'est pas enregistrée : le thème garde sa forme d'avant.
    ...(isDefaultTypography(typography) ? {} : { typography }),
  }
}

/** Luminance relative d'une couleur, de 0 (noir) à 1 (blanc). */
export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Couleur de texte lisible sur un fond donné : celle des deux qui offre le meilleur contraste. */
const textOn = (hex: string) => (luminance(hex) > 0.179 ? '#111827' : '#ffffff')

export const isDarkTheme = (theme: CmsTheme) => luminance(theme.base) < 0.179

/** Couleur du back-office tant qu'aucune n'a été choisie. */
export const DEFAULT_ADMIN_COLOR = '#4f46e5'
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

/** Variables à poser sur la racine du back-office pour lui donner sa couleur. */
export const adminVars = (color: string) => ({ '--color-primary': color, '--color-primary-content': textOn(color) })

/** Variables CSS daisyUI correspondant au thème. */
export function themeVars(theme: CmsTheme): Record<string, string> {
  const dark = isDarkTheme(theme)
  const shade = (percent: number) => `color-mix(in oklab, ${theme.base}, ${dark ? 'white' : 'black'} ${percent}%)`
  const vars: Record<string, string> = { 'color-scheme': dark ? 'dark' : 'light' }
  for (const key of ['primary', 'secondary', 'accent', 'neutral'] as const) {
    vars[`--color-${key}`] = theme[key]
    vars[`--color-${key}-content`] = textOn(theme[key])
  }
  vars['--color-base-100'] = theme.base
  vars['--color-base-200'] = shade(dark ? 7 : 4)
  vars['--color-base-300'] = shade(dark ? 15 : 10)
  vars['--color-base-content'] = dark ? '#e5e7eb' : '#1f2937'
  vars['--radius-selector'] = `${theme.radius}rem`
  vars['--radius-field'] = `${theme.radius}rem`
  vars['--radius-box'] = `${theme.radius * 1.5}rem`
  vars['--border'] = `${theme.border}px`
  vars['--depth'] = theme.depth ? '1' : '0'
  vars['--noise'] = theme.noise ? '1' : '0'
  return vars
}

/** Feuille de style à injecter dans le site. Le sélecteur l'emporte sur les thèmes daisyUI du projet. `fonts` : polices envoyées sur ce site. */
export const themeCss = (theme: CmsTheme, fonts: CustomFont[] = []) =>
  `html:root,html[data-theme]{${Object.entries(themeVars(theme)).map(([k, v]) => `${k}:${v}`).join(';')}}${typographyCss(theme.typography, fonts).css}`
