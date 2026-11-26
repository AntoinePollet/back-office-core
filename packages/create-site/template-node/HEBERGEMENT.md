# Héberger __SITE_NAME__ sur son propre serveur

Ce site ne tourne pas chez Cloudflare mais sur un serveur Node ordinaire, dans un conteneur Docker : un VPS, un
serveur du client, ou n'importe quel hébergeur qui lance des conteneurs. Ce fichier remplace, dans `README.md`, tout
ce qui parle de Cloudflare et de `wrangler` (« Mettre en ligne », la partie hébergement de « Sauvegardes » et de
« Mettre à jour le core »). Le reste du README (contenus, pages, modules, référencement…) s'applique tel quel.

| Chez Cloudflare | Ici |
| --- | --- |
| Base D1 | Fichier SQLite `cms.sqlite`, dans le dossier de données |
| Bucket R2 | Dossier `media/` du dossier de données, ou un stockage compatible S3 |
| Service Images | `sharp`, dans le serveur du site |
| Déclencheurs planifiés | L'horloge du site lui-même (sauvegarde à 3 h 17 UTC, publications programmées toutes les 5 minutes) |
| Cache du réseau, purgé à la publication | Pas de cache : chaque page est demandée au site, toujours à jour |
| `wrangler d1 migrations apply` | Rien à faire : le site met sa base à niveau à son démarrage |

## En local

Il faut Node 24 ou plus récent et pnpm 9 ou plus récent.

```sh
pnpm install
pnpm dev            # http://localhost:3000, back-office sur /admin
```

La base et les fichiers vivent dans `.data/` (créé au premier lancement). Pour repartir de zéro : arrêter le serveur
et supprimer `.data/`.

## Mettre en ligne

Sur le serveur (Docker et son extension Compose installés, ports 80 et 443 ouverts, domaine pointé vers lui) :

```sh
git clone <ce dépôt> && cd __ID__
cp .env.example .env
# remplir .env : NUXT_AUTH_SECRET (openssl rand -hex 32) et SITE_DOMAIN
docker compose up -d --build
```

Le site répond sur `https://<SITE_DOMAIN>` : Caddy obtient le certificat tout seul. Ouvrir `/admin` et **créer tout
de suite le compte administrateur** : tant qu'aucun compte n'existe, n'importe quel visiteur peut le créer.

**Déclarer l'adresse du site** dans `cms.config.ts` (`site: { url: 'https://<SITE_DOMAIN>' }`) : sur un serveur Node,
c'est elle que portent les liens envoyés par e-mail (nouveau mot de passe, confirmations, notifications). Sans elle,
ces liens prennent l'adresse de la requête, que son expéditeur choisit : le site le signale à son démarrage.

Sans Caddy (un autre serveur frontal existe déjà : Nginx, Traefik, celui de l'hébergeur…), ne lancer que le site
(`docker compose up -d --build site`) et faire suivre les requêtes vers son port 3000. Garder `NUXT_TRUST_PROXY=true`
si ce serveur frontal transmet l'adresse du visiteur dans `X-Forwarded-For`, et le retirer si le site est exposé
directement à Internet. Si plusieurs serveurs frontaux se suivent (un répartiteur de charge devant Nginx, par
exemple), mettre leur nombre à la place de `true` (`NUXT_TRUST_PROXY=2`) : le site lit l'adresse ajoutée par le
premier d'entre eux, jamais ce que le visiteur a pu écrire lui-même dans l'en-tête.

### Réglages (fichier `.env`)

| Variable | Rôle |
| --- | --- |
| `NUXT_AUTH_SECRET` | Secret des sessions, obligatoire. Le changer déconnecte tout le monde, rend illisibles les clés d'API des modules et invalide la double authentification |
| `SITE_DOMAIN` | Domaine servi par Caddy |
| `NUXT_DATA_DIR` | Dossier de données dans le conteneur (`/data`, monté sur le volume `donnees`) |
| `NUXT_S3_ENDPOINT`, `NUXT_S3_BUCKET`, `NUXT_S3_REGION`, `NUXT_S3_ACCESS_KEY_ID`, `NUXT_S3_SECRET_ACCESS_KEY` | Fichiers de la médiathèque dans un stockage compatible S3 plutôt que sur le disque |
| `NUXT_S3_BACKUP_BUCKET` | Bucket à part pour les sauvegardes de la base (conseillé : elles contiennent les données personnelles du site) |
| `NUXT_EMAIL_FROM`, `NUXT_BREVO_API_KEY`, `NUXT_RESEND_API_KEY` | Envoi d'e-mails (voir README.md) |

## Mettre à jour le site

Après une modification du site ou une nouvelle version du core :

```sh
git pull
docker compose up -d --build
```

Au démarrage, le site applique à sa base les migrations de la nouvelle version (elles sont notées dans ses journaux :
`docker compose logs site`). Une migration qui échoue est annulée et le site ne démarre pas : relancer l'image
précédente le temps de comprendre.

### Avec l'image construite par GitHub

Le flux `.github/workflows/deployer.yml` construit l'image à chaque fusion sur `main` et la publie dans le registre
de GitHub (`ghcr.io/<compte>/<dépôt>`). Le serveur n'a alors plus besoin du code : dans `docker-compose.yml`, retirer
`build: .`, indiquer `image: ghcr.io/<compte>/<dépôt>:latest`, puis à chaque mise à jour :

```sh
docker compose pull && docker compose up -d
```

Si l'image est privée, connecter une fois le serveur au registre : `docker login ghcr.io` (jeton GitHub avec le droit
`read:packages`). Pour revenir en arrière, indiquer l'étiquette d'un commit précédent à la place de `latest`.

## Les données : ce qu'il faut sauvegarder

Tout est dans le volume `donnees` (`/data` dans le conteneur) :

- `cms.sqlite` (et ses fichiers `-wal`, `-shm`) : la base ;
- `media/` : les fichiers de la médiathèque ;
- `media/_sauvegardes/` : les sauvegardes de la base faites par le back-office chaque nuit (écran « Sauvegardes »).

Ces sauvegardes sont sur le même disque que la base : elles protègent d'une erreur de manipulation, pas de la perte
du serveur. **Copier régulièrement le volume ailleurs** (ou ranger fichiers et sauvegardes dans un stockage S3) :

```sh
docker run --rm -v __ID___donnees:/data -v "$PWD":/copie alpine tar czf /copie/donnees-$(date +%F).tar.gz -C /data .
```

Pour une copie cohérente de la base pendant que le site tourne, préférer une sauvegarde faite depuis le back-office
(écran « Sauvegardes » → « Sauvegarder maintenant »), puis copier le volume.

## Venir de Cloudflare, ou y aller

La base a la même structure des deux côtés. `pnpm cms:export` (voir « Remettre ses données à un client » dans
README.md) produit un fichier `restauration.sql` et les fichiers de la médiathèque : sur un site Node à la base
vide et déjà démarré une fois, `sqlite3 /chemin/vers/cms.sqlite < restauration.sql` reprend les contenus, et les
fichiers se copient dans `media/` (ou dans le bucket S3) en gardant leur chemin.
