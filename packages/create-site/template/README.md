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
| `renovate.json`, `.github/workflows/` | Mises à jour du core et mises en ligne automatiques (voir « Mettre à jour le core ») |

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
useCmsSeo(article)                                                         // titre, description, carte de partage
</script>

<template>
  <CmsImage :media="article?.cover" sizes="(min-width: 48rem) 45rem, 100vw" />
</template>
```

### Cadrage des images

Dans la médiathèque, la personne qui gère le site clique sur une image pour dire où est le sujet (son **point
d'intérêt**). `<CmsImage>` s'en sert tout seul :

```vue
<!-- Recadrée par le navigateur (object-cover) : le sujet reste visible, rien à écrire de plus. -->
<CmsImage :media="article.cover" sizes="20rem" class="w-full aspect-[16/10] object-cover" />

<!-- Recadrée par le serveur aux proportions voulues, autour du sujet : le navigateur ne télécharge que la partie affichée. -->
<CmsImage :media="article.cover" ratio="1/1" sizes="12rem" class="w-full rounded-full" />
<CmsImage :media="article.cover" :width="400" :height="300" />
```

Proportions servies : `1/1`, `5/4`, `4/3`, `3/2`, `16/10`, `16/9`, `2/1`, `21/9`, `3/1`, et en hauteur `4/5`, `3/4`, `2/3`,
`9/16` ; une autre valeur est ramenée à la plus proche. Sans `<CmsImage>` : `cmsImageUrl(photo, 640, '1/1')` donne l'adresse
de l'image recadrée, et `cmsObjectPosition(photo)` la valeur CSS `object-position` à poser sur une balise `<img>` écrite à la
main (ou sur une image de fond : `background-position`). Le point lui-même est dans `photo.focus` (`{ x, y }` de 0 à 1, ou `null`).

Un contenu n'apparaît sur le site qu'une fois publié. Avec plusieurs langues, chaque fonction accepte `{ locale: 'en' }` ;
sans cette option, c'est la langue par défaut.

Pour ajouter un type de contenu : le déclarer dans `cms.config.ts` (le serveur de développement redémarre, le back-office
affiche le nouveau menu), puis créer la page dans `app/pages/`. Il n'y a pas de migration de base à écrire.

## Référencement

Un contenu déclaré avec `seo: true` (et un `path`) a un onglet « Référencement » dans le back-office : titre et
description pour les moteurs de recherche, titre et description propres au partage (facultatifs), image de partage,
« masquer des moteurs de recherche ». L'onglet montre l'aperçu du résultat Google et de la carte de partage, et une
liste de conseils ; l'écran « Référencement » du menu récapitule toutes les pages (état, points à voir, doublons).

Dans la page, une ligne suffit : `useCmsSeo(entry)` écrit le titre, la description, les balises de partage (`og:`,
`twitter:`), l'adresse canonique, les liens entre langues et, sur l'accueil, le nom du site pour Google.

Deux réglages du site, dans `cms.config.ts`, valent pour toutes les pages et sont repris par l'aperçu du back-office :

```ts
site: {
  name: 'Mon site', url: 'https://mon-site.fr', locales: ['fr'], defaultLocale: 'fr',
  titleSuffix: 'Mon site',        // « Titre de la page — Mon site » ; pas répété si le titre le contient déjà
  shareImage: '/partage.jpg',     // image de partage des pages qui n'en ont pas : fichier de public/, 1200 × 630 px
},
```

- Titre de référencement vide : le titre du contenu est utilisé (collections) ; pour une page unique, le suffixe seul.
- Titre et description de partage vides : ceux du référencement sont repris. Remplis, ils ne reçoivent pas le suffixe.
- Une page sans suffixe : `useCmsSeo(entry, { titleSuffix: false })`. Sans le bloc de données structurées de
  l'accueil (le site écrit déjà le sien) : `useCmsSeo(home, { structuredData: false })`.
- Les valeurs sont aussi dans `entry.seo` (`title`, `description`, `shareTitle`, `shareDescription`, `image`, `noindex`).
- Les seuils des conseils (longueurs, taille d'image…) sont regroupés et expliqués dans `shared/seo.ts` du core.

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
  Point d'intérêt d'une image (où se trouve le sujet, de 0 à 1 depuis la gauche et le haut) :
  `{ "file": "…", "focus": { "x": 0.3, "y": 0.2 } }`.
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
- `"slug"` fixe l'adresse de la page, `"seo": { "title", "description", "shareTitle", "shareDescription", "image", "noindex" }`
  le référencement (`shareTitle` et `shareDescription` : titre et description propres au partage, facultatifs).
- Les éléments sont **publiés** ; `"status": "draft"` sur un élément (ou à la racine du fichier), ou l'option `--draft`,
  les laisse en brouillon.
- **Anciennes adresses** (refonte d'un site) : une rubrique `"redirections"` à la racine du fichier, pour que les adresses
  de l'ancien site mènent aux nouvelles pages :
  `"redirections": [{ "from": "/nos-services.html", "to": "/services" }, { "from": "/droit-affaires.php", "to": { "page": "services", "id": "droit-des-affaires" } }]`.
  `to` est une adresse (`"/…"` ou `"https://…"`) ou une page du site (elle suit alors la page si son adresse change ;
  `"locale": "en"` pour une autre langue) ; `"status": 302` pour une redirection provisoire. Relancer l'import met à jour
  les redirections déjà présentes. Compte éditeur ou administrateur. Voir « Redirections » plus bas.

Le fichier peut aussi être un module (`cms.import.mjs` ou `.ts`) dont l'export par défaut est cet objet, ou une fonction
qui le renvoie : pratique pour le calculer à partir d'autres données. Le fichier est vérifié en entier avant le premier
envoi ; ensuite, une erreur sur un élément n'empêche pas d'importer les autres, et la commande se termine en erreur.

## Redirections et pages introuvables

Écran « Redirections » du back-office (administrateur et éditeur). Rien à écrire dans le site.

- **Quand l'adresse d'une page publiée change**, sa redirection se crée toute seule (elle figure dans la liste comme
  « Automatique »). **Pour une ancienne adresse d'un précédent site**, on l'ajoute à la main (« Ajouter »), en lot
  (« Importer une liste » : `ancienne adresse ; nouvelle adresse` par ligne, ou un fichier CSV à deux colonnes), ou par
  la rubrique `redirections` du fichier d'import ci-dessus.
- La destination est une **page du site** (la redirection suit la page si son adresse change) ou une **adresse libre**
  (`/chemin` ou `https://…`). Définitive (301, le cas habituel) ou provisoire (302).
- **Une redirection ne s'applique que si aucune page ne répond** à l'ancienne adresse : une page en ligne (ou une page
  `.vue` du site) passe toujours avant. Elle vaut pour toute adresse du site, y compris celles qu'aucune page ne gère.
- **Adresses exactes seulement** : pas de motif avec « * ». Pour comparer, le nom de domaine, les majuscules, la barre
  finale, les paramètres (`?…`) et l'encodage des accents ne comptent pas : `https://ancien.fr/Caf%C3%A9/?x=1` et `/café`
  sont la même ancienne adresse. Les paramètres de la demande sont recopiés sur la destination (`?utm_source=…`).
- Refusé, avec un message clair : une adresse du back-office ou technique (`/admin`, `/api`, `/media`, `/_…`,
  `sitemap.xml`, `robots.txt`), la page d'accueil, une redirection vers elle-même, une boucle, un doublon, l'adresse
  d'une page en ligne. Une **chaîne** (A → B alors que B → C) est signalée et aplatie sur demande (A → C) ; l'import
  en lot l'aplatit de lui-même et le dit.
- Si la page visée est supprimée ou retirée du site, la redirection attend (le visiteur voit la page 404, la liste le
  signale) et reprend à la restauration ou à la republication.
- **Pages introuvables** (second onglet) : les adresses demandées par des visiteurs sans rien trouver, avec le nombre de
  demandes et la page d'où ils venaient, et un bouton « Créer une redirection ». Aucune donnée personnelle n'est gardée
  (ni adresse IP, ni navigateur). Les balayages de robots (`/wp-login.php`, `/.env`…) ne sont pas comptés ; 500 adresses
  au plus sont conservées, et une adresse qui n'est plus demandée disparaît après 90 jours.

## Site en construction ou en maintenance

Écran **Disponibilité** du back-office (administrateurs) : le site passe **en construction** (site pas encore lancé)
ou **en maintenance** (« de retour bientôt »), puis revient **en ligne**, sans déploiement.

- Toutes les pages du site sont alors remplacées par une **page d'attente**, au choix parmi trois modèles (« Sobre »,
  « Image plein écran », « Couleur vive ») qui reprennent les couleurs de l'écran Apparence. On règle le titre et le
  message dans chaque langue (vides : un texte proposé), un contact (une adresse e-mail ou un numéro devient un bouton)
  et, pour le modèle image, une photo de la médiathèque. Un aperçu en direct montre la page pendant la saisie.
- **En construction** : réponse 200 marquée `noindex`, et `robots.txt` interdit l'exploration (sauf si le site a son
  propre `public/robots.txt`). **Maintenance** : réponse 503 avec `Retry-After` ; les moteurs de recherche
  comprennent que la coupure est temporaire et gardent les pages du site.
- **Ce qui reste servi** : le back-office, l'API (`/api/…`), les médias, les fichiers internes (`/_nuxt/…`) et toute
  adresse qui finit par une extension (`/robots.txt`, `/sitemap.xml`, `/favicon.ico`). Une route serveur du site qui
  sert une page HTML sans extension est remplacée comme les autres.
- **Voir le vrai site pendant la fermeture** : le mode aperçu (`/?preview=1` une fois connecté, ou un lien d'aperçu
  partagé, pour montrer le site à un client avant l'ouverture). Le back-office le rappelle par un bandeau « Site fermé ».
- La page d'attente est un document HTML autonome : elle n'utilise ni les pages ni les composants du site, et
  s'affiche même si une page du site est en erreur. Le changement d'état vide le cache du site et figure au journal
  d'activité.

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
Une fois les secrets du déploiement posés sur GitHub (voir « Mettre à jour le core »), c'est inutile : chaque fusion
sur `main` fait la même chose toute seule.
Attention : `pnpm deploy` (sans `run`) est une autre commande, propre à pnpm.

### Nom de domaine

Dans le tableau de bord Cloudflare : Workers, `__ID__`, Réglages, Domaines et routes. Puis renseigner l'adresse dans
`cms.config.ts` (`site.url`) et redéployer : elle sert aux adresses canoniques, aux aperçus et aux e-mails.

### Envoi d'e-mails (facultatif)

Les e-mails du back-office (workflows, lien de nouveau mot de passe, notifications des formulaires) partent par Brevo
(`brevo()`) ou par Resend (`resend()`), selon le module déclaré dans `cms.config.ts`. Le plus simple : dans le
back-office, **Modules → Brevo** (ou **Resend**), coller la clé d'API et l'expéditeur, puis « Vérifier la connexion ».
La clé est enregistrée chiffrée et ne peut plus être relue ensuite. Si les deux modules sont déclarés, c'est le premier
réglé, dans l'ordre de `cms.config.ts`, qui envoie.

Avec Resend, le domaine de l'expéditeur doit être ajouté et vérifié dans Resend (« Domains ») ; avec une clé « Full
access », « Vérifier la connexion » contrôle aussi ce domaine. Une clé « Sending access » suffit pour envoyer.

On peut aussi les poser dans l'hébergement ; ce qui est saisi dans le back-office passe avant :

```sh
pnpm exec wrangler secret put NUXT_BREVO_API_KEY
pnpm exec wrangler secret put NUXT_RESEND_API_KEY  # ou celle-ci, avec resend()
pnpm exec wrangler secret put NUXT_EMAIL_FROM     # « Nom du site <contact@exemple.fr> », expéditeur validé dans Brevo ou Resend
```

Les clés saisies dans le back-office sont chiffrées avec `NUXT_AUTH_SECRET` : si ce secret change, il faut les saisir
à nouveau.

## Modules

Un module ajoute une fonction au site. L'écran **Modules** du back-office (administrateurs) les montre tous, rangés
par famille, avec un interrupteur « Activé » : on active ce dont on a besoin, puis on le règle. Un module déclaré dans
`cms.config.ts` est activé tant que personne ne le désactive dans le back-office ; un module non déclaré est désactivé
tant que personne ne l'active. Désactiver un module garde ses réglages, et on peut régler un module avant de l'activer.

Les formulaires (`forms`) et le paiement (`stripe`) ont besoin d'être décrits dans le code (les champs des formulaires,
les collections vendues) : ils ne s'activent dans le back-office qu'une fois déclarés dans `cms.config.ts`, et on peut
ensuite les y désactiver. Les autres modules n'ont pas besoin du code ; les déclarer sert à les avoir activés d'office :

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
| `resend()` | L'envoi des e-mails par Resend, à la place de Brevo. Réglages : clé d'API, expéditeur (domaine vérifié dans Resend). |
| `forms({ … })` | Des formulaires pour le site. Chaque message est validé par le serveur, enregistré, visible dans « Messages reçus » (administrateurs et éditeurs) et peut déclencher un workflow. |
| `stripe({ … })` | Le paiement en ligne d'un produit à prix fixe, sur la page de paiement de Stripe. Le prix vient du back-office. Paiements visibles dans « Paiements » (administrateurs et éditeurs). Réglages : clé d'API, secret du webhook. |
| `analytics()` | La fréquentation du site dans l'écran « Audience » (administrateurs et éditeurs) : visites, pages vues, courbe par jour, pages les plus vues, sites d'origine. Par Cloudflare Web Analytics, sans cookie ni bandeau de consentement. Réglages : jeton de la balise, identifiant du site, identifiant du compte, jeton d'API en lecture. |
| `plausible()` | La même chose par Plausible (plausible.io ou votre propre instance), sans cookie. Réglages : domaine du site, clé « Stats API », adresse de l'instance (facultative). `analytics({ provider: 'plausible' })` revient au même. |
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

Deux fournisseurs, sans cookie : **Cloudflare Web Analytics** (`analytics()`) et **Plausible** (`plausible()`), à
activer dans l'écran Modules. Chaque module de mesure actif ajoute sa balise aux pages ; l'écran « Audience » lit le
premier qui est réglé.

**Plausible.** Dans Plausible, « Add a website » avec le nom de domaine du site, puis dans les réglages du compte,
« API Keys » → « New API Key », type *Stats API*. Saisir le domaine et la clé dans **Modules → Plausible** (et, pour
une instance hébergée par vos soins, son adresse), puis « Vérifier la connexion ». Avec une politique de sécurité du
contenu, autoriser l'adresse de Plausible (script et envoi des mesures).

**Cloudflare Web Analytics.** Dans le tableau de bord Cloudflare :

1. **Web Analytics → Ajouter un site** (nom de domaine du site). Dans le code proposé, copier la valeur de `"token"` :
   c'est le *jeton de la balise*. Ne pas coller le code dans les pages : le core ajoute la balise tout seul.
2. Ouvrir les statistiques du site : l'adresse de la page contient `siteTag~in=` suivi de l'*identifiant du site*.
3. L'*identifiant du compte* (Account ID) : menu « ⋯ » du compte → « Copier l'ID du compte ».
4. **Profil → Jetons d'API → Créer un jeton personnalisé**, autorisation *Compte → Account Analytics → Lecture* :
   c'est le *jeton d'API*, qui ne sert qu'à lire les statistiques.

Saisir ces quatre valeurs dans **Modules → Cloudflare Web Analytics**, puis « Vérifier la connexion ». La balise est ajoutée
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

## Sauvegardes

### Ce qui est fait tout seul

Chaque nuit, le back-office écrit une **copie de la base** dans le stockage du site (bucket `__BUCKET__`, dossier
`_sauvegardes/`). Ce dossier n'est jamais servi par le site : seul un administrateur peut télécharger une sauvegarde,
depuis l'écran **Sauvegardes** du back-office. On y voit la liste, l'état de la dernière sauvegarde automatique
(une alerte s'affiche si elle a échoué ou date de plus de 48 heures), le bouton « Sauvegarder maintenant » et « Restaurer ».

| | |
| --- | --- |
| Contenu | Toutes les tables de la base : contenus, historique, médiathèque (fiches et dossiers), comptes, rôles, réglages, workflows et leur journal, messages reçus, paiements. Les tables ajoutées par une mise à jour du core y entrent sans rien changer. |
| Laissé de côté | Les connexions en cours (`session`), les liens à usage unique (`verification`, `cms_invites`), les compteurs de tentatives de connexion. |
| Secrets | Les mots de passe (déjà hachés) et tout jeton sont **chiffrés avec `NUXT_AUTH_SECRET`** ; les clés d'API des modules le sont déjà dans la base. Un fichier de sauvegarde seul ne permet donc ni de se connecter ni de lire une clé. |
| Durée | 30 jours (`NUXT_BACKUP_RETENTION_DAYS` pour en changer, dans `vars` de `wrangler.jsonc`) ; les trois plus récentes sont toujours gardées. |
| Format | Un fichier `.ndjson.gz` : du texte compressé, une valeur JSON par ligne (`gunzip -c fichier | less`). |
| Fichiers (images, PDF) | **Pas dans la sauvegarde** : ils sont dans le même stockage R2. Voir « Les fichiers » plus bas. |

Le déclenchement vient du déclencheur `"17 3 * * *"` de la ligne `"triggers"` de `wrangler.jsonc` (3 h 17, heure universelle) :
rien à écrire dans le site. L'heure se change librement ; le core ne fait de toute façon qu'une sauvegarde par jour.
L'autre déclencheur de cette ligne (`"*/5 * * * *"`, voir « Publication programmée ») ne fait pas de sauvegarde, sauf
pour rattraper celle de la nuit si elle a plus de 26 heures de retard.
Sans cette ligne, une sauvegarde se fait quand un administrateur ouvre le back-office, au plus une fois par jour, et
l'écran « Sauvegardes » signale que la sauvegarde de nuit n'est pas activée.

Pour être prévenu par e-mail : créer un workflow avec le déclencheur **« Une sauvegarde a échoué »** (variables
`{{ backup.error }}`, `{{ backup.date }}`, `{{ backup.adminUrl }}`). « Une sauvegarde est faite » existe aussi.

En local : `curl -X POST localhost:3000/_cms/dev-scheduled` joue le déclencheur planifié (`pnpm dev` seulement).

### Revenir en arrière

**Depuis le back-office** (écran Sauvegardes, « Restaurer », en écrivant le mot demandé) : les **contenus et les réglages**
reviennent à l'état de la sauvegarde, en une seule opération qui réussit en entier ou ne change rien. L'état d'avant est
sauvegardé juste avant (« Avant restauration ») : une restauration se défait en restaurant celle-là. Les **comptes ne sont
pas touchés** (chacun garde son accès et son mot de passe, personne n'est déconnecté, les comptes créés depuis restent),
et les fichiers ajoutés à la médiathèque depuis restent visibles. Limite : une sauvegarde de plus de 25 Mo une fois
décompressée ne se restaure pas d'ici, il faut passer par l'une des deux méthodes suivantes.

**Avec Cloudflare (D1 Time Travel)** : la base entière, comptes compris, à la minute près, sur les 30 derniers jours
(7 jours avec l'offre gratuite de Workers). À utiliser après une erreur récente, ou quand la base est trop grosse.
La base est remplacée sur place, connexions comprises.

```sh
pnpm exec wrangler d1 time-travel info __ID__ --timestamp 2026-11-20T08:30:00Z     # le repère de cet instant
pnpm exec wrangler d1 time-travel restore __ID__ --timestamp 2026-11-20T08:30:00Z  # noter le repère affiché : il permet d'annuler
```

Time Travel ne remonte pas au-delà de sa durée, ne fait pas de copie à emporter et ne concerne pas les fichiers :
c'est pour cela que les sauvegardes ci-dessus existent en plus.

**Avec un fichier de sauvegarde** (tout, comptes compris, même après la perte de la base) : télécharger la sauvegarde
depuis le back-office, ou la prendre dans le bucket (`pnpm exec wrangler r2 object get __BUCKET__/_sauvegardes/<nom> --remote --file sauvegarde.ndjson.gz`), puis :

```sh
NUXT_AUTH_SECRET=<le secret du site> pnpm cms:export --from sauvegarde.ndjson.gz --out restauration
pnpm exec wrangler d1 migrations apply DB --remote                      # seulement si la base vient d'être recréée
pnpm exec wrangler d1 execute DB --remote --file restauration/restauration.sql
```

Le fichier SQL **remplace** le contenu de la base. Sans `NUXT_AUTH_SECRET`, les mots de passe ne sont pas repris :
chacun en choisit un nouveau (« Mot de passe oublié » ou nouvelle invitation). Essayer d'abord avec `--local`.
**Garder `NUXT_AUTH_SECRET` ailleurs que chez Cloudflare** (gestionnaire de mots de passe) : sans lui, ni les mots de
passe ni les clés des modules d'une sauvegarde ne sont récupérables.

### Remettre ses données à un client

```sh
CMS_EMAIL=admin@exemple.fr NUXT_AUTH_SECRET=<le secret du site> pnpm cms:export --url https://monsite.fr --out export-client
```

La commande se connecte avec un compte administrateur, fait une sauvegarde fraîche, la télécharge avec tous les fichiers
de la médiathèque, et écrit un dossier à remettre tel quel : `sauvegarde.ndjson.gz`, `restauration.sql`, `fichiers/`,
`fichiers.json` (nom, type et adresse de chaque fichier), `envoyer-fichiers.sh` et `LISEZMOI.txt`, qui donne les trois
commandes de réimport dans un site neuf (`wrangler d1 migrations apply`, `wrangler d1 execute --file`, envoi des fichiers
dans R2). Les clés d'API des modules ne sont pas lisibles ailleurs : le client saisit les siennes dans « Modules ».

### Les fichiers (ce qui relève de l'hébergement)

Ce que R2 garantit déjà : chaque fichier est conservé en plusieurs exemplaires (durabilité annoncée : 99,999999999 % par an).
Ce qu'il ne fait pas : **R2 n'a pas de versions d'objets ni de corbeille** ; un fichier supprimé ou écrasé l'est pour de
bon. Le back-office ne réécrit jamais un fichier (chaque envoi a sa propre adresse) ; reste la suppression. Selon
l'engagement pris avec le client, régler chez Cloudflare :

- **Ne jamais ouvrir le bucket au public** (adresse `r2.dev` ou domaine personnalisé) : c'est le site qui sert les
  fichiers, et le dossier `_sauvegardes/` deviendrait lisible par tous.
- **Sauvegardes dans un bucket à part** : déclarer un second bucket avec la liaison `BACKUPS` dans `r2_buckets`
  (`{ "binding": "BACKUPS", "bucket_name": "__BUCKET__-sauvegardes" }`) ; le core l'utilise dès qu'elle existe.
- **Empêcher l'effacement des sauvegardes récentes** (erreur de manipulation, compte compromis) :
  `pnpm exec wrangler r2 bucket lock add __BUCKET__ --name sauvegardes --prefix _sauvegardes/ --retention-days 7`.
  Garder ce délai inférieur à la durée de conservation. Ne pas verrouiller tout le bucket : le back-office ne pourrait
  plus supprimer un fichier de la médiathèque.
- **Copie des fichiers ailleurs** : `pnpm cms:export` de temps en temps (il télécharge tout), ou une synchronisation
  du bucket vers un autre stockage avec un outil comme `rclone`.

Offre Cloudflare : la sauvegarde demande l'offre payante de Workers dès que le site a un peu de contenu
(l'offre gratuite limite chaque exécution à 10 ms de calcul).

## Publication programmée

Dans le formulaire d'un contenu, « Programmer… » (à côté de « Publier ») met en ligne un brouillon — ou les
modifications en attente d'un contenu déjà publié — à une date et une heure, ou retire un contenu du site (une offre,
un événement passé). L'écran **Programmé** du back-office liste tout ce qui est prévu ; les listes affichent le statut
« Programmé ».

- **L'heure est celle du site**, pas celle de l'ordinateur de la personne : par défaut l'heure de Paris. Pour un autre
  fuseau, `site: { …, timeZone: 'Indian/Reunion' }` dans `cms.config.ts`. L'interface rappelle toujours le fuseau.
- **Par langue** : la fenêtre coche d'office toutes les langues prêtes.
- **C'est le brouillon tel qu'il est à l'heure dite** qui part en ligne : on peut le corriger jusqu'au dernier moment.
  Tant qu'une mise en ligne est programmée, seule une personne qui peut publier peut encore modifier le contenu.
- **Mêmes règles qu'une publication à la main** : seul qui peut publier peut programmer ; les champs sont vérifiés
  au moment de programmer puis au moment de publier ; l'action est faite au nom de la personne qui a programmé, avec
  ses droits du jour. Si le contenu n'est plus complet, ou si cette personne ne peut plus publier, rien n'est mis en
  ligne : l'échec s'affiche dans le formulaire, dans l'écran « Programmé » et au journal d'activité. Pour en être prévenu
  par e-mail : workflow avec le déclencheur **« Une publication programmée a échoué »** (variables
  `{{ entry.title }}`, `{{ schedule.date }}`, `{{ schedule.error }}`, `{{ entry.adminUrl }}`).
- Publier ou retirer à la main annule la programmation correspondante ; un contenu supprimé perd la sienne (il ne la
  retrouve pas s'il est restauré) ; une copie n'en hérite pas. Les contenus sans brouillons (`drafts: false`) ne se
  programment pas : ce qui y est enregistré est en ligne tout de suite.

**Exécution.** Le déclencheur `"*/5 * * * *"` de `wrangler.jsonc` réveille le site toutes les 5 minutes : une mise en
ligne se fait donc à l'heure dite, à 5 minutes près, et le cache du site est vidé à ce moment-là. Si ce déclencheur
manque ou a du retard, rien n'est perdu : la première visite du site (ou du back-office) après l'heure prévue exécute ce
qui est dû avant de répondre, et les pages ne sont jamais gardées en cache au-delà de la prochaine échéance. Sans
déclencheur, l'heure exacte dépend donc du passage d'un visiteur ; l'écran « Programmé » le signale à l'administrateur.

En local : `curl -X POST localhost:3000/_cms/dev-scheduled -H 'content-type: application/json' -d '{"cron":"*/5 * * * *"}'`
joue ce déclencheur.

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

La version installée est affichée en bas du menu du back-office. Un administrateur y voit aussi, quand il y en a une,
« la x.y.z est disponible » avec un lien vers les notes de version (le serveur pose la question à GitHub une fois par
jour au plus ; pour retirer cet avis : `runtimeConfig: { cmsUpdateCheck: false }` dans `nuxt.config.ts`).

### Ce qui est automatique

Avec la dépendance git et les trois fichiers fournis (`renovate.json`, `.github/workflows/verifier.yml`,
`.github/workflows/deployer.yml`), une fois les réglages ci-dessous faits :

1. **Une demande de fusion s'ouvre** dans ce dépôt quand une version du core sort : « Mise à jour : backoffice-core
   v0.5.0 → v0.5.1 », avec les notes de la version. Renovate passe toutes les quelques heures. Il ne touche qu'au
   core : les autres dépendances restent sous votre main.
2. **Le site est vérifié** sur cette demande, comme sur toutes les autres : installation stricte
   (`pnpm install --frozen-lockfile`), migrations sur une base vide, types, construction.
3. **Un correctif (`x.y.Z`) est fusionné tout seul** si les vérifications passent. Une version mineure ou majeure
   attend votre relecture : lisez la rubrique « À faire dans votre site » de ses notes, puis fusionnez.
4. **Chaque fusion sur `main` met le site en ligne** : construction, migrations de la base en ligne, puis déploiement.

### À faire une fois, à la main

1. Pousser le projet sur GitHub (branche `main`), **avec `pnpm-lock.yaml`**.
2. Autoriser Renovate sur le dépôt : <https://github.com/apps/renovate> → *Configure* → ajouter ce dépôt (rien à faire
   si l'application est déjà autorisée sur tous vos dépôts). `renovate.json` étant déjà là, il n'y a pas d'autre
   réglage. Tant que le dépôt du core est privé, Renovate doit aussi être autorisé sur lui pour y lire les versions.
3. Poser deux secrets : dépôt GitHub → *Settings → Secrets and variables → Actions → New repository secret*
   (ou `gh secret set <NOM>`).

   | Secret | Valeur |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | Identifiant du compte Cloudflare qui héberge le site (tableau de bord, menu « ⋯ » du compte → « Copier l'ID du compte ») |
   | `CLOUDFLARE_API_TOKEN` | Un jeton d'API limité à ce compte, créé pour ce site |

   Le jeton : de préférence un **jeton du compte** (*Gérer le compte → Jetons d'API du compte*), qui ne dépend pas d'une
   personne ; à défaut un jeton personnel (*Mon profil → Jetons d'API*). Droits, limités à ce seul compte :

   - *Compte → Workers Scripts → Modifier* : déployer le Worker ;
   - *Compte → D1 → Modifier* : appliquer les migrations ;
   - *Compte → Paramètres du compte → Lecture* ;
   - *Zone → Workers Routes → Modifier*, seulement si `wrangler.jsonc` déclare le nom de domaine (`routes`).

   Le modèle de jeton « Modifier Cloudflare Workers » proposé par Cloudflare ne contient **pas** D1 : sans ce droit,
   l'étape des migrations échoue. Si un déploiement est refusé pour une question de droits, partir de ce modèle et y
   ajouter *D1 → Modifier*.

Le secret `NUXT_AUTH_SECRET` et les réglages faits dans le back-office restent chez Cloudflare : le déploiement
automatique ne les touche pas. Tant que la base n'est pas créée (`database_id` à zéro dans `wrangler.jsonc`), le flux
de déploiement ne fait rien ; une fois la base créée, il **échoue** tant que les deux secrets manquent, pour qu'une
fusion non déployée ne passe pas inaperçue.

### Ce qui reste manuel

- La première mise en ligne (ci-dessus, « Mettre en ligne »).
- Relire et fusionner les versions mineures et majeures, et faire ce que leurs notes demandent dans le site.
- En local, après une mise à jour : `git pull`, `pnpm install`, `pnpm db:migrate`.
- Mettre à jour les autres dépendances (Nuxt, Tailwind…), quand vous le décidez.
- Mettre à jour sans attendre Renovate : remplacer le numéro dans `package.json`
  (`…#v0.5.0&path:/packages/cms` → `…#v0.5.1&path:/packages/cms`), `pnpm install`, vérifier, pousser.

### Si une mise en ligne échoue

Le flux « Déployer » apparaît en rouge dans l'onglet *Actions* et **ouvre un ticket** (« issue ») « La mise en ligne a
échoué » dans ce dépôt : GitHub prévient par e-mail les personnes qui suivent le dépôt (son propriétaire, par défaut).
Tant que le site n'est pas à jour, son back-office continue aussi d'afficher « la x.y.z est disponible ».

| Étape en échec | État du site | Que faire |
| --- | --- | --- |
| Installation ou construction | Inchangé : ancien code, ancienne base | Corriger, pousser |
| Migrations | Ancien code. La migration en échec est annulée par Cloudflare ; celles qui la précédaient dans la même mise à jour restent appliquées | Lire l'erreur dans le journal du flux, corriger, puis relancer le flux (*Re-run jobs*) |
| Déploiement | Ancien code sur une base déjà à niveau | Relancer le flux |

Le nouveau code n'est jamais en ligne avant sa base. L'inverse (ancien code sur une base plus récente) ne dure que le
temps de relancer le flux, et les migrations du core sont faites pour que l'ancien code continue de marcher : elles
ajoutent des tables et des colonnes, elles n'en retirent pas.

### Revenir en arrière

- **Tout de suite** : `pnpm exec wrangler rollback` (ou tableau de bord Cloudflare → le Worker → *Déploiements* →
  *Rollback*) remet en ligne le code précédent. La base n'est pas modifiée.
- **Durablement** : sur GitHub, ouvrir la demande de fusion de la mise à jour et cliquer *Revert*, puis fusionner : le
  site est redéployé avec l'ancienne version du core. Sinon la prochaine mise en ligne ramènerait la nouvelle.
- **Refuser une version** : fermer sa demande de fusion sans la fusionner. Renovate ne la reproposera pas ; il
  proposera la suivante.
- **La base** : une migration appliquée n'est pas défaite par un retour en arrière du code. En dernier recours,
  Cloudflare garde l'état de la base minute par minute (7 jours sur l'offre gratuite, 30 sur l'offre payante) :
  `pnpm exec wrangler d1 time-travel restore __ID__ --timestamp=<date>`. Attention : tout ce qui a été saisi dans le
  back-office depuis cette date est perdu.

### Autre voie pour le déploiement : Workers Builds

Cloudflare peut construire et déployer lui-même à chaque fusion, sans jeton dans GitHub : tableau de bord → le Worker →
*Réglages → Builds → Connecter* (le nom du Worker doit être celui de `wrangler.jsonc`). Régler alors :

- commande de construction : `pnpm exec nuxt build` ;
- commande de déploiement : `pnpm exec wrangler d1 migrations apply DB --remote && pnpm exec wrangler deploy` ;
- jeton d'API : un jeton **personnel** auquel on a ajouté *D1 → Modifier* (le jeton que Cloudflare crée tout seul n'a
  pas ce droit, et les jetons de compte ne sont pas acceptés ici).

Puis **supprimer `.github/workflows/deployer.yml`**, pour ne pas déployer deux fois. Cette voie n'est pas celle du
modèle : elle demande plus de clics par site, lie le déploiement au compte d'une personne, et un échec n'est signalé
que sur GitHub (pastille sur le commit), pas par e-mail.

### Dépendance git

```json
"backoffice-core": "__CORE_GIT_SPEC__"
```

La partie après `#` est le numéro de version du core (une étiquette git, par exemple `v0.1.0`) ; `path:` désigne le
dossier du core dans le dépôt. Le site reste sur cette version tant que ce numéro ne change pas. Les versions et
leurs notes sont sur la page « Releases » du dépôt du core.

On peut aussi suivre une branche (`#main&path:/packages/cms`, mise à jour par `pnpm update backoffice-core`), mais le
site change alors à chaque mise à jour des dépendances, et Renovate ne propose plus rien : à réserver aux essais.

### Lien local

```json
"backoffice-core": "link:../back-office/packages/cms"
```

Le projet utilise directement le dossier du core présent sur la machine (chemin relatif à ce projet) : pratique pour
corriger le core et voir le résultat tout de suite. Les dépendances du core doivent être installées dans son propre
dépôt (`pnpm install` là-bas). Il n'y a rien à mettre à jour : le site suit l'état du dossier, y compris au moment du
déploiement. Les vérifications et le déploiement automatiques ne fonctionnent pas avec un lien local (GitHub n'a pas
ce dossier) : la mise en ligne se fait alors par `pnpm run deploy`.

### Passer de l'un à l'autre

Remplacer la valeur de `backoffice-core` dans `package.json` par l'une des deux formes ci-dessus, puis :

```sh
pnpm install
pnpm db:migrate
```

Un projet livré à un client devrait utiliser la dépendance git : le lien local ne fonctionne que sur la machine où se
trouve le dossier du core.
