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
Le changer (`pnpm exec wrangler secret put NUXT_AUTH_SECRET`) déconnecte tous les utilisateurs.

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
