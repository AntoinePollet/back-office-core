# __SITE_NAME__

Site vitrine avec son back-office. Le projet étend `backoffice-core` : le core apporte l'interface d'administration
(`/admin`), l'API des contenus et les fonctions de lecture ; ce dépôt contient ce qui est propre au site.

| Fichier | Rôle |
| --- | --- |
| `cms.config.ts` | Les contenus modifiables par le client : pages uniques (`singleton`) et listes (`collection`) |
| `app/pages/` | Les pages du site (Vue, Tailwind 4, daisyUI 5) |
| `app/layouts/default.vue` | En-tête et pied de page communs |
| `app/app.config.ts` | Nom du site affiché dans les pages |
| `wrangler.jsonc` | Ressources Cloudflare : Worker `__ID__`, base D1 `__ID__`, bucket R2 `__BUCKET__` |
| `.npmrc` | Réglage de pnpm indispensable avec la dépendance git vers le core (voir le commentaire du fichier) |

## Lancer en local

Il faut Node 22.21 ou plus récent (ou 24.11 et plus) et pnpm 9 ou plus récent.

```sh
pnpm install
pnpm db:migrate     # crée la base locale dans .wrangler/ (à refaire après une mise à jour du core)
pnpm dev            # http://localhost:3000
```

Ouvrir `http://localhost:3000/admin` : à la première visite, le back-office propose de créer le compte administrateur.
En local, la base, les images et les comptes vivent dans `.wrangler/` et n'ont aucun lien avec le site en ligne.
Pour repartir de zéro : arrêter le serveur, supprimer `.wrangler/`, relancer `pnpm db:migrate`.

`pnpm typecheck` vérifie les types, y compris l'usage des contenus dans les pages.

## Lire les contenus dans une page

Les fonctions sont disponibles sans import, et typées d'après `cms.config.ts` :

```vue
<script setup lang="ts">
const { data: home } = await useSingleton('home')                          // une page unique
const { data: articles } = await useCollection('articles')                 // toute une collection
const { data: page } = await useCollectionPage('articles', { limit: 10 })  // une page de résultats
const { data: article } = await useEntry('articles', () => route.params.slug as string)
useCmsSeo(article, { titleSuffix: useAppConfig().siteName })               // titre, description, image de partage
</script>

<template>
  <CmsImage :media="article?.cover" sizes="(min-width: 48rem) 45rem, 100vw" />
</template>
```

Un contenu n'apparaît sur le site qu'une fois publié. Avec plusieurs langues, chaque fonction accepte `{ locale: 'en' }` ;
sans cette option, c'est la langue par défaut.

Pour ajouter un type de contenu : le déclarer dans `cms.config.ts` (le serveur de développement redémarre, le back-office
affiche le nouveau menu), puis créer la page dans `app/pages/`. Il n'y a pas de migration de base à écrire.

## Reprendre des contenus existants

Pour remplir le back-office avec des contenus déjà écrits ailleurs (ancien site, tableur, textes en dur dans les pages),
décrivez-les dans un fichier, par exemple `cms.import.json` à la racine du projet, puis lancez l'import contre un
back-office qui tourne :

```sh
CMS_EMAIL=moi@exemple.fr pnpm cms:import --dry-run     # simulation : dit ce qui serait fait, n'écrit rien
CMS_EMAIL=moi@exemple.fr pnpm cms:import               # en local (http://localhost:3000, `pnpm dev` lancé)
CMS_EMAIL=moi@exemple.fr pnpm cms:import --url https://monsite.fr
```

Le compte est un compte du back-office : l'import a ses droits, et les contenus sont vérifiés comme dans le formulaire.
Le mot de passe est demandé dans le terminal sans être affiché ; pour un lancement automatique, le donner par la
variable `CMS_PASSWORD` (jamais en option de la commande, qui resterait dans l'historique du terminal).

```json
{
  "singletons": {
    "settings": { "phone": "04 72 00 00 00", "email": "contact@exemple.fr" }
  },
  "collections": {
    "articles": [
      {
        "id": "ouverture",
        "title": "Ouverture du nouveau cabinet",
        "date": "2026-09-01",
        "excerpt": "Nous vous accueillons désormais rue de la République.",
        "cover": { "file": "/photos/cabinet.jpg", "alt": "La façade du cabinet" },
        "body": "<p>Venez nous rendre visite.</p>",
        "en": { "title": "Our new office is open" }
      }
    ]
  }
}
```

- Les valeurs se donnent par nom de champ (ceux de `cms.config.ts`), dans la langue par défaut. Une autre langue s'écrit
  dans un bloc à son code (`"en": { … }`), avec les seuls champs traduits.
- `id` (obligatoire dans une collection) est un nom de votre choix, stable. **Relancer l'import ne crée pas de doublon** :
  l'élément qui porte cet `id` est mis à jour. Seuls les champs écrits dans le fichier sont modifiés ; `null` vide un champ.
- Image ou fichier : un chemin. `"/photos/a.jpg"` est lu dans `public/`, `"photos/a.jpg"` à côté du fichier d'import.
  Le fichier est envoyé dans la médiathèque, une seule fois même s'il est cité plusieurs fois ou si l'import est relancé.
  Texte alternatif : `{ "file": "…", "alt": "…" }`, ou `"alt": { "fr": "…", "en": "…" }`.
- Dossier de la médiathèque : `{ "file": "photos/toit-1.jpg", "folder": "Chantiers/Toiture" }` range le fichier dans
  le dossier « Toiture » du dossier « Chantiers » (`/` sépare les niveaux, 3 au plus). Les dossiers manquants sont créés ;
  un dossier existant est retrouvé par son nom (majuscules comprises), donc relancer l'import ne crée pas de doublon.
  Un fichier déjà dans la médiathèque est déplacé dans ce dossier ; sans `"folder"`, il reste où il est. Ranger un fichier
  ne change pas son adresse : les pages qui l'affichent ne sont pas touchées. Créer des dossiers et déplacer des fichiers
  demande un compte qui peut gérer la médiathèque (éditeur ou administrateur).
- Galerie (champ `image` ou `file` avec `multiple: true`) : une liste, dans l'ordre d'affichage, de chemins ou d'objets ;
  la légende (`"caption"`, si le champ a `captions: true`) est propre à cette galerie, le texte alternatif au fichier :
  `"photos": ["/photos/a.jpg", { "file": "photos/b.jpg", "alt": "Vue de la salle", "caption": "Marseille (13)" }]`.
  Dans un répéteur, chaque élément a sa propre liste.
- Relation : l'`id` d'un élément de la collection visée, présent dans le même fichier (un tableau pour un champ multiple).
- Lien : `"https://…"`, `"/contact"`, `{ "url": "…", "label": "…", "newTab": true }`, ou une page du site :
  `{ "page": "articles", "id": "ouverture" }` (`{ "page": "home" }` pour une page unique).
- Liste d'éléments (répéteur) : un tableau d'objets. Texte mis en forme : du HTML. Date : `"2026-09-01"`.
- `"slug"` fixe l'adresse de la page, `"seo": { "title", "description", "image", "noindex" }` le référencement.
- Les éléments sont **publiés** ; `"status": "draft"` sur un élément (ou à la racine du fichier), ou l'option `--draft`,
  les laisse en brouillon.

Le fichier peut aussi être un module (`cms.import.mjs` ou `.ts`) dont l'export par défaut est cet objet, ou une fonction
qui le renvoie : pratique pour le calculer à partir d'autres données. Le fichier est vérifié en entier avant le premier
envoi ; ensuite, une erreur sur un élément n'empêche pas d'importer les autres, et la commande se termine en erreur.

## Mettre en ligne

### La première fois

`pnpm create-site` peut avoir déjà fait ces étapes. Sinon, dans l'ordre :

```sh
pnpm exec wrangler login                                    # une fois par machine
pnpm exec wrangler d1 create __ID__ --location weur --no-update-config
# reporter le database_id affiché dans wrangler.jsonc
pnpm exec wrangler r2 bucket create __BUCKET__ --location weur
pnpm exec wrangler d1 migrations apply DB --remote          # crée les tables
pnpm build
# premier déploiement, avec le secret des sessions tiré au hasard :
printf 'NUXT_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" > .secrets.env
pnpm exec wrangler deploy --secrets-file .secrets.env
rm .secrets.env
```

Puis ouvrir `/admin` sur l'adresse affichée par wrangler et **créer tout de suite le compte administrateur** :
tant qu'aucun compte n'existe, n'importe quel visiteur peut le créer.

Le secret `NUXT_AUTH_SECRET` reste enregistré chez Cloudflare : inutile de le fournir aux déploiements suivants.
Le changer (`pnpm exec wrangler secret put NUXT_AUTH_SECRET`) déconnecte tous les utilisateurs, rend illisibles les
clés d'API des modules et **invalide la double authentification de tous les comptes** (voir « Double authentification »).

### Les fois suivantes

```sh
pnpm run deploy
```

La commande construit le site, applique les migrations manquantes à la base en ligne, puis déploie.
Attention : `pnpm deploy` (sans `run`) est une autre commande, propre à pnpm.

### Nom de domaine

Dans le tableau de bord Cloudflare : Workers, `__ID__`, Réglages, Domaines et routes. Puis renseigner l'adresse dans
`cms.config.ts` (`site.url`) et redéployer : elle sert aux adresses canoniques, aux aperçus et aux e-mails.

### Envoi d'e-mails (facultatif)

Les e-mails du back-office (workflows, lien de nouveau mot de passe, notifications des formulaires) partent par Brevo.
Le plus simple : dans le back-office, **Modules → Brevo**, coller la clé d'API et l'expéditeur, puis « Vérifier la
connexion ». La clé est enregistrée chiffrée et ne peut plus être relue ensuite.

On peut aussi les poser dans l'hébergement ; ce qui est saisi dans le back-office passe avant :

```sh
pnpm exec wrangler secret put NUXT_BREVO_API_KEY
pnpm exec wrangler secret put NUXT_EMAIL_FROM     # « Nom du site <contact@exemple.fr> », expéditeur validé dans Brevo
```

Les clés saisies dans le back-office sont chiffrées avec `NUXT_AUTH_SECRET` : si ce secret change, il faut les saisir
à nouveau.

## Modules

Un module ajoute une fonction au site. Il s'active dans `cms.config.ts` et se règle dans le back-office (écran
« Modules », réservé aux administrateurs) :

```ts
import { brevo, forms } from 'backoffice-core/modules'

export default defineCms({
  site: { … },
  modules: [
    brevo(),
    forms({
      contact: {
        label: 'Contact',
        fields: {
          name: f.text({ label: 'Nom', required: true }),
          email: f.text({ label: 'E-mail', required: true, format: 'email' }),
          message: f.textarea({ label: 'Message', required: true }),
          consent: f.boolean({ label: 'J\'accepte que mes données soient utilisées pour me répondre', required: true }),
        },
      },
    }),
  ],
})
```

| Module | Ce qu'il apporte |
| --- | --- |
| `brevo()` | L'envoi des e-mails. Réglages : clé d'API, expéditeur. |
| `forms({ … })` | Des formulaires pour le site. Chaque message est validé par le serveur, enregistré, visible dans « Messages reçus » (administrateurs et éditeurs) et peut déclencher un workflow. |
| `stripe({ … })` | Le paiement en ligne d'un produit à prix fixe, sur la page de paiement de Stripe. Le prix vient du back-office. Paiements visibles dans « Paiements » (administrateurs et éditeurs). Réglages : clé d'API, secret du webhook. |
| `analytics()` | La fréquentation du site dans l'écran « Audience » (administrateurs et éditeurs) : visites, pages vues, courbe par jour, pages les plus vues, sites d'origine. Par Cloudflare Web Analytics, sans cookie ni bandeau de consentement. Réglages : jeton de la balise, identifiant du site, identifiant du compte, jeton d'API en lecture. |
| `turnstile()` | Un anti-robots pour les formulaires du site (Cloudflare Turnstile), le plus souvent invisible pour les visiteurs. Réglages : clé du site, clé secrète. Côté page : `<CmsTurnstile />`. |

### Brancher un formulaire sur une page

```vue
<script setup lang="ts">
const form = useCmsForm('contact')   // les champs sont proposés par l'éditeur, d'après cms.config.ts
</script>

<template>
  <p v-if="form.sent.value">Merci, votre message est bien parti.</p>
  <form v-else @submit.prevent="form.submit()">
    <input v-model="form.values.email" type="email">
    <p v-if="form.errors.value.email">{{ form.errors.value.email }}</p>
    <!-- … les autres champs … -->
    <!-- Champ piège, à laisser invisible : seuls les robots le remplissent, et leur envoi est ignoré. -->
    <input v-model="form.trap.value" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true">
    <p v-if="form.error.value">{{ form.error.value }}</p>
    <button :disabled="form.pending.value">Envoyer</button>
  </form>
</template>
```

Types de champ acceptés : `text`, `textarea`, `number`, `boolean`, `select`, `date`. Un même visiteur ne peut pas
envoyer plus de cinq messages en dix minutes. Les messages sont conservés 365 jours (réglable :
`forms({ … }, { retentionDays: 90 })`).

Pour être prévenu par e-mail à chaque message : dans le back-office, **Workflows → Créer un workflow**, déclencheur
« Un formulaire du site est envoyé », action « Envoyer un e-mail » avec `{{ form.summary }}` dans le message et
`{{ fields.email }}` dans « Répondre à ».

### Protéger un formulaire des robots

Ajouter `turnstile()` aux modules, puis une ligne dans le formulaire, au-dessus du bouton :

```vue
<form @submit.prevent="form.submit()">
  <!-- … les champs … -->
  <CmsTurnstile />
  <p v-if="form.error.value">{{ form.error.value }}</p>
  <button :disabled="form.pending.value">Envoyer</button>
</form>
```

Le composant retrouve tout seul le formulaire de la page (`useCmsForm`) ; s'il y en a plusieurs, le préciser :
`<CmsTurnstile :form="devis" />`. Options : `theme` (`auto`, `light`, `dark`) et `size` (`flexible` par défaut,
`normal`, `compact`).

- Tant que le module n'est pas réglé, le composant n'affiche rien et le formulaire marche comme avant.
- Une fois réglé, le serveur refuse tout message sans jeton valable (vérifié auprès de Cloudflare avec l'adresse du
  visiteur) et affiche un message clair ; le champ piège et la limite d'envois restent en place.
- Le script de Cloudflare n'est chargé que sur les pages qui contiennent `<CmsTurnstile />`. Le jeton, valable
  cinq minutes et une seule fois, est redemandé tout seul à son expiration et après chaque envoi.
- Les clés se créent dans le tableau de bord Cloudflare, **Turnstile → Ajouter un widget** (domaine du site, mode
  « Géré »), et se saisissent dans **Modules → Anti-robots**. Pour essayer en local : clé du site
  `1x00000000000000000000AA` et clé secrète `1x0000000000000000000000000000000AA` (clés de test de Cloudflare, qui
  réussissent toujours ; à remplacer avant la mise en ligne).

La page de connexion du back-office n'utilise pas l'anti-robots : elle limite déjà les tentatives (8 échecs par
compte, 40 par adresse en 15 minutes), et une clé mal saisie pourrait sinon empêcher l'administrateur de se connecter
pour la corriger.

### Mesure d'audience

Ajouter `analytics()` aux modules, puis dans le tableau de bord Cloudflare :

1. **Web Analytics → Ajouter un site** (nom de domaine du site). Dans le code proposé, copier la valeur de `"token"` :
   c'est le *jeton de la balise*. Ne pas coller le code dans les pages : le core ajoute la balise tout seul.
2. Ouvrir les statistiques du site : l'adresse de la page contient `siteTag~in=` suivi de l'*identifiant du site*.
3. L'*identifiant du compte* (Account ID) : menu « ⋯ » du compte → « Copier l'ID du compte ».
4. **Profil → Jetons d'API → Créer un jeton personnalisé**, autorisation *Compte → Account Analytics → Lecture* :
   c'est le *jeton d'API*, qui ne sert qu'à lire les statistiques.

Saisir ces quatre valeurs dans **Modules → Mesure d'audience**, puis « Vérifier la connexion ». La balise est ajoutée
aux pages du site rendues par le serveur (jamais au back-office ni aux aperçus de brouillon) ; le cache du site est
vidé à l'enregistrement, elle apparaît donc tout de suite. Les statistiques sont relues au plus toutes les cinq minutes.

Si le site pose une politique de sécurité du contenu (en-tête `Content-Security-Policy`), y autoriser
`https://static.cloudflareinsights.com` (script) et `https://cloudflareinsights.com` (envoi des mesures), et pour
l'anti-robots `https://challenges.cloudflare.com` (script et cadre).

### Vendre des produits avec Stripe

**1. Rendre une collection vendable.** Il lui faut un champ prix de type nombre, saisi en euros avec les centimes
(`49.9`), commun à toutes les langues. Un prix vide ou nul : le produit n'est pas vendable.

```ts
import { stripe } from 'backoffice-core/modules'

collections: {
  products: collection({
    label: 'Boutique',
    titleField: 'title',
    fields: {
      title: f.text({ label: 'Nom du produit', required: true }),
      image: f.image({ label: 'Photo' }),
      price: f.number({ label: 'Prix', unit: '€ TTC', min: 0, step: 0.01 }),
      onSale: f.boolean({ label: 'En vente', default: true }),
    },
  }),
},
modules: [
  stripe({
    // Par collection vendable : le champ du prix, et au choix le nom (défaut : titleField), l'image,
    // l'interrupteur « en vente » et la quantité maximale par paiement (défaut : 10).
    collections: { products: { price: 'price', image: 'image', available: 'onSale', maxQuantity: 5 } },
    currency: 'eur',                          // défaut : 'eur'
    shipping: { countries: ['FR', 'BE'] },    // facultatif : demande l'adresse de livraison
    successPath: '/merci',                    // défaut : '/merci' ; Stripe y ajoute ?session_id=…
    // cancelPath: '/boutique',               // défaut : la page d'où l'acheteur est parti
  }),
],
```

La configuration est vérifiée au démarrage : collection et champs existants, prix de type nombre, etc. L'adresse e-mail
de l'acheteur est toujours demandée par Stripe.

**2. Brancher le bouton.** Le site n'envoie que le produit et la quantité : le serveur relit le prix **publié** (un
brouillon, un contenu retiré du site, sans prix ou « hors vente » est refusé), puis redirige vers Stripe.

```vue
<script setup lang="ts">
const { data: products } = await useCollection('products')
const { checkout, pending, error } = useCmsCheckout()
const quantity = ref(1)
</script>

<template>
  <div v-for="p in products" :key="p.id">
    <h2>{{ p.title }} — {{ p.price }} €</h2>
    <button v-if="p.price !== null && p.onSale" :disabled="pending" @click="checkout('products', p.id, { quantity })">Acheter</button>
  </div>
  <p v-if="error">{{ error }}</p>
</template>
```

**3. La page de succès** (`pages/merci.vue`). Elle ne doit pas annoncer un paiement confirmé avant Stripe : seul le
webhook le confirme, en général en quelques secondes.

```vue
<script setup lang="ts">
const { result, loading } = useCmsCheckoutResult()
</script>

<template>
  <p v-if="loading">Un instant…</p>
  <p v-else-if="result?.status === 'paid'">Merci ! Votre paiement de {{ result.amount }} est confirmé.</p>
  <p v-else>Merci ! Votre paiement est en cours de confirmation : vous recevrez un reçu par e-mail.</p>
</template>
```

**4. Régler Stripe** (back-office, **Modules → Stripe**, administrateur) :

- **Clé d'API** : tableau de bord Stripe, « Développeurs » → « Clés API » → « Créer une clé limitée », avec le seul droit
  « Écriture » sur « Checkout Sessions ». Elle commence par `rk_test_` (essais) ou `rk_live_`. La clé secrète `sk_…`
  fonctionne aussi mais donne tous les droits sur le compte.
- **Webhook** : « Développeurs » → « Webhooks » → « Créer une destination d'événements » → « Votre compte », format
  « Instantané » (snapshot), dernière version de l'API, type « Endpoint de webhook ». L'écran du module affiche
  l'adresse à coller (`https://votre-site/api/stripe/webhook`) et les événements à cocher :
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `charge.refunded`. Copiez ensuite le **secret de signature** (`whsec_…`) dans le back-office.
- « Vérifier la connexion » dit si la clé est de test ou de production.

Le paiement n'est enregistré qu'à la réception de l'événement signé de Stripe (jamais au simple retour du visiteur
sur la page de succès). Un même événement reçu deux fois n'enregistre qu'un paiement. Les paiements différés
(virement, prélèvement) apparaissent « En attente » puis « Payé » ou « Échoué » ; un remboursement fait dans Stripe
les passe à « Remboursé ». Un même visiteur ne peut pas créer plus de dix paiements en dix minutes.

Pour prévenir le client à chaque vente : **Workflows → Créer un workflow**, déclencheur « Un paiement est reçu »,
action « Envoyer un e-mail » avec `{{ payment.product }}`, `{{ payment.quantity }}`, `{{ payment.amount }}`,
`{{ payment.email }}`, `{{ payment.shipping }}` et `{{ payment.adminUrl }}`. Pour envoyer un reçu à l'acheteur,
mettre `{{ payment.email }}` dans les destinataires (ou activer les reçus dans Stripe : « Paramètres » → « E-mails clients »).

**5. Essayer en mode test.** Utilisez une clé `rk_test_…` et le webhook du mode test (chaque mode a son webhook et son
secret). En local, Stripe ne peut pas joindre `localhost` : la commande `stripe listen --forward-to
localhost:3000/api/stripe/webhook` de la CLI Stripe relaie les événements et affiche un secret `whsec_…` à saisir dans
le back-office. Cartes de test (date future, code quelconque) : `4242 4242 4242 4242` (accepté),
`4000 0000 0000 9995` (refusé), `4000 0025 0000 3155` (authentification 3D Secure). Les paiements de test sont rangés à
part dans l'écran « Paiements ». Passer en production : remplacer la clé et le secret du webhook par ceux du mode
production.

## Double authentification

En plus du mot de passe, un code à 6 chiffres donné par une application d'authentification (Google Authenticator,
Microsoft Authenticator, 2FAS, Aegis… : norme TOTP) est demandé à la connexion. Rien à installer ni à régler côté site.

- **Activer** (chacun, pour son compte) : « Mon compte » → « Activer la double authentification » → mot de passe →
  scanner le code QR (ou recopier la clé) → saisir un premier code. Dix **codes de secours** sont alors affichés une
  seule fois : les ranger ailleurs que sur le téléphone. Chacun remplace une fois le code de l'application ; on peut en
  créer de nouveaux (les anciens ne valent alors plus rien). À la connexion, « Se souvenir de cet appareil pendant
  30 jours » évite de ressaisir le code sur son propre ordinateur ; le mot de passe reste demandé.
- **Exiger** (administrateur) : « Utilisateurs » → « Double authentification » → obligatoire pour les administrateurs,
  ou pour tous les comptes. Il faut d'abord l'avoir activée sur son propre compte. Les comptes concernés sont conduits
  à l'activer à leur prochaine connexion et ne peuvent rien faire d'autre avant (le serveur refuse tout le reste).
- **Dépanner un compte** (téléphone perdu, codes de secours égarés) : un administrateur ouvre « Utilisateurs » →
  « Réinitialiser la double authentification » sur la ligne du compte. La personne se reconnecte avec son mot de passe
  et la réactive. Vérifier d'abord que la demande vient bien d'elle (un appel, pas un simple e-mail).
- « Mot de passe oublié » et « Nouveau mot de passe » changent le mot de passe, **pas** la double authentification :
  le code reste demandé.

### Procédure de secours : le dernier administrateur n'a plus ni téléphone ni codes

Il n'existe volontairement aucun moyen de passer outre depuis le site. C'est au développeur, qui a accès au compte
Cloudflare, de retirer la double authentification du compte directement dans la base (remplacer l'adresse, quatre fois) :

```sh
pnpm exec wrangler d1 execute DB --remote --command "DELETE FROM two_factor WHERE user_id IN (SELECT id FROM user WHERE email = 'vous@exemple.fr'); UPDATE user SET two_factor_enabled = 0 WHERE email = 'vous@exemple.fr'; DELETE FROM verification WHERE identifier LIKE 'trust-device-%' AND value IN (SELECT id FROM user WHERE email = 'vous@exemple.fr'); DELETE FROM cms_rate_limits WHERE key = 'login:email:vous@exemple.fr';"
```

L'adresse s'écrit en minuscules, telle qu'elle apparaît dans « Utilisateurs ». Le mot de passe n'est pas touché : la
personne se connecte avec lui, puis réactive la double authentification (aussitôt si le site l'exige). Pour essayer la
commande sur la base locale, remplacer `--remote` par `--local`.

La même commande sert, compte par compte, après un changement de `NUXT_AUTH_SECRET` : les clés des applications sont
chiffrées avec ce secret et les codes de secours hachés avec lui, ils ne sont donc plus vérifiables ensuite.
Pour tous les comptes d'un coup : `DELETE FROM two_factor; UPDATE user SET two_factor_enabled = 0;`.

## Mettre à jour le core

Le core n'est pas publié sur npm. Ce projet le référence ainsi dans `package.json` :

```json
"backoffice-core": "__CORE_SPEC__"
```

Après une mise à jour, toujours dans cet ordre :

```sh
pnpm db:migrate     # nouvelles tables en local, s'il y en a
pnpm typecheck
pnpm dev            # vérifier le site et le back-office
pnpm run deploy     # applique aussi les migrations en ligne
```

### Dépendance git

```json
"backoffice-core": "__CORE_GIT_SPEC__"
```

La partie après `#` est le numéro de version du core (une étiquette git, par exemple `v0.1.0`) ; `path:` désigne le
dossier du core dans le dépôt. Le site reste sur cette version tant qu'on ne change pas ce numéro. La version installée
est affichée en bas du menu du back-office.

Pour passer à une version plus récente, remplacer le numéro puis installer :

```sh
# dans package.json : …#v0.1.0&path:/packages/cms  →  …#v0.2.0&path:/packages/cms
pnpm install
```

Les versions disponibles sont les étiquettes du dépôt du core (`git ls-remote --tags` ou la page « Tags » sur GitHub).
On peut aussi suivre une branche (`#main&path:/packages/cms`, mise à jour par `pnpm update backoffice-core`), mais le
site change alors à chaque mise à jour des dépendances : à réserver aux essais.
Le dépôt étant privé, la machine doit y avoir accès (clé SSH ou identifiants git).

### Lien local

```json
"backoffice-core": "link:../back-office/packages/cms"
```

Le projet utilise directement le dossier du core présent sur la machine (chemin relatif à ce projet) : pratique tant que
le dépôt du core n'est pas poussé, ou pour corriger le core et voir le résultat tout de suite. Les dépendances du core
doivent être installées dans son propre dépôt (`pnpm install` là-bas). Il n'y a rien à mettre à jour : le site suit
l'état du dossier, y compris au moment du déploiement.

### Passer de l'un à l'autre

Remplacer la valeur de `backoffice-core` dans `package.json` par l'une des deux formes ci-dessus, puis :

```sh
pnpm install
pnpm db:migrate
```

Un projet livré à un client devrait utiliser la dépendance git : le lien local ne fonctionne que sur la machine où se
trouve le dossier du core.
