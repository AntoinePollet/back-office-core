# Publier une version du core

Pour le propriétaire du dépôt. Une fois la version publiée, chaque site équipé (voir plus bas) reçoit tout seul une
demande de fusion ; les correctifs sont fusionnés et déployés sans intervention.

## Pas à pas

1. **Au fil du travail**, noter chaque changement dans `CHANGELOG.md`, section `## À venir`, du point de vue de la
   personne qui met un site à jour : `### Nouveautés`, `### Correctifs`, et surtout `### À faire dans votre site` dès
   qu'un site doit changer quelque chose (une option renommée, un module à ajouter, un secret à poser…).
2. Être sur `main`, à jour, sans modification en attente. Lancer la batterie complète : `pnpm test`.
3. Choisir le numéro et créer la version :

   ```sh
   pnpm release patch    # x.y.Z : correctif, rien ne change pour les sites → fusionné et déployé tout seul chez eux
   pnpm release minor    # x.Y.0 : nouvelles fonctions → chaque site attend une relecture
   pnpm release major    # X.0.0 : les sites doivent être adaptés → relecture
   ```

   La commande refuse de continuer si `## À venir` est vide. Elle relance les tests rapides, inscrit le numéro,
   range « À venir » sous `## x.y.z — date`, crée le commit « Version x.y.z » et l'étiquette `vx.y.z`. Rien n'est
   encore envoyé.
4. Envoyer : `git push --follow-tags`.
5. **La release GitHub** est créée par le flux « Publier la version » (`.github/workflows/publier-version.yml`) dès
   que l'étiquette arrive, avec les notes du `CHANGELOG.md`. Vérifier qu'elle apparaît sur la page « Releases ».
   À la main, si le flux n'a pas tourné :

   ```sh
   node scripts/release.mjs notes 0.5.1 | gh release create v0.5.1 --verify-tag --title "Version 0.5.1" --notes-file -
   ```

C'est tout. Ensuite, sans rien faire :

- dans les heures qui suivent, Renovate ouvre dans chaque site « Mise à jour : backoffice-core v0.5.0 → v0.5.1 »,
  avec les notes ;
- les vérifications du site tournent (installation, migrations sur une base vide, types, construction) ;
- un correctif est fusionné seul, puis déployé (migrations de la base, puis code) ; une version mineure ou majeure
  attend que quelqu'un la relise et la fusionne ;
- le back-office de chaque site affiche à ses administrateurs « la 0.5.1 est disponible » tant qu'il n'est pas à jour.

## Règles à tenir pour que l'automatisme reste sûr

- **Un correctif ne demande jamais rien au site.** S'il y a une rubrique « À faire dans votre site » qui n'est pas
  facultative, c'est au moins une version mineure : elle ne sera pas fusionnée sans relecture.
- **Une migration de base ne casse pas l'ancien code.** Le déploiement met la base à niveau avant le code ; si le
  déploiement échoue ensuite, l'ancien code tourne sur la nouvelle base. Ajouter des tables et des colonnes
  (avec une valeur par défaut), ne pas en retirer ni en renommer dans la même version que le code qui cesse de s'en servir.
- **Une étiquette publiée ne se déplace pas.** Une erreur se corrige par une nouvelle version.
- Retirer une version fautive : supprimer sa release GitHub ne suffit pas (les sites lisent les étiquettes) ;
  publier vite un correctif. Dans un site, fermer la demande de fusion la fait ignorer.

## Équiper un site

Un site créé par `pnpm create-site` a déjà les fichiers. Pour un site plus ancien, copier depuis
`packages/create-site/template/` : `renovate.json`, `.github/workflows/verifier.yml`, `.github/workflows/deployer.yml`.
Puis, une fois par site (détail dans le README du site, « Mettre à jour le core ») :

1. le dépôt du site est sur GitHub, avec `pnpm-lock.yaml` ;
2. Renovate (<https://github.com/apps/renovate>) est autorisé sur ce dépôt — autorisé une fois pour « tous les
   dépôts » du compte, il n'y a plus rien à faire pour les sites suivants ;
3. deux secrets GitHub : `CLOUDFLARE_ACCOUNT_ID` et `CLOUDFLARE_API_TOKEN` (Workers Scripts : modifier, D1 : modifier,
   Paramètres du compte : lecture ; Workers Routes : modifier si le domaine est déclaré dans `wrangler.jsonc`).

Tant que le dépôt du core est privé, Renovate doit aussi être autorisé sur lui (pour lire les étiquettes), et l'avis
de version dans le back-office reste muet (GitHub répond 404 sans jeton). Les deux fonctionnent sans réglage une fois
le dépôt public.

## Comment c'est fait

| Élément | Où | Rôle |
| --- | --- | --- |
| `CHANGELOG.md` | core | Notes par version ; source des notes de la release |
| `scripts/release.mjs`, `scripts/changelog.mjs` | core | `pnpm release …` ; `node scripts/release.mjs notes x.y.z` |
| `.github/workflows/publier-version.yml` | core | Crée la release GitHub à l'arrivée d'une étiquette `vX.Y.Z` |
| `renovate.json` | site | Suit les étiquettes du core (règle par expression régulière sur `package.json`) ; fusion automatique des correctifs |
| `.github/workflows/verifier.yml` | site | Vérifications à chaque demande de fusion |
| `.github/workflows/deployer.yml` | site | Construction, migrations, déploiement à chaque fusion sur `main` |
| `GET /api/cms/update` | core | Avis de version du back-office (GitHub interrogé une fois par jour au plus, résultat gardé dans `cms_settings`) |

Pourquoi une règle par expression régulière : la dépendance `github:…#v0.5.0&path:/packages/cms` (étiquette **et**
sous-dossier) n'est comprise ni par Dependabot ni par le gestionnaire npm de Renovate ; tous deux lisent
`v0.5.0&path:/packages/cms` comme une référence qui n'est pas un numéro de version, et l'ignorent.
