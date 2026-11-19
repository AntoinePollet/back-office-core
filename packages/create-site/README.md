# create-site

Crée un nouveau site client : un projet Nuxt qui étend `backoffice-core`, et, si on le demande, ses ressources
Cloudflare (Worker, base D1, bucket R2).

Depuis la racine du dépôt :

```sh
pnpm create-site              # pose les questions une à une
pnpm create-site --help       # liste des options
```

Chaque question peut recevoir sa réponse par une option ; avec `--yes`, les options absentes prennent leur valeur par
défaut et aucune question n'est posée :

```sh
pnpm create-site --name "Cabinet Durand" --url https://cabinet-durand.fr --locales fr,en \
  --dir ../cabinet-durand --core local --install --no-cloudflare --yes
```

## Ce que fait la commande

1. Copie le modèle (`template/`) dans le dossier de destination et y inscrit le nom, l'identifiant, les langues et la
   dépendance vers le core. Le dossier doit être libre et hors de ce dépôt.
2. Avec `--install` : `pnpm install`, puis `pnpm db:migrate` (base locale).
3. Avec `--cloudflare` : vérifie que wrangler est connecté et qu'aucune base, aucun bucket ni aucun Worker ne porte déjà
   le nom du site ; crée la base D1 et le bucket R2 en Europe de l'Ouest ; reporte l'identifiant de la base dans
   `wrangler.jsonc` ; applique les migrations ; construit ; déploie avec un secret `NUXT_AUTH_SECRET` tiré au hasard.
   Chaque commande est affichée avant d'être lancée. Au premier échec, la commande s'arrête et affiche ce qui a été créé
   et les commandes restantes à lancer à la main.
4. Affiche un récapitulatif, les prochaines commandes, et ce qu'il reste à faire à la main pour que les mises à jour
   du core et les mises en ligne se fassent seules (autoriser Renovate sur le dépôt, poser deux secrets GitHub).

Le projet créé contient `renovate.json` (demande de fusion à chaque version du core, fusion automatique des correctifs)
et deux flux GitHub Actions (`.github/workflows/verifier.yml`, `deployer.yml`) : voir `docs/publier-une-version.md`
à la racine du dépôt et « Mettre à jour le core » dans le README du modèle.

`--dry-run` crée les fichiers mais n'exécute aucune commande Cloudflare : il affiche celles qui seraient lancées.

## Dépendance vers le core

- `--core local` (`--core-path <dossier>`, par défaut `packages/cms` de ce dépôt) : `link:` vers le dossier.
- `--core git` (`--core-ref <référence>`, par défaut l'étiquette de la version du core, ex. `v0.5.0`) : `github:AntoinePollet/back-office-core#v0.5.0&path:/packages/cms`. Seule cette forme (une étiquette de version) est suivie par les mises à jour automatiques.

Le README du projet créé explique comment passer de l'un à l'autre.

## Modifier le modèle

Les fichiers de `template/` sont copiés tels quels, sauf `_gitignore`, `_npmrc` et `_package.json` (renommés) et les marqueurs
`__ID__`, `__SITE_NAME__`… remplacés par `src/template.mjs`. Les versions des dépendances de `_package.json` suivent
celles de `playground/package.json` : `pnpm --filter create-site test` le vérifie.
