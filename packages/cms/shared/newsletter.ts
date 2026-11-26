/**
 * Lettre d'information (module `newsletter`) : règles et textes, sans dépendance, partagés par le serveur, l'écran
 * du back-office et leurs tests.
 *
 * Le site recueille des inscriptions ; il n'envoie pas la lettre lui-même. Une inscription suit toujours le même
 * chemin : le visiteur donne son adresse, reçoit un e-mail, et n'est inscrit qu'après avoir cliqué sur le lien de
 * cet e-mail (« double confirmation »). C'est ce qui prouve que l'adresse est bien la sienne. Les inscrits confirmés
 * sont listés dans le back-office (date de la demande, date de la confirmation, page d'origine), exportables, et
 * reportés dans une liste Brevo ou une audience Resend si l'on en désigne une : c'est de là que part la lettre.
 */
import { csvCell } from './activity'
import { type CmsTheme, DEFAULT_THEME, luminance } from './theme'

export const NEWSLETTER = {
  /** Inscriptions acceptées par visiteur (adresse IP) et par fenêtre de dix minutes. */
  maxPerWindow: 5,
  windowMs: 10 * 60_000,
  /** Délai avant de renvoyer l'e-mail de confirmation à une même adresse. */
  resendAfterMs: 10 * 60_000,
  /** Une demande jamais confirmée est effacée au bout de ce nombre de jours : le lien de l'e-mail ne vaut plus. */
  pendingDays: 7,
  /** Inscrits renvoyés à l'écran du back-office (les plus récents). L'export les donne tous. */
  listMax: 2000,
  /** Inscrits reportés dans la liste du service d'envoi par appel de rattrapage. */
  syncBatch: 25,
} as const

export type NewsletterStatus = 'pending' | 'confirmed' | 'unsubscribed'
export const NEWSLETTER_STATUS_LABELS: Record<NewsletterStatus, string> = { pending: 'En attente de confirmation', confirmed: 'Inscrit', unsubscribed: 'Désinscrit' }

/** Adresse e-mail sous sa forme enregistrée (sans espaces, en minuscules), ou null si ce n'en est pas une. */
export function normalizeEmail(input: unknown): string | null {
  const email = String(input ?? '').trim().toLowerCase()
  return email.length <= 254 && /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@.<>()[\],;:"]{2,}$/.test(email) ? email : null
}

// ───────────────────────── Textes vus par le visiteur ─────────────────────────

type Texts = {
  subject: (site: string) => string
  intro: (site: string) => string
  button: string
  ignore: string
  expires: (days: number) => string
  confirmedTitle: string
  confirmedText: (site: string) => string
  alreadyTitle: string
  invalidTitle: string
  invalidText: string
  leaveTitle: string
  leaveText: (email: string) => string
  leaveButton: string
  leftTitle: string
  leftText: string
  back: string
}

/** Français et anglais ; une autre langue du site reçoit l'anglais. */
const TEXTS: Record<'fr' | 'en', Texts> = {
  fr: {
    subject: site => `Confirmez votre inscription à la lettre d'information de ${site}`,
    intro: site => `Vous avez demandé à recevoir la lettre d'information de ${site}. Pour confirmer que cette adresse est bien la vôtre, cliquez sur le bouton ci-dessous.`,
    button: 'Confirmer mon inscription',
    ignore: 'Si vous n\'avez rien demandé, ignorez cet e-mail : vous ne serez pas inscrit.',
    expires: days => `Ce lien est valable ${days} jours.`,
    confirmedTitle: 'Inscription confirmée',
    confirmedText: site => `Merci ! Vous recevrez désormais la lettre d'information de ${site}.`,
    alreadyTitle: 'Votre inscription était déjà confirmée',
    invalidTitle: 'Ce lien n\'est plus valable',
    invalidText: 'Il a peut-être expiré. Vous pouvez vous inscrire à nouveau depuis le site.',
    leaveTitle: 'Se désinscrire',
    leaveText: email => `Ne plus envoyer la lettre d'information à ${email} ?`,
    leaveButton: 'Me désinscrire',
    leftTitle: 'Vous êtes désinscrit',
    leftText: 'Vous ne recevrez plus la lettre d\'information.',
    back: 'Retour au site',
  },
  en: {
    subject: site => `Confirm your subscription to the ${site} newsletter`,
    intro: site => `You asked to receive the ${site} newsletter. To confirm that this address is yours, click the button below.`,
    button: 'Confirm my subscription',
    ignore: 'If you did not ask for this, ignore this email: you will not be subscribed.',
    expires: days => `This link is valid for ${days} days.`,
    confirmedTitle: 'Subscription confirmed',
    confirmedText: site => `Thank you! You will now receive the ${site} newsletter.`,
    alreadyTitle: 'Your subscription was already confirmed',
    invalidTitle: 'This link is no longer valid',
    invalidText: 'It may have expired. You can subscribe again from the website.',
    leaveTitle: 'Unsubscribe',
    leaveText: email => `Stop sending the newsletter to ${email}?`,
    leaveButton: 'Unsubscribe',
    leftTitle: 'You are unsubscribed',
    leftText: 'You will no longer receive the newsletter.',
    back: 'Back to the website',
  },
}

export const newsletterTexts = (locale: string): Texts => TEXTS[locale.toLowerCase().startsWith('fr') ? 'fr' : 'en']

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)
const textOn = (hex: string) => (luminance(hex) > 0.179 ? '#111827' : '#ffffff')

/** L'e-mail de confirmation : sujet et corps HTML. Le lien y figure aussi en clair, pour les messageries sans boutons. */
export function confirmationEmail(input: { siteName: string; locale: string; confirmUrl: string; color?: string }) {
  const t = newsletterTexts(input.locale)
  const color = input.color ?? DEFAULT_THEME.primary
  const html = [
    `<p>${escape(t.intro(input.siteName))}</p>`,
    `<p><a href="${escape(input.confirmUrl)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${escape(color)};color:${textOn(color)};text-decoration:none;font-weight:600">${escape(t.button)}</a></p>`,
    `<p style="font-size:13px;color:#555">${escape(input.confirmUrl)}</p>`,
    `<p style="font-size:13px;color:#555">${escape(t.expires(NEWSLETTER.pendingDays))} ${escape(t.ignore)}</p>`,
  ].join('\n')
  return { subject: t.subject(input.siteName), html }
}

export type NewsletterPage =
  | { kind: 'confirmed' | 'already' | 'invalid' | 'left' }
  /** Demande de désinscription : la page pose la question, et son bouton envoie la réponse à `action`. */
  | { kind: 'leave'; email: string; action: string }

/**
 * Page affichée au visiteur qui suit un lien de la lettre (confirmation, désinscription) : un document HTML
 * autonome, aux couleurs réglées dans l'écran Apparence, sans le code du site.
 */
export function newsletterPageHtml(page: NewsletterPage, input: { siteName: string; locale: string; theme?: Partial<CmsTheme> | null; home: string }) {
  const t = newsletterTexts(input.locale)
  const theme = { ...DEFAULT_THEME, ...input.theme }
  const [title, text] = page.kind === 'leave' ? [t.leaveTitle, t.leaveText(page.email)]
    : page.kind === 'confirmed' ? [t.confirmedTitle, t.confirmedText(input.siteName)]
    : page.kind === 'already' ? [t.alreadyTitle, t.confirmedText(input.siteName)]
    : page.kind === 'invalid' ? [t.invalidTitle, t.invalidText]
    : [t.leftTitle, t.leftText]
  const button = `display:inline-block;padding:.75rem 1.25rem;border-radius:${theme.radius}rem;background:${theme.primary};color:${textOn(theme.primary)};font:inherit;font-weight:600;text-decoration:none;border:0;cursor:pointer`
  const action = page.kind === 'leave'
    ? `<form method="post" action="${escape(page.action)}"><button type="submit" style="${button}">${escape(t.leaveButton)}</button></form>`
    : `<a href="${escape(input.home)}" style="${button}">${escape(t.back)}</a>`
  return `<!doctype html>
<html lang="${escape(input.locale)}" data-cms-newsletter="${page.kind}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} — ${escape(input.siteName)}</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:${theme.base};color:${textOn(theme.base)};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5">
<main style="max-width:32rem;padding:2rem;text-align:center">
<p style="font-weight:600;color:${theme.primary};margin:0 0 1rem">${escape(input.siteName)}</p>
<h1 style="font-size:1.75rem;line-height:1.2;margin:0 0 .75rem">${escape(title)}</h1>
<p style="margin:0 0 1.5rem;opacity:.8">${escape(text)}</p>
${action}
</main>
</body>
</html>`
}

// ───────────────────────── Back-office ─────────────────────────

export type SubscriberRow = {
  email: string; locale: string; status: NewsletterStatus; source?: string | null
  createdAt: Date | number | string; confirmedAt?: Date | number | string | null; unsubscribedAt?: Date | number | string | null
  channel?: string; campaign?: string | null
  /** Lien de désinscription propre à cet inscrit, à joindre aux lettres envoyées depuis un autre outil. */
  unsubscribeUrl?: string
}

/** Les inscrits en CSV lisible par un tableur français (séparateur « ; », marque d'encodage en tête). */
export function subscribersCsv(rows: SubscriberRow[], timeZone = 'Europe/Paris') {
  const when = (at: SubscriberRow['createdAt'] | null | undefined) => (at ? new Date(at).toLocaleString('fr-FR', { timeZone, dateStyle: 'short', timeStyle: 'short' }) : '')
  const lines = [
    ['E-mail', 'État', 'Langue', 'Demande d\'inscription', 'Confirmation', 'Désinscription', 'Page d\'inscription', 'Provenance', 'Campagne', 'Lien de désinscription'],
    ...rows.map(r => [r.email, NEWSLETTER_STATUS_LABELS[r.status], r.locale, when(r.createdAt), when(r.confirmedAt), when(r.unsubscribedAt), r.source ?? '', r.channel ?? '', r.campaign ?? '', r.unsubscribeUrl ?? '']),
  ]
  return '﻿' + lines.map(line => line.map(csvCell).join(';')).join('\r\n')
}
