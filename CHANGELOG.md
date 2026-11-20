# Notes de version

Ce fichier dit, version par version, ce qui change pour un site qui utilise `backoffice-core`. Il est écrit pour la
personne qui met le site à jour : la rubrique **« À faire dans votre site »** liste ce qu'une version lui demande.
Sans cette rubrique, il n'y a rien à faire d'autre que mettre à jour et déployer (les migrations de base sont
appliquées par le déploiement).

Numéros : `x.y.Z` corrige sans rien changer pour les sites ; `x.Y.0` ajoute des fonctions, les sites existants
continuent de marcher ; `X.0.0` demande d'adapter les sites.

## À venir

<!-- Notez ici chaque changement au fil de l'eau, du point de vue de la personne qui met son site à jour.
     Rubriques possibles : ### Nouveautés, ### Correctifs, ### À faire dans votre site (action demandée au développeur). -->

### Nouveautés

- **Publication programmée.** Dans le formulaire d'un contenu, « Programmer… » met en ligne un brouillon (ou les
  modifications en attente d'un contenu publié) à une date et une heure, ou retire un contenu du site. L'heure est
  celle du site (heure de Paris par défaut, `site.timeZone` dans `cms.config.ts` pour un autre fuseau) et l'interface
  le rappelle. C'est le brouillon tel qu'il est à l'heure dite qui part en ligne, avec les mêmes vérifications et les
  mêmes droits qu'une publication à la main ; un échec (contenu devenu incomplet, droit retiré) s'affiche dans le
  formulaire et au journal d'activité, et peut déclencher le workflow « Une publication programmée a échoué ».
  Statut « Programmé » dans les listes, écran « Programmé » pour tout voir. Les contenus sans brouillons ne se
  programment pas.
- Les pages du site ne sont plus gardées en cache au-delà de la prochaine mise en ligne ou du prochain retrait programmés.
- **Point d'intérêt des images.** Dans la médiathèque, on clique sur une image pour dire où est le sujet (un visage, un
  produit) ; le point se déplace à la souris, au doigt ou au clavier, et des aperçus montrent le résultat en carré, en
  paysage, en portrait et en bandeau. Le réglage vaut partout où l'image est utilisée. `<CmsImage>` le transmet au
  navigateur : une image recadrée en CSS (`object-cover`) ne coupe plus son sujet, sans rien changer au site. Les
  vignettes du back-office en profitent aussi. Avec une balise `<img>` écrite à la main : `cmsObjectPosition(photo)`.
- **Recadrage par le serveur.** `<CmsImage :media="photo" ratio="1/1" />` (ou `:width` et `:height` ensemble) sert une
  image recadrée à ces proportions autour du point d'intérêt, dans toutes les largeurs du `srcset` : le navigateur ne
  télécharge que la partie affichée. Aussi : `cmsImageUrl(photo, 640, '16/9')`. Les proportions servies forment une
  liste fermée (voir le README du site) ; l'adresse d'une image recadrée contient le point d'intérêt, donc un nouveau
  réglage se voit tout de suite, sans attendre l'expiration d'un cache.
- L'objet d'une image lu par le site (type `Media`) contient `focus` (`{ x, y }` de 0 à 1, ou `null`).
- Outil d'import : `"focus": { "x": 0.3, "y": 0.2 }` à côté de `"file"` et `"alt"`.
- Le réglage du point d'intérêt figure au journal d'activité.
- **Référencement assisté.** L'onglet Référencement d'un contenu montre, pendant la saisie, l'aperçu du résultat
  Google (ordinateur et téléphone, titre coupé comme le fait Google) et celui de la carte de partage (réseaux sociaux,
  messageries), tels que le site les affichera : titre du contenu quand le titre de référencement est vide, suffixe du
  site, image par défaut. À côté, une courte liste de conseils en clair : titre ou description absent, trop long, trop
  court ou identique à celui d'une autre page (nommée), image de partage absente, trop petite ou mal proportionnée,
  images du contenu sans texte alternatif (avec un lien vers la médiathèque), page publiée mais masquée, adresse peu
  lisible, texte très court. Ce sont des repères : rien n'empêche de publier.
- **Titre et description de partage distincts** (facultatifs) : vides, ils reprennent ceux du référencement. Le site
  les reçoit dans `entry.seo.shareTitle` et `entry.seo.shareDescription` ; `useCmsSeo` les applique aux balises `og:`
  et `twitter:`. Aucune migration : un contenu existant les a simplement vides. L'API d'écriture et l'outil d'import
  acceptent `"seo": { "shareTitle": "…", "shareDescription": "…" }`.
- **Écran « Référencement »** (menu Site, pour qui peut modifier des contenus) : toutes les pages du site avec leur
  titre, leur description, leur état (complet, à améliorer, masqué) et leurs points à voir ; filtres, recherche, tri,
  et chaque ligne ouvre l'onglet Référencement du contenu dans la bonne langue. Pratique après une refonte.
- **Réglages du site pour le référencement**, dans `cms.config.ts` : `site.titleSuffix` (fin du titre de chaque page)
  et `site.shareImage` (image de partage des pages qui n'en ont pas). `useCmsSeo(entry)` les applique sans option.
- `useCmsSeo` écrit aussi les balises `twitter:title`, `twitter:description` et `twitter:image` (mêmes valeurs que les
  balises `og:`), et, sur la page d'accueil seulement, un bloc de données structurées `WebSite` qui donne à Google le
  nom du site (`site.name`). Pour s'en passer : `useCmsSeo(home, { structuredData: false })`.
- `/admin/media?file=<identifiant>` ouvre directement la fiche d'un fichier de la médiathèque.

### Correctifs

- Le suffixe du titre n'est plus répété quand le titre le contient déjà (« Cabinet Durand, avocats — Cabinet Durand »).
- Sur téléphone, l'image de partage choisie ne fait plus déborder l'onglet Référencement.

### À faire dans votre site

- **Ajouter le déclencheur des publications programmées** dans `wrangler.jsonc`, à côté de celui des sauvegardes :
  `"triggers": { "crons": ["17 3 * * *", "*/5 * * * *"] }`, puis déployer. Sans lui, la fonction marche quand même,
  mais une mise en ligne programmée attend la première visite du site après l'heure prévue (l'écran « Programmé »
  le signale). La sauvegarde reste celle de la nuit : le déclencheur fréquent n'en fait pas d'autre.
- Si une collection ou une page unique de votre `cms.config.ts` s'appelle `scheduled`, renommez-la : ce nom est
  désormais celui d'un écran du back-office.
- À savoir : un `<CmsImage>` qui recevait à la fois `width` et `height` est maintenant recadré
  par le serveur à ces proportions (avant, l'image entière était servie et le navigateur la déformait ou la recadrait
  selon le CSS du site).
Rien d'obligatoire : un site qui ne change rien garde ses balises (les balises `twitter:` et, sur l'accueil, le bloc
`WebSite` s'y ajoutent). Pour profiter des nouveautés :
- **Suffixe du titre** : déclarer `titleSuffix: 'Nom du site'` dans `site` (`cms.config.ts`) et retirer l'option des
  pages (`useCmsSeo(entry, { titleSuffix: … })` devient `useCmsSeo(entry)`). Tant que l'option reste dans les pages,
  tout marche comme avant, mais l'aperçu du back-office ne connaît pas ce suffixe. Si les titres saisis contiennent
  déjà le nom du site, il n'est pas ajouté une seconde fois : ils peuvent être raccourcis ensuite, page par page.
  Une page unique sans titre de référencement a désormais ce texte pour titre. Pour une page sans suffixe :
  `useCmsSeo(entry, { titleSuffix: false })`.
- **Image de partage par défaut** : placer une image de 1200 × 630 px dans `public/` et déclarer
  `shareImage: '/partage.jpg'` dans `site`.
- Un site qui écrit déjà ses propres données structurées `WebSite` sur l'accueil : passer `structuredData: false`.
- `seo` devient un identifiant réservé (écran `/admin/seo`) : une collection ou une page unique ne peut plus s'appeler ainsi.

## 0.6.0 — 2026-11-19

### Nouveautés

- **Avis de nouvelle version.** En bas du menu du back-office, un administrateur voit « Version 0.5.0 — la 0.5.1 est
  disponible », avec un lien vers les notes de version. Le serveur interroge GitHub une fois par jour au plus ; sans
  réponse, rien ne s'affiche et rien ne ralentit. Pour désactiver l'avis : `runtimeConfig: { cmsUpdateCheck: false }`
  dans `nuxt.config.ts`, ou la variable `NUXT_CMS_UPDATE_CHECK=false`.
- **Mises à jour automatiques des sites.** Un site créé par `create-site` contient désormais `renovate.json` (une
  demande de fusion s'ouvre à chaque nouvelle version du core ; les correctifs sont fusionnés seuls si les
  vérifications passent) et deux flux GitHub Actions : vérifications à chaque demande de fusion, déploiement à chaque
  fusion sur `main` (migrations de la base appliquées avant le déploiement).
- Les versions du core ont maintenant des notes (ce fichier) et une « release » GitHub.
- **Licence MIT.** Le core est publié sous licence MIT (fichier `LICENSE`).
- **Corbeille.** Un contenu ou un fichier supprimé reste récupérable 30 jours (écran « Corbeille »). Pour le site il
  disparaît tout de suite ; le restaurer le remet comme avant (langues, publication, historique, redirections).
  La suppression définitive et le vidage sont réservés à l'administrateur.
- **Journal d'activité.** Écran « Activité » (administrateur) : qui a fait quoi et quand, avec filtres et export.
  Conservé 180 jours ; aucun mot de passe, clé ni jeton n'y figure.
- **Sauvegardes.** Une copie de la base chaque nuit, gardée 30 jours dans le stockage du site (jamais servie
  publiquement, secrets chiffrés), écran « Sauvegardes » avec alerte, sauvegarde immédiate, téléchargement et
  restauration des contenus et des réglages. Nouvelle commande `pnpm cms:export` pour remettre toutes ses données à
  un client ou reconstruire une base. Déclencheurs de workflow « Une sauvegarde a échoué » et « est faite ».
- **Double authentification.** Code à 6 chiffres d'une application d'authentification, codes de secours, appareil de
  confiance 30 jours. Un administrateur peut la rendre obligatoire (pour les administrateurs ou pour tous) et
  réinitialiser celle d'un compte depuis « Utilisateurs ».

### À faire dans votre site

- **Sauvegarde de nuit** : ajouter `"triggers": { "crons": ["17 3 * * *"] }` au `wrangler.jsonc` du site, et le script
  `"cms:export": "backoffice-export"` à son `package.json`. Sans la première ligne, la sauvegarde se fait quand un
  administrateur ouvre le back-office, et l'écran « Sauvegardes » le signale.
- **Garder `NUXT_AUTH_SECRET` ailleurs que chez Cloudflare** : les sauvegardes et la double authentification en dépendent.
- Rien d'autre d'obligatoire. Pour qu'un site existant profite des mises à jour automatiques, y copier `renovate.json` et
  `.github/workflows/` depuis `packages/create-site/template/`, puis suivre « Mettre à jour le core » du README du modèle.

## 0.5.0 — 2026-11-19

### Nouveautés

- **Dossiers dans la médiathèque** : dossiers imbriqués (3 niveaux), création, renommage, déplacement par
  glisser-déposer ou « Déplacer vers… », suppression (le contenu remonte au dossier parent), recherche dans tous les
  dossiers. Ranger un fichier ne change pas son adresse : les pages qui l'affichent ne sont pas touchées.
- La fenêtre de choix d'une image propose la même navigation et retient le dernier dossier ouvert.
- Outil d'import : `"folder": "Chantiers/Toiture"` à côté de `"file"` range le fichier importé.

### À faire dans votre site

- Base de données : une migration (0011). Elle est appliquée en ligne par `pnpm run deploy` ; en local, relancer
  `pnpm db:migrate`.

## 0.4.1 — 2026-11-19

### Correctifs

- Site installé depuis git : les pages ne relisent plus tous leurs contenus dans le navigateur après le rendu du
  serveur (écarts d'hydratation, affichage qui « saute »). Les fonctions `useCollection`, `useSingleton`, `useEntry`
  et `useCollectionPage` ont désormais des clés explicites.

## 0.4.0 — 2026-11-19

### Nouveautés

- **Module Stripe** (`stripe({ … })`) : paiement d'un produit à prix fixe par Stripe Checkout, écran « Paiements »,
  export CSV, déclencheurs de workflow « paiement reçu » et « paiement échoué ».
- **Module de mesure d'audience** (`analytics()`) : fréquentation du site dans l'écran « Audience », par Cloudflare
  Web Analytics, sans cookie ni bandeau.
- **Module anti-robots** (`turnstile()`) : Cloudflare Turnstile sur les formulaires du site, composant `<CmsTurnstile />`.
- **Galeries d'images** : champ image ou fichier avec `multiple: true`, légendes (`captions`), ordre par
  glisser-déposer ; le site reçoit une liste.
- **Sections de formulaire** : `section({ label, collapsed }, { …champs })` regroupe des champs, sans effet sur les données.
- Une page unique s'ouvre à `/admin/home` (l'ancienne adresse `/admin/home/home` y renvoie).
- Pastilles et messages plus lisibles ; logos des modules.

### À faire dans votre site

- Base de données : une migration (0010, paiements). En local, relancer `pnpm db:migrate`.
- Si le site pose un en-tête `Content-Security-Policy` et active l'audience ou l'anti-robots : autoriser les
  adresses de Cloudflare indiquées dans le README du modèle.

## 0.3.0 — 2026-11-18

### Nouveautés

- **Modules** : un module s'active dans `cms.config.ts` (`modules: [brevo(), forms({ … })]`) et se règle dans le
  back-office, écran « Modules ». Les clés d'API saisies là sont chiffrées et ne sont jamais renvoyées.
- **Formulaires du site** (`forms({ … })`) : messages validés par le serveur, enregistrés, visibles dans « Messages
  reçus », déclencheur de workflow « Un formulaire du site est envoyé », `useCmsForm()` côté page.
- **Outil d'import** (`pnpm cms:import`) : reprend des contenus depuis un fichier, sans doublon quand on le relance.
- API d'enregistrement : écriture « à plat » (`{ values: { … }, publish: ['fr'] }`), simulation (`dryRun`).
- API publique : une seule forme de valeur vide par type de champ.
- Le back-office garde son apparence quand le site règle les polices et les titres de toute la page.

### À faire dans votre site

- **E-mails** : l'envoi par Brevo est devenu un module. Un site qui envoie des e-mails (workflows, mot de passe
  oublié) doit ajouter `brevo()` à `modules` dans `cms.config.ts` ; sans lui, plus aucun e-mail ne part. Les variables
  `NUXT_BREVO_API_KEY` et `NUXT_EMAIL_FROM` déjà posées continuent de servir.
- API d'enregistrement : une valeur inconnue ou mal rangée est maintenant **refusée** (422) au lieu d'être ignorée.
  À vérifier si un script du site écrit par l'API.
- Pour utiliser l'outil d'import : ajouter `"cms:import": "backoffice-import"` aux scripts de `package.json`.
- Si `pnpm typecheck` se plaint des types de Node : ajouter `@types/node` aux `devDependencies`.
- Base de données : une migration (0009). En local, relancer `pnpm db:migrate`.

## 0.2.0 — 2026-11-18

### Nouveautés

- **Droits** : rôle « rédacteur » (prépare des brouillons, ne publie pas), option `access` par contenu, contenus
  attribués à une personne, droit « seulement ses contenus », champs réservés (`restricted`), rôles personnalisés
  créés dans le back-office.
- **Demandes de publication** : entrée « À valider » dans le menu, déclencheur de workflow.
- **Aperçu des brouillons** sur le site, et liens d'aperçu temporaires pour une personne sans compte.

### À faire dans votre site

- Base de données : trois migrations (0006 à 0008). En local, relancer `pnpm db:migrate`.

## 0.1.0 — 2026-11-18

Première version numérotée.

### Nouveautés

- Back-office généré à partir de `cms.config.ts` : pages uniques et collections, plusieurs langues, brouillon et
  publication, médiathèque, référencement, redirections, thème du site, workflows, comptes et invitations.
- Historique des versions d'un contenu, duplication, détection des modifications simultanées.
- Migrations de contenu : les données suivent les changements de `cms.config.ts` (écran « Structure des contenus »).
- Recherche rapide (⌘K), mot de passe oublié.
- Le numéro de version du core s'affiche en bas du menu ; `create-site` fixe un nouveau site sur cette version.
