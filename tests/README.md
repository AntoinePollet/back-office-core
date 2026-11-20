# Tests de bout en bout

Ces tests pilotent le back-office et le site du `playground` comme le ferait une personne : un vrai navigateur
(Chrome, via `puppeteer-core`) et de vraies requêtes HTTP, contre le serveur de développement et une base locale.

## Lancer

```sh
pnpm install          # une fois
pnpm test             # vérification des types, puis tous les tests de bout en bout
pnpm test:e2e         # seulement les tests de bout en bout
pnpm test:e2e roles   # une seule suite (un morceau de son nom suffit ; plusieurs noms possibles)
pnpm test:e2e --liste # noms des suites
```

Pour **chaque suite**, le lanceur (`tests/run.mjs`) :

1. recrée une base locale vide dans `tests/.tmp/` (la base de développement `playground/.wrangler` n'est pas touchée) ;
2. démarre le serveur de développement du playground sur le port de test (et le faux service Brevo si la suite le demande) ;
3. crée le compte administrateur `claire@example.com` / `motdepasse-test-1` ;
4. exécute la suite, une ligne par étape ;
5. arrête le serveur, y compris après un échec ou un Ctrl+C. Il n'arrête que les processus qu'il a lancés.

Le code de sortie est non nul dès qu'une étape échoue. Un résumé clôt la sortie.

En cas d'échec, regarder `tests/resultats/` (ignoré par git, vidé à chaque lancement) :
`<suite>-echec-<n>-<étape>.png` (capture de chaque onglet ouvert au moment de l'échec) et `<suite>-serveur.log`.

## Réglages

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `E2E_PORT` | `3121` | port du serveur de test |
| `E2E_MOCK_PORT` | `E2E_PORT` + 10 | port du faux service (Brevo, Stripe, Cloudflare, webhooks) |
| `E2E_CHROME` | Chrome ou Chromium trouvé aux emplacements habituels | chemin du navigateur |
| `E2E_HEADLESS` | `1` | `0` : afficher le navigateur pendant les tests |
| `E2E_CAPTURES` | `0` | `1` : garder aussi des captures des étapes réussies |
| `E2E_TIMEOUT` | `10000` | délai maximal (ms) d'une attente dans le navigateur |
| `E2E_SERVER_TIMEOUT` | `180000` | délai maximal (ms) de démarrage du serveur |
| `E2E_RESULTS` | `tests/resultats` | dossier des captures et des journaux |

Exemple : `E2E_PORT=3200 E2E_HEADLESS=0 pnpm test:e2e contenus`.

## Les suites

| Fichier | Ce qui est vérifié |
| --- | --- |
| `01-contenus` | formulaires (catégorie, service, accueil), médiathèque, références résolues par l'API publique, nettoyage du HTML, images redimensionnées, site public |
| `02-roles` | invitation, rôles éditeur et administrateur, mots de passe, suppression d'un compte (deux navigateurs) |
| `03-workflows` | e-mails et appels de services externes contre un faux service, journal, pause |
| `04-site` | référencement, plan du site, aperçu du brouillon, redirections, glisser-déposer, publication par langue, thème |
| `05-apparence` | back-office clair sur un système en mode sombre, couleur du back-office |
| `06-connexions` | limitation des tentatives de connexion (sans navigateur) |
| `07-api-publique` | pagination, filtres, aperçu et liens de l'API publique (sans navigateur) |
| `11-ecriture-a-plat` | API d'enregistrement : écriture à plat, refus des valeurs inconnues ou mal rangées, simulation, forme unique des champs vides |
| `12-import` | outil d'import (`backoffice-import`) : simulation, import, relance sans doublon, mise à jour, erreurs, droits, exemple du playground |
| `13-modules` | modules : clé d'API saisie dans le back-office (chiffrée, jamais renvoyée), vérification Brevo, formulaire du site, messages reçus, workflow « formulaire envoyé », droits, limite d'envois |
| `14-galeries-sections` | galeries (envoi et sélection de plusieurs images, ordre au clavier et par glisser-déposer, légendes, retrait, dépôt de fichiers, dans un répéteur, deux langues), site et API, « Utilisé dans », import d'une galerie ; sections du formulaire (repliées, erreur dans une section repliée, côte à côte, section masquée) |
| `15-audience-antirobots` | mesure d'audience (Cloudflare Web Analytics joué par le faux service) : réglages et vérification, balise sur le site mais pas dans le back-office ni l'aperçu, purge du cache, écran « Audience » et ses états, droits ; anti-robots (Turnstile) : vérification des clés, formulaire refusé sans jeton ou avec un jeton refusé, accepté avec un jeton valide, expiration, module non réglé |
| `16-stripe` | paiement Stripe (joué par le faux service) : réglages et vérification de la clé, bouton du site, prix relu dans la version publiée, refus (brouillon, sans prix, hors vente, quantité), webhook signé, mal signé ou trop vieux, événement reçu deux fois, paiement différé, remboursement, workflow « paiement reçu », écran Paiements, droits, limite d'appels |
| `17-dossiers` | dossiers de la médiathèque : création (imbriqués, nom déjà pris, limites), envoi dans le dossier ouvert, nombre de fichiers, déplacement par glisser-déposer (sur un dossier, sur le fil d'Ariane) et par « Déplacer vers… », renommage, dossier jamais rangé dans lui-même, suppression d'un dossier vide ou non vide (le contenu remonte), recherche dans tous les dossiers, fenêtre de choix d'une image et galerie (dernier dossier retenu, envoi dans le dossier affiché), adresse publique inchangée et toujours affichée par le site, largeur de téléphone, droits (rédactrice refusée par le serveur), import dans des dossiers puis relance sans doublon |
| `18-corbeille-activite` | corbeille : suppression d'un contenu ou d'un fichier (encore cité), disparition du site (API, page 404, plan du site, relation, galerie, redirection), restauration à l'identique (langues, publication, rang, historique), adresse reprise entre-temps, dossier disparu, droits (rédacteur, éditeur, rôle personnalisé, « seulement ses contenus », restauration en brouillon sans droit de publier), suppression définitive, vidage, expiration après 30 jours, workflows « supprimé » et « restauré », écran Corbeille ; journal d'activité : phrases et personnes, retenue (rien sans changement, échecs de connexion répétés), aucune valeur secrète, filtres, suite de la liste, export CSV (formules neutralisées), accès réservé à l'administrateur, écran Activité, largeur de téléphone |
| `19-sauvegardes` | sauvegardes : déclencheur planifié simulé (`/_cms/dev-scheduled`, une sauvegarde par jour, route interne fermée), échec simulé (alerte, workflow « une sauvegarde a échoué » et son e-mail), alerte au-delà de 48 h, repli à la visite d'un administrateur, écran (état, liste, largeur de téléphone), sauvegarde manuelle, conservation de 30 jours, contenu du fichier (toutes les tables, aucun secret lisible, pas de session), jamais servie par l'adresse des fichiers, droits ; restauration (mot à saisir, retour à l'état sauvegardé, comptes et fichiers récents conservés, session gardée, annulation, fichier manquant signalé) ; export complet (`backoffice-export`) et réimport dans une base neuve avec wrangler |
| `20-double-authentification` | double authentification avec de vrais codes TOTP calculés par le test : activation (code QR relu avec `jsqr`, clé, premier code), codes de secours (usage unique, renouvellement, hachés en base), connexion avec code, code rejoué refusé, tolérance d'horloge, appareil de confiance, limite de tentatives, désactivation, règle obligatoire (compte conduit à l'activation, API refusée), remise à zéro par un administrateur, mot de passe oublié qui ne contourne rien, écran Utilisateurs, largeur de téléphone, commande de secours du README (rejouée avec `sqlite3` sur la base locale) |
| `21-mises-a-jour`, `21b-mises-a-jour-desactivees` | avis de nouvelle version en bas du menu (GitHub joué par le faux service) : affiché à l'administrateur seulement, lien vers les notes, une interrogation par jour au plus, GitHub en panne ou lent sans effet, site à jour, avis désactivé (`NUXT_CMS_UPDATE_CHECK=false`) |
| `26-recadrage` | point d'intérêt des images : réglage dans la fiche d'un fichier (clic, glisser, clavier, doigt), aperçus par format, « Remettre au centre » ; site : `object-position`, images recadrées par le serveur (dimensions et partie gardée lues dans l'image reçue), `srcset`, page inchangée mieux cadrée ; route `/media` (largeurs, proportions et point hors liste ramenés à une seule adresse), changement de point visible malgré le cache ; vignettes du back-office, SVG / GIF / PDF, droits, journal, corbeille, sauvegarde, import avec `focus`, largeur de téléphone |

## Ajouter une suite

Créer `tests/suites/NN-nom.mjs` : il est pris en compte tout seul, dans l'ordre des noms de fichier.

```js
import { check, clickText, login, says } from '../lib/harness.mjs'

export const meta = { title: 'ce que la suite vérifie' }

export default async function (t) {
  const page = await t.newPage()

  await t.step('connexion', () => login(page, t.B))

  await t.step('la liste des services s\'affiche', async () => {
    await clickText(page, 'aside a', 'Services')
    await says(page, 'Services')
    const r = await t.http().get('/api/content/services')
    check(r.status === 200, 'statut ' + r.status)
  })
}
```

- `t.step(titre, fn)` : une étape. Elle échoue si `fn` lève une erreur ; les étapes suivantes sont quand même tentées.
- `t.B` : adresse du serveur ; `t.admin` : le compte administrateur ; `t.fixture('Photo du Cabinet.png')` ou `'notes.txt'` :
  fichiers à importer (fabriqués par `lib/fixtures.mjs`, pas de fichier binaire dans le dépôt).
- `t.newPage({ context, scheme })` : un onglet ; `t.newContext()` : une session séparée (autre personne, visiteur non connecté).
- `t.http()` : client HTTP sans navigateur, qui garde ses cookies (`get`, `post`, `put`, `del`, `signIn`, `json`, `cookie`).
- `lib/harness.mjs` : `login`, `clickText`, `find`, `fieldset`, `field`, `typeIn`, `says`, `api`, `send`, `json`, `until`, `check`…
- `meta.mock: true` démarre le faux service (`t.M` son adresse, `t.calls()` les appels reçus) ; `meta.env` ajoute des
  variables d'environnement au serveur (voir `03-workflows`). Le faux Cloudflare (`lib/mock-cloudflare.mjs`) répond aux
  statistiques (`NUXT_CLOUDFLARE_API_URL`), à Siteverify (`NUXT_TURNSTILE_API_URL`) et sert un faux script Turnstile
  (`NUXT_PUBLIC_TURNSTILE_SCRIPT_URL`) : aucun appel ne part vers le vrai Cloudflare.
  Le faux GitHub (`NUXT_CMS_UPDATE_URL`, `POST /github/_regler` pour changer la version annoncée) joue la dernière version du core.

Chaque suite part d'une base vide : elle crée elle-même ce dont elle a besoin et ne dépend d'aucune autre.

## Pièges connus

- **Le port doit être libre.** Le lanceur refuse de démarrer si quelque chose écoute déjà sur `E2E_PORT` ; il ne tue rien.
- **Un `pnpm dev` ouvert en même temps dans le même dossier** partage `playground/.nuxt` avec le serveur de test : les deux
  serveurs se régénèrent ce dossier l'un l'autre. Les bases, elles, sont séparées. Mieux vaut arrêter `pnpm dev` pendant les tests.
- **Clics** : le bouton flottant des outils de développement Nuxt recouvre le bas de l'écran et intercepte les clics à la souris.
  `clickText` déclenche donc le clic dans la page (`el.click()`). Pour un clic à la souris (`page.click`), viser le haut de la page.
- **`clickText` et `find`** prennent d'abord l'élément dont le texte est exactement celui demandé, sinon le premier qui le contient.
  Préférer un sélecteur précis (`.modal-open button`, la ligne du tableau qui porte un nom) à une position (« le 2ᵉ bouton ») :
  l'interface s'enrichit, les positions changent.
- **`innerText` ne contient pas la valeur des champs de saisie** : lire `el.value`.
- **Un singleton (Accueil, Réglages) est créé à sa première lecture** par `GET /api/cms/entries/<type>/<type>` (ce que fait
  le formulaire) ou à son premier enregistrement par `PUT`.
- **L'API d'enregistrement refuse ce qu'elle ne sait pas ranger** (422) : un champ traduit dans `shared`, un champ commun dans
  `locales.<langue>.values`, un nom inconnu. Pour ne pas avoir à le savoir, écrire à plat : `{ values: { … }, publish: ['fr'] }`.
- **Attendre la fin d'un enregistrement avant de recharger** : attendre la notification (`says`) ou la réponse (`page.waitForResponse`),
  pas un délai fixe. Les seuls délais fixes de la suite vérifient qu'il ne se passe *rien* (un workflow qui ne doit pas se déclencher).
- **Limitation des connexions** : 8 échecs par compte, 40 par adresse IP, sur 15 minutes. Tous les tests viennent de la même adresse :
  une suite qui multiplie les mauvais mots de passe peut se bloquer elle-même. La base étant vidée à chaque suite, le compteur aussi.
- **E-mails** : sans `meta.mock`, aucun e-mail n'est configuré sur le serveur de test ; rien ne part vers Brevo.
- **Première exécution plus lente** : Nuxt compile tout et Vite prépare les dépendances (`E2E_SERVER_TIMEOUT` si la machine est lente).
