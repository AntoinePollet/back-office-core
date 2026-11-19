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

- **Avis de nouvelle version.** En bas du menu du back-office, un administrateur voit « Version 0.5.0 — la 0.5.1 est
  disponible », avec un lien vers les notes de version. Le serveur interroge GitHub une fois par jour au plus ; sans
  réponse, rien ne s'affiche et rien ne ralentit. Pour désactiver l'avis : `runtimeConfig: { cmsUpdateCheck: false }`
  dans `nuxt.config.ts`, ou la variable `NUXT_CMS_UPDATE_CHECK=false`.
- **Mises à jour automatiques des sites.** Un site créé par `create-site` contient désormais `renovate.json` (une
  demande de fusion s'ouvre à chaque nouvelle version du core ; les correctifs sont fusionnés seuls si les
  vérifications passent) et deux flux GitHub Actions : vérifications à chaque demande de fusion, déploiement à chaque
  fusion sur `main` (migrations de la base appliquées avant le déploiement).
- Les versions du core ont maintenant des notes (ce fichier) et une « release » GitHub.

### À faire dans votre site

- Rien d'obligatoire. Pour qu'un site existant profite des mises à jour automatiques, y copier `renovate.json` et
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
