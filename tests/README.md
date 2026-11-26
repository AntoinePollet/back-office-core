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

## Sur GitHub

Le flux `.github/workflows/verifier.yml` tourne sur chaque demande de fusion et sur `main`. Il lance les tests unitaires,
puis, en parallèle et pour chacune des deux cibles (`cloudflare` sous Node 22, `node` sous Node 24), la vérification des
types et toutes les suites. Une cible en échec n'arrête pas l'autre. Les captures et journaux de `tests/resultats/`
sont alors joints à l'exécution (« Artifacts », gardés 7 jours).

## Réglages

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `E2E_TARGET` | `cloudflare` | `node` : teste la version « serveur Node » du core (fichier SQLite, disque, sharp). Demande Node 24 |
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
| `22-programmation` | publication programmée : heure du site (Paris) et instant enregistré, refus (heure passée ou inexistante, contenu incomplet, sans brouillons), exécution par le déclencheur planifié (date reculée en base avec `sqlite3`, `/_cms/dev-scheduled`) : API, page, plan du site, historique, journal, purge du cache tentée, workflows au nom de qui a programmé ; modifications en attente et page unique ; retrait programmé ; mise en ligne puis retrait ; modification entre-temps (rédactrice refusée) ; annulation, publication à la main ; contenu devenu invalide et workflow « une publication programmée a échoué » ; droits perdus ou compte supprimé ; deux langues (dont une seule en échec) ; repli sans déclencheur et durée de cache ; corbeille et duplication ; sauvegarde de nuit non refaite ; formulaire, fenêtre, liste, écran « Programmé », largeur de téléphone |
| `26-recadrage` | point d'intérêt des images : réglage dans la fiche d'un fichier (clic, glisser, clavier, doigt), aperçus par format, « Remettre au centre » ; site : `object-position`, images recadrées par le serveur (dimensions et partie gardée lues dans l'image reçue), `srcset`, page inchangée mieux cadrée ; route `/media` (largeurs, proportions et point hors liste ramenés à une seule adresse), changement de point visible malgré le cache ; vignettes du back-office, SVG / GIF / PDF, droits, journal, corbeille, sauvegarde, import avec `focus`, largeur de téléphone |
| `28-resend` | module Resend : expéditeur mal écrit refusé, vérification (clé inconnue, clé d'envoi seulement, domaine absent, en attente, adresse d'essai, domaine vérifié), clé jamais renvoyée, Resend choisi quand Brevo n'est pas réglé (lien de mot de passe : clé, expéditeur entre guillemets, destinataire), écran Modules, retrait de la clé |
| `29-modules-activation` | tous les modules listés avec leur famille et leur état, droits, Plausible réglé avant activation puis activé (balise sur le site, vérification, statistiques dans l'écran Audience, clé refusée, domaine inconnu), mesure d'audience entièrement désactivée (balise et écran retirés, réglages gardés), formulaires désactivés puis réactivés (envoi, messages, déclencheur de workflow), envoi d'e-mails coupé, journal ; écran : familles, interrupteurs, confirmation refusée, menu mis à jour sans recharger, écran d'un module désactivé, largeur de téléphone |
| `30-navigation` | menu en arbre : sections Contenus et Outils, dossiers par groupe de contenus (ouverts) et Référencement, Réglages, Administration (repliés), dossier de l'écran ouvert ouvert tout seul (y compris en navigation interne), état retenu au rechargement, recherche ⌘K avec le nom du dossier, menu de l'éditeur, téléphone ; favoris (étoile, section en tête, retenus au rechargement, déplacés au clavier et en glissant, retirés, liste nettoyée par le serveur, propres à chaque compte, écran inaccessible non montré) ; libellés longs coupés, chevrons visibles |
| `35-recherche` | recherche du site (`/api/search`, sans navigateur) : pages en ligne seulement (ni brouillon, ni page masquée, ni contenu sans page), accents et majuscules ignorés, extrait autour des mots trouvés, page unique, limites et types, langues, cache, page d'exemple rendue par le serveur |
| `36-donnees-structurees` | données structurées (JSON-LD) : questions fréquentes, organisme déclaré sur une page unique sans adresse et émis sur l'accueil, fil d'Ariane déduit des adresses (y compris dans une autre langue), absentes des listes, des aperçus et des pages masquées, texte qui ne ferme pas la balise, aperçu dans l'onglet Référencement |
| `37-sante` | santé du site : lien vers un contenu hors ligne, pages du site vérifiées par le navigateur, autres sites vérifiés par le serveur contre le faux service (404, 500, 403), limites et droits de la vérification, images sans texte alternatif, image lourde, fichier inutilisé, écran, vérification non comptée comme une visite, corrections publiées, site fermé |
| `38-lettre` | lettre d'information : module désactivé, sans envoi d'e-mails, adresse refusée, champ piège, e-mail de confirmation (Brevo joué par le faux service), faux lien, confirmation une seule fois, adresse déjà inscrite, liste Brevo (vérification, report des inscrits déjà là, report automatique), e-mail en anglais, page du site, export CSV, désinscription en deux temps, réinscription, limite d'envois, demande effacée après sept jours (`sqlite3`), workflows, écran, droits, journal sans l'adresse effacée |
| `39-accueil` | tableau de bord : site neuf (modules à régler, état du site), contenus en attente de publication et modifiés récemment, message non lu, adresse introuvable, publication programmée, site fermé, écran (arrivée après la connexion, entrée du menu active sur l'accueil seulement, lignes cliquables, bouton Créer), largeur de téléphone |
| `40-typographie` | typographie : polices proposées servies par le site, rien dans les pages sans réglage, thème (polices, échelle, réglages fins, valeurs refusées), préchargement, aucune adresse tierce, police envoyée (format lu dans le fichier, poids, famille devinée, absente de la médiathèque, corrigée, appliquée), écran Apparence (aperçu en direct, back-office inchangé, enregistrement), site rendu (police chargée, taille du titre sur ordinateur et téléphone), suppression, remise à zéro, journal |
| `41-flux-llms` | flux RSS (pages en ligne seulement, ordre, résumé, texte entier, image jointe, langues, adresses refusées) et `/llms.txt` (rubriques, résumés, flux annoncés, langue, site en construction), flux annoncé dans l'en-tête d'une page |
| `42-search-console` | module Search Console (Google joué par le faux service) : désactivé par défaut, propriété contrôlée, secrets jamais renvoyés, vérification, refus traduits (propriété inconnue ou non validée, jeton sans l'autorisation, révoqué, panne), rapport (totaux, recherches, pages regroupées par adresse du site, un point par jour, période arrêtée avant-hier), mémoire de cinq minutes, droits, écran « Recherche Google » (lien vers l'onglet Référencement, largeur de téléphone), colonnes et tri de « Pages et titres », chiffre du tableau de bord |
| `43-rendez-vous` | prise de rendez-vous : module désactivé, réglages (refus expliqués, droits), créneaux (heure du site, durée, délai minimal, jour fermé, plafond), réservation (e-mail de confirmation par le faux Brevo, créneau retiré, refus, champ piège), cinq demandes simultanées pour un créneau, limite d'envois, page du visiteur (faux lien, fichier d'agenda, annulation par le bouton seulement, trop tard), workflows, back-office (saisie hors délai, moment occupé, annulation avec un mot, export, effacement, journal sans coordonnées), rappel et effacement après treize mois (`sqlite3`, `/_cms/dev-scheduled`), acompte par le faux Stripe (créneau gardé, page de paiement relancée, événement signé, paiement rangé dans « Paiements », acompte jamais réglé, paiement tardif repris ou à rembourser), agenda à abonner, page du site (créneau pris entre-temps), écran, tableau de bord, largeur de téléphone |
| `44-avis-google` | avis Google (API Places jouée par le faux service) : module désactivé, identifiant contrôlé, clé jamais renvoyée, champs demandés, refus traduits, établissement sans avis, fiche pour le site (langue, cache), mémoire d'une heure, rien d'écrit en base (`sqlite3`), bloc du site (auteur, photo, lien, mention « Google Maps », ordre expliqué, texte jamais interprété, anglais, téléphone), horaires dans les données structurées de l'accueil, écran, droits |
| `45-stripe-etendu` | Stripe étendu (joué par le faux service) : code promo et facture demandés, remise relevée, PDF de la facture (droits, clé sans le droit), stock (refus au-delà, diminué par le paiement dans le brouillon et la version en ligne, événement rejoué, produit épuisé et son workflow, réapprovisionnement), abonnement (page de paiement, souscription, première facture non comptée deux fois, échéance suivante, facture d'un autre site, prélèvement en échec puis régularisé, résiliation à l'échéance par l'administrateur, fin annoncée par Stripe), workflows, écran « Paiements », page du site |
| `46-assistant` | assistant de rédaction (Claude joué par le faux service) : module désactivé, sans clé, modèle contrôlé, vérification sans rédaction, texte alternatif (image envoyée, consigne, forme imposée, repli demandé, rien d'enregistré), description (tirée du formulaire, page sans texte, contenu trop long), traduction (textes à leur place, HTML gardé, reste repris, clé étrangère ignorée), refus du modèle, réponse coupée, service saturé, clé refusée, modèle sans repli, droits, limite de trente demandes, boutons de la médiathèque, de « Santé du site », de l'onglet Référencement et du volet d'une langue |
| `47-surveillance` | suivi des erreurs et surveillance : module désactivé, réglages contrôlés, erreur du serveur (sans paramètres d'adresse, regroupée, alerte et workflow une seule fois, 404 non relevée), erreur du navigateur (depuis la page d'exemple, famille du navigateur, bruit, robots, troncature, vingt par visiteur), Sentry joué par le faux service (enveloppe, pas d'adresse IP, adresse refusée), correction, réouverture, effacement, droits, vérification du site contre une page réglable du faux service (alerte au deuxième échec, pas de répétition, retour, durée, page lente, échec isolé, site fermé exprès), service extérieur prévenu, écran, tableau de bord, largeur de téléphone |
| `48-google-analytics` | module Google Analytics (Google joué par le faux service) : désactivé par défaut, identifiants contrôlés, secrets jamais renvoyés, vérification avec rappel du module Consentement, refus traduits (propriété inconnue, API non activée, jeton sans l'autorisation, révoqué, panne), balise sans script, rien de chargé sans accord ni après un refus, script demandé après l'accord et à la visite suivante, arrêt et retrait des cookies au retrait de l'accord, chiffres et réserve dans l'écran « Audience », mémoire de cinq minutes, choix de la source avec Cloudflare, droits |
| `27-disponibilite` | site en construction ou en maintenance : droits (lecture de l'état pour tous, réglage administrateur), page d'attente (503 + `Retry-After` en maintenance, 200 + `noindex` en construction), textes échappés et par langue, back-office, API, médias et fichiers toujours servis, `robots.txt`, aperçu connecté et lien partagé, journal ; écran : menu, bandeau « Site fermé », aperçu en direct, fermeture et réouverture, largeur de téléphone |
| `25-referencement` | référencement assisté : balises inchangées quand les nouveaux champs sont vides, suffixe de titre et image de partage par défaut lus dans la configuration, nom du site dans les données structurées de l'accueil, aperçus (résultat Google ordinateur et téléphone, carte de partage) qui suivent la saisie et les replis, titre trop long coupé, titre et description de partage distincts jusque dans les balises `og:` de la page rendue, conseils (doublon nommé, image sans texte alternatif et lien vers la médiathèque, image trop petite, page masquée), deux langues et côte à côte, vue d'ensemble (états, filtres, recherche, tri, lien vers le bon onglet), droits, écriture à plat, largeur de téléphone ; titres de la page (H1, H2, H3) lus dans la page rendue par un cadre invisible, qui suivent la saisie sans enregistrer, H1 sans rapport avec le titre, texte long sans intertitre, contenu jamais enregistré |
| `24-redirections` | redirections manuelles : 301 et 302 côté serveur (en-tête `Location`, cache, normalisation), destination « page du site » qui suit un changement d'adresse, garde-fous (mal formée, réservée, elle-même, doublon, page en ligne, boucle, chaîne aplatie en aval et en amont), modification, suppression, purge du cache à chaque fois, corbeille et restauration, import en lot (compte rendu, simulation, relance, remplacement, fichier CSV), pages introuvables (comptage, provenance sans donnée personnelle, bruit des robots, plafond de 500 et oubli après 90 jours avec `sqlite3`, page 404 jamais mise en cache), navigation interne sans rechargement, plan du site et robots inchangés, droits, écran (liste, recherche, formulaire, import, « créer une redirection », largeur de téléphone), journal d'activité, rubrique `redirections` de l'outil d'import |
| `31-provenance` | provenance des contacts : arrivée par une annonce Google Ads puis contact sans recharger (utm, `gclid`, page d'arrivée), moteur de recherche (domaine seul, jamais la recherche), accès direct (rien d'écrit sur l'appareil, provenance perdue au rechargement), provenance envoyée par un robot (contrôlée, canal recalculé), écran « Messages reçus » (tableau par canal et campagne, part des publicités, badge, filtre, détail, période), variables de workflow ; le paiement venu d'une annonce est vérifié dans `16-stripe` |
| `32-google-ads` | module Google Ads (Google joué par le faux service) : désactivé par défaut, réglages contrôlés, secrets jamais renvoyés, vérification de la connexion sans jeton développeur, refus traduits (jeton révoqué, secret inconnu, accès « Test », compte administrateur manquant, panne), rapport des campagnes rapproché des contacts (identifiant de campagne, nom, `gclid` retrouvé puis enregistré, clic inconnu), mémoire de cinq minutes, écran « Annonces Google » (totaux, coût par contact, période, largeur de téléphone), droits ; pilotage par l'administrateur : pause et reprise (état relu chez Google, pas de demande inutile, campagne supprimée refusée), budget par jour (fenêtre, plafonds annoncés, refus de Google affiché, budget partagé non modifiable, budget changé entre-temps jamais écrasé, montants illisibles), journal d'activité, éditeur sans boutons, jeton en lecture seule expliqué ; conversions signalées à Google (Data Manager API jouée par le faux service) : action de conversion contrôlée et vérifiée, mise en attente seulement avec un clic Google et l'accord du visiteur, envoi par `/_cms/dev-scheduled` six heures après le clic, rien de personnel transmis, refus définitif, panne réessayée, pas de doublon, jeton sans l'autorisation (rien de perdu, problème affiché, reprise après correction), écran et détail d'un message |
| `33-consentement` | module Consentement : désactivé par défaut (ni bandeau, ni lien, ni configuration), adresse de la politique contrôlée, configuration dans les pages du site seulement, première visite (rien d'écrit avant le choix, « Tout refuser » et « Tout accepter » de même taille et de même couleur), refus gardé et pas redemandé, lien « Gérer mes cookies », « Personnaliser » sans case cochée, événement `cms:consent`, accord joint au message (ou absent après un refus), choix de plus de six mois ou illisible redemandé, page en anglais, largeur de téléphone, clavier |
| `23-apercu-direct` | aperçu en direct à côté du formulaire : la page du cadre suit la saisie sans enregistrer (texte, texte mis en forme, image, galerie, champ masqué par une condition, relation simple et multiple, liste de l'accueil, seconde langue), pas un appel par frappe ni de rechargement du cadre, largeurs téléphone / tablette / ordinateur, séparation réglable, bouton « recharger », onglet, petit écran (bascule Formulaire / Aperçu), contenu jamais enregistré, rien d'enregistré ni de publié (API publique, brouillon, historique, journal), préparation identique à l'API publique (HTML nettoyé, vides, références), droits (sans session, rédactrice, « seulement ses contenus », champ réservé), aucune réponse en cache, messages d'une autre origine ou d'une autre fenêtre ignorés |
| `34-chargement` | écran de chargement du back-office (présent dans la réponse du serveur, absent du site public, retiré une fois l'écran prêt) ; bouton bloqué pendant son action : connexion et changement de mot de passe cliqués plusieurs fois (une seule demande, indicateur, bouton de nouveau utilisable après la réponse), bouton sans requête jamais bloqué, onglet jamais bloqué par ce que charge son écran |

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
  Le faux Google (`lib/mock-google.mjs`) répond au jeton d'accès (`NUXT_GOOGLE_OAUTH_TOKEN_URL`), à l'API Google Ads
  (`NUXT_GOOGLE_ADS_API_URL`) et à la Data Manager API (`NUXT_GOOGLE_DATA_MANAGER_URL`) ; `t.google` donne l'état des
  campagnes et les conversions qu'il a acceptées.
  Le faux Anthropic (`NUXT_ANTHROPIC_API_URL`) répond à la fiche d'un modèle et aux demandes de l'assistant, dans la
  forme demandée ; des mots du contenu envoyé (REFUS, TROP-LONG, PANNE) changent sa réponse.
  Il joue aussi Search Console (`NUXT_GOOGLE_SEARCH_CONSOLE_API_URL`) : propriété et `searchAnalytics/query`.
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
