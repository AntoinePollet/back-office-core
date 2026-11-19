import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

type Json = Record<string, unknown>
export type EntryStatus = 'draft' | 'published' | 'changed'

// ───────────── Contenus ─────────────

/** Un document : une entrée de collection ou un singleton. Porte les champs communs aux langues. */
export const entries = sqliteTable('cms_entries', {
  id: text('id').primaryKey(),
  /** Identifiant de la collection ou du singleton dans cms.config.ts. */
  type: text('type').notNull(),
  position: integer('position').notNull().default(0),
  sharedDraft: text('shared_draft', { mode: 'json' }).$type<Json>().notNull(),
  sharedPublished: text('shared_published', { mode: 'json' }).$type<Json | null>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  /** Numéro de version du contenu : augmente d'un à chaque enregistrement qui change quelque chose. */
  version: integer('version').notNull().default(0),
  /** Numéro de version auquel les champs communs aux langues ont changé pour la dernière fois. */
  sharedVersion: integer('shared_version').notNull().default(0),
  /** Identifiant de la dernière personne à avoir enregistré ce contenu. */
  updatedBy: text('updated_by'),
  /** Compte qui a créé le contenu ; sert au droit « seulement ses contenus ». Vide pour les contenus antérieurs. */
  createdBy: text('created_by'),
}, t => [index('cms_entries_type').on(t.type, t.position)])

/** Une ligne par document et par langue : adresse, statut, champs traduits. */
export const entryLocales = sqliteTable('cms_entry_locales', {
  entryId: text('entry_id').notNull().references(() => entries.id, { onDelete: 'cascade' }),
  locale: text('locale').notNull(),
  type: text('type').notNull(),
  slug: text('slug'),
  status: text('status').$type<EntryStatus>().notNull(),
  draft: text('draft', { mode: 'json' }).$type<Json>().notNull(),
  published: text('published', { mode: 'json' }).$type<Json | null>(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  /** Numéro de version du contenu auquel cette langue a changé pour la dernière fois. */
  version: integer('version').notNull().default(0),
}, t => [
  primaryKey({ columns: [t.entryId, t.locale] }),
  uniqueIndex('cms_entry_locales_slug').on(t.type, t.locale, t.slug),
])

export const media = sqliteTable('cms_media', {
  id: text('id').primaryKey(),
  /** Clé de l'objet dans le bucket R2. */
  key: text('key').notNull(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  /** Texte alternatif par langue : { fr: '…', en: '…' }. */
  alt: text('alt', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /**
   * Dossier où le fichier est rangé ; vide : à la racine de la médiathèque. Ranger un fichier ne change ni sa clé
   * dans R2 ni son adresse publique. Avant de supprimer un dossier, l'API fait remonter ses fichiers dans le dossier parent.
   */
  folderId: text('folder_id').references(() => mediaFolders.id),
}, t => [index('cms_media_folder').on(t.folderId)])

/** Dossier de la médiathèque : une donnée du back-office seulement (règles dans shared/media-folders.ts). */
export const mediaFolders = sqliteTable('cms_media_folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Dossier parent ; vide : à la racine. Profondeur limitée par l'API. */
  parentId: text('parent_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('cms_media_folders_parent').on(t.parentId)])

/** Ancienne adresse d'une page publiée : le site y répond par une redirection vers l'adresse actuelle. */
export const redirects = sqliteTable('cms_redirects', {
  type: text('type').notNull(),
  locale: text('locale').notNull(),
  slug: text('slug').notNull(),
  entryId: text('entry_id').notNull().references(() => entries.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [primaryKey({ columns: [t.type, t.locale, t.slug] })])

/** Réglages du back-office qui ne sont pas des contenus (ex. le thème du site). */
export const settings = sqliteTable('cms_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Compteur d'échecs de connexion, par adresse e-mail et par adresse IP, sur une fenêtre de temps. */
export const rateLimits = sqliteTable('cms_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  /** Fin de la fenêtre : le compteur repart de zéro après cette date. */
  resetAt: integer('reset_at', { mode: 'timestamp_ms' }).notNull(),
})

// ───────────── Workflows ─────────────

export type WorkflowTrigger = { event: string; /** Types de contenu concernés ; vide = tous. */ types: string[] }
export type WorkflowAction =
  | { kind: 'email'; to: string; subject: string; body: string; /** Adresse à laquelle répondre (une variable est possible). */ replyTo?: string }
  | { kind: 'webhook'; url: string }
export type WorkflowStep = { kind: WorkflowAction['kind']; status: 'success' | 'error' | 'skipped'; detail: string; ms: number }

export const workflows = sqliteTable('cms_workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  trigger: text('trigger', { mode: 'json' }).$type<WorkflowTrigger>().notNull(),
  actions: text('actions', { mode: 'json' }).$type<WorkflowAction[]>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Journal : une ligne par déclenchement d'un workflow, avec le résultat de chaque action. */
export const workflowRuns = sqliteTable('cms_workflow_runs', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  /** Nom au moment du déclenchement : le journal reste lisible si le workflow est renommé ou supprimé. */
  workflowName: text('workflow_name').notNull(),
  event: text('event').notNull(),
  /** Ce qui s'est passé, en clair : « Service « Droit des affaires » publié (fr) ». */
  summary: text('summary').notNull(),
  status: text('status').$type<'success' | 'error' | 'skipped'>().notNull(),
  test: integer('test', { mode: 'boolean' }).notNull().default(false),
  steps: text('steps', { mode: 'json' }).$type<WorkflowStep[]>().notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  durationMs: integer('duration_ms').notNull(),
}, t => [index('cms_workflow_runs_started').on(t.startedAt)])

// ───────────── Historique des contenus ─────────────

/** L'état d'un contenu tel que le formulaire le montre : champs communs et brouillon de chaque langue. */
export type RevisionSnapshot = { shared: Json; locales: Record<string, { slug: string | null; values: Json }> }
/** Une partie d'un contenu : 'shared' (champs communs aux langues) ou le code d'une langue. */
export type RevisionPart = string

/**
 * Une ligne par enregistrement qui a changé quelque chose. Chaque ligne garde l'état complet du contenu
 * (toutes les langues et les champs communs) : restaurer une version redonne donc un ensemble cohérent.
 */
export const revisions = sqliteTable('cms_revisions', {
  id: text('id').primaryKey(),
  entryId: text('entry_id').notNull().references(() => entries.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  /** Numéro de version du contenu après cet enregistrement. */
  version: integer('version').notNull(),
  snapshot: text('snapshot', { mode: 'json' }).$type<RevisionSnapshot>().notNull(),
  /** Parties modifiées par cet enregistrement. */
  changed: text('changed', { mode: 'json' }).$type<RevisionPart[]>().notNull(),
  /** Langues publiées, et langues retirées du site, par cet enregistrement. */
  published: text('published', { mode: 'json' }).$type<string[]>().notNull(),
  unpublished: text('unpublished', { mode: 'json' }).$type<string[]>().notNull(),
  /** Enregistrement particulier : restauration d'une version, copie d'un autre contenu, ou état d'avant l'historique. */
  origin: text('origin').$type<'restore' | 'duplicate' | 'initial'>(),
  authorId: text('author_id'),
  /** Nom au moment de l'enregistrement : l'historique reste lisible si le compte est supprimé. */
  authorName: text('author_name'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('cms_revisions_entry').on(t.entryId, t.version)])

// ───────────── Authentification (tables attendues par Better Auth) ─────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  /** Rôle intégré ('admin', 'editor', 'writer') ou identifiant d'un rôle personnalisé (table cms_roles). */
  role: text('role').notNull().default('editor'),
  /** Double authentification activée et confirmée par un premier code (colonne tenue par Better Auth). */
  twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

/**
 * Double authentification d'un compte (table de l'extension « two-factor » de Better Auth). `secret` : la clé de
 * l'application d'authentification, chiffrée avec NUXT_AUTH_SECRET ; `backupCodes` : les empreintes des codes de secours
 * restants (voir server/utils/two-factor.ts). Rien de cette table ne sort par l'API.
 */
export const twoFactor = sqliteTable('two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Faux tant que le premier code n'a pas été saisi : la double authentification n'est alors pas encore active. */
  verified: integer('verified', { mode: 'boolean' }).default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp' }),
}, t => [index('two_factor_user').on(t.userId)])

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

/** Lien à usage unique pour choisir son mot de passe (invitation ou réinitialisation). Seule l'empreinte du jeton est stockée. */
export const invites = sqliteTable('cms_invites', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
})

/** Rôle créé depuis le back-office, avec ses droits contenu par contenu. */
export const roles = sqliteTable('cms_roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rights: text('rights', { mode: 'json' }).$type<import('../../shared/access').CustomRights>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

/**
 * Lien d'aperçu à partager : montre les brouillons du site à quelqu'un qui n'a pas de compte, jusqu'à une date.
 * Seule l'empreinte du jeton est stockée. Le lien montre ce que son créateur a le droit d'ouvrir, rien de plus.
 */
export const previewLinks = sqliteTable('cms_preview_links', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  /** Pour qui ou pour quoi ce lien a été créé : aide à s'y retrouver dans la liste. */
  label: text('label').notNull(),
  createdBy: text('created_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdByName: text('created_by_name').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Demande de publication : quelqu'un qui ne peut pas publier signale qu'un brouillon est prêt. Une au plus par contenu. */
export const reviewRequests = sqliteTable('cms_review_requests', {
  entryId: text('entry_id').primaryKey().references(() => entries.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedByName: text('requested_by_name').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Limite un compte à certains types de contenu. Pas de ligne : le compte a tous les accès de son rôle. */
export const userAccess = sqliteTable('cms_user_access', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  /** Identifiants de collections et de pages uniques (ceux de cms.config.ts). */
  types: text('types', { mode: 'json' }).$type<string[]>().notNull(),
})

// ───────────── Modules ─────────────

/** Une clé d'API enregistrée : son texte chiffré (voir shared/secrets.ts) et de quoi la reconnaître sans la révéler. */
export type StoredSecret = { value: string; hint: string }

/** Réglages d'un module saisis dans le back-office. Une ligne par module. */
export const moduleSettings = sqliteTable('cms_module_settings', {
  module: text('module').primaryKey(),
  /** Réglages qui ne sont pas secrets (expéditeur des e-mails…). */
  values: text('values', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  /** Clés d'API, chiffrées. Elles ne ressortent jamais par l'API du back-office. */
  secrets: text('secrets', { mode: 'json' }).$type<Record<string, StoredSecret>>().notNull(),
  updatedBy: text('updated_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Message reçu par un formulaire du site (module `forms`). */
export const formSubmissions = sqliteTable('cms_form_submissions', {
  id: text('id').primaryKey(),
  /** Identifiant du formulaire dans cms.config.ts. */
  form: text('form').notNull(),
  values: text('values', { mode: 'json' }).$type<Json>().notNull(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('cms_form_submissions_form').on(t.form, t.createdAt)])

/**
 * Paiement reçu par Stripe Checkout (module `stripe`). Une ligne par session Checkout : la référence Stripe est unique,
 * un même événement reçu deux fois ne crée donc jamais deux paiements. Le produit est recopié tel qu'il était à l'achat.
 * Aucune suppression depuis le back-office : c'est une pièce comptable.
 */
export const payments = sqliteTable('cms_payments', {
  id: text('id').primaryKey(),
  /** Session Checkout (cs_…) : référence unique du paiement chez Stripe. */
  sessionId: text('session_id').notNull().unique(),
  /** Paiement Stripe (pi_…), connu une fois la session terminée ; sert au lien vers le tableau de bord et aux remboursements. */
  paymentIntent: text('payment_intent'),
  /** Collection et contenu achetés (le contenu a pu être supprimé depuis). */
  collection: text('collection').notNull(),
  entryId: text('entry_id').notNull(),
  /** Nom du produit au moment de l'achat. */
  title: text('title').notNull(),
  quantity: integer('quantity').notNull(),
  /** Montants en plus petite unité de la devise (centimes). `amount` : total payé, d'après Stripe. */
  unitAmount: integer('unit_amount').notNull(),
  amount: integer('amount').notNull(),
  refundedAmount: integer('refunded_amount').notNull().default(0),
  currency: text('currency').notNull(),
  email: text('email'),
  name: text('name'),
  /** Adresse de livraison, si le module la demande. */
  shipping: text('shipping', { mode: 'json' }).$type<import('../../shared/stripe').ShippingAddress | null>(),
  status: text('status').$type<import('../../shared/stripe').PaymentStatus>().notNull(),
  /** Paiement de test (clé sk_test_ / rk_test_) : aucun argent n'a circulé. */
  livemode: integer('livemode', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('cms_payments_created').on(t.createdAt), index('cms_payments_intent').on(t.paymentIntent)])

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})
