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

- **Tableau de bord.** Le back-office s'ouvre sur un écran d'accueil au lieu du premier contenu du menu : ce qui attend
  la personne (demandes de publication à valider, messages non lus, publications programmées en échec, adresses
  introuvables de la semaine, modules à régler), les contenus en attente de publication, ceux modifiés récemment, un
  bouton « Créer », quelques chiffres des modules actifs (pages vues, messages, paiements, inscrits à la lettre) et,
  pour l'administrateur, l'état du site (disponibilité, sauvegardes, envoi d'e-mails). Chacun n'y voit que ce à quoi il
  a droit. Entrée « Tableau de bord » en tête du menu.
- **Santé du site.** Nouvel écran (menu Outils) qui examine les contenus en ligne : liens cassés (contenu supprimé ou
  retiré du site, page du site ou d'un autre site qui ne répond plus), images utilisées sans texte alternatif, images
  de plus de 1,5 Mo, fichiers de la médiathèque que rien n'utilise, et un résumé du référencement. Les liens sont
  vérifiés un à un après l'affichage ; chaque problème nomme le contenu et le champ où le corriger.
- **Données structurées (JSON-LD).** Nouvelle option `structuredData` d'un contenu, avec `sd.article()`, `sd.faq()` et
  `sd.organization()` (importés de `backoffice-core/config`) : on désigne les champs, `useCmsSeo(entry)` place les
  blocs dans la page. L'onglet Référencement en montre l'aperçu pendant la saisie. Les blocs sont aussi dans
  `entry.structuredData`. Voir le README du site.
- **Fil d'Ariane pour les moteurs de recherche.** `useCmsSeo(entry)` ajoute un `BreadcrumbList` aux pages qui ont une
  page parente : pour `/services/droit-des-affaires`, les pages uniques d'adresse `/` et `/services` si elles sont en
  ligne. Rien à déclarer ; `breadcrumb` règle le nom d'une page dans le fil, ou la retire (`false`).
- **Recherche sur le site.** `useCmsSearch(q)` et la route `/api/search` cherchent dans les pages publiées, sans tenir
  compte des majuscules ni des accents, et renvoient titre, adresse et extrait avec les mots trouvés à mettre en
  évidence. `search: false` retire un contenu de la recherche.
- **Module Lettre d'information** (`newsletter()`, ou à activer dans l'écran Modules) : inscription confirmée par
  e-mail, écran « Lettre d'information » (inscrits, en attente, désinscrits, export CSV avec le lien de désinscription
  de chacun), report des inscrits dans une liste Brevo ou une audience Resend, pages de confirmation et de
  désinscription aux couleurs du site, déclencheurs de workflow. Côté page : `useCmsNewsletter()`.

- **Typographie.** L'écran Apparence règle les polices du site : police du texte et des titres parmi une vingtaine de
  polices libres servies par le site lui-même (aucune requête vers un service tiers), polices du système, ou polices
  envoyées (WOFF2, WOFF, TTF, OTF) ; échelle de taille des titres ; réglages fins par niveau (texte courant, H1 à H4 :
  police, graisse, taille, interligne, espacement). Aperçu en direct. Sans réglage, le site garde ses polices.
- **Flux RSS.** `feed: true` sur une collection publie ses derniers contenus à `/feeds/<identifiant>.xml` (une adresse
  par langue), avec résumé, image et, au choix, texte entier. `useCmsFeed('<identifiant>')` l'annonce dans la page.
- **`/llms.txt`.** Le site sert la liste de ses pages publiées et de leur résumé, en Markdown, à l'intention des
  assistants. Nouveau réglage `site.description` (la phrase d'introduction) ; `site.llms: false` retire le fichier.

- **Module Prise de rendez-vous** (`appointments()`, ou à activer dans l'écran Modules) : le visiteur choisit une
  prestation et un créneau libre ; confirmation et rappel par e-mail, lien pour ajouter le rendez-vous à son agenda ou
  l'annuler, acompte par Stripe en option. Nouvel écran « Rendez-vous » : agenda jour par jour, saisie d'un
  rendez-vous pris par téléphone, annulation avec un mot d'explication, export CSV, agenda à abonner, et réglages
  (prestations, horaires, délais, fermetures). Déclencheurs de workflow « rendez-vous pris » et « annulé ». Côté
  page : `useCmsAppointments()`. Voir le README du site.
- **Stripe : abonnements, codes promo, factures, stock.** Quatre réglages de `stripe({ … })` : `recurring` sur une
  collection (abonnement prélevé chaque semaine, mois ou année ; abonnements listés dans « Paiements », résiliation à
  l'échéance par l'administrateur, trois déclencheurs de workflow), `promoCodes` (champ « Code promo », remise
  relevée), `invoices` (facture PDF de chaque achat, ouverte depuis le détail d'un paiement) et `stock` sur une
  collection (achat refusé au-delà du stock, stock diminué à chaque paiement, déclencheur « Un produit est épuisé »).
  Voir le README du site.
- **Stripe sans collection vendable.** `stripe()` peut être déclaré sans `collections` : il ne sert alors qu'aux
  acomptes des rendez-vous.
- **Module Avis Google** (`googleBusiness()`, ou à activer dans l'écran Modules) : la note, cinq avis et les horaires
  de l'établissement sur Google Maps. `<CmsGoogleReviews />` les affiche sur le site dans le respect des règles de
  Google ; `useCmsGoogleBusiness()` donne la fiche pour une mise en page à soi. Écran « Avis Google » (lien pour
  répondre, lien « Laisser un avis »). Les horaires de la fiche complètent `sd.organization()` quand le site n'en
  déclare pas. Rien n'est enregistré ; voir le README du site pour la clé d'API et son coût.
- **Module Assistant de rédaction** (`assistant()`, ou à activer dans l'écran Modules) : par l'API de Claude, propose
  le texte alternatif d'une image (fiche d'un fichier, « Santé du site »), la description d'une page (onglet
  Référencement) et la traduction d'un contenu vers une autre langue du site. Rien n'est gardé sans relecture. Les
  images et textes concernés sont envoyés à Anthropic ; l'usage est facturé au compte de la clé. Voir le README du site.
- **Module Suivi des erreurs et surveillance** (`monitoring()`, ou à activer dans l'écran Modules) : nouvel écran
  « Surveillance » (administrateurs). Les erreurs du serveur et du navigateur des visiteurs y sont regroupées, sans
  donnée personnelle, et peuvent être transmises à Sentry. Le site vérifie toutes les cinq minutes qu'il répond : un
  e-mail part au deuxième échec de suite, un autre au retour, et à la première apparition d'une erreur. Une « adresse
  de battement » prévient un service extérieur, seul moyen d'être alerté d'une panne complète de l'hébergement.
  Trois déclencheurs de workflow. Voir le README du site.
- **Module Google Search Console** (`searchConsole()`, ou à activer dans l'écran Modules) : nouvel écran « Recherche
  Google » (clics, affichages, taux de clic, position moyenne, recherches tapées, pages montrées par Google, sur 7, 28
  ou 90 jours), colonnes « Clics » et « Position » dans « Pages et titres », clics depuis Google sur le tableau de
  bord. Lecture seule ; la mise en route côté Google (propriété validée, client OAuth, jeton) est décrite dans le
  README du site.

### Correctifs

- Recherche du site et aperçu des données structurées : le texte tiré d'un contenu mis en forme ne garde plus
  d'espace avant la ponctuation qui suit un mot en gras ou un lien.

### À faire dans votre site

- **`/llms.txt`** est servi d'office : il ne liste que des pages déjà publiques (celles du plan du site). Pour ne pas
  le servir : `llms: false` dans `site`. Un fichier `public/llms.txt` existant garde la main.
- **Typographie** : rien à faire. À savoir si un administrateur règle la taille ou la graisse des titres : ces réglages
  l'emportent sur les classes du gabarit ; la classe `cms-type-off` en exempte un titre. Avec un en-tête
  `Content-Security-Policy`, autoriser `font-src 'self'`.
- Base de données : quatre migrations (0016, inscrits à la lettre d'information ; 0017, rendez-vous ; 0018, abonnements
  et factures Stripe ; 0019, erreurs et vérifications du site). En local, relancer `pnpm db:migrate`.
- Dépendances : le core embarque maintenant `@anthropic-ai/sdk` et `zod` (module Assistant de rédaction). Rien à
  installer dans le site ; ils ne sont chargés que par les routes de l'assistant.
- **Stripe, si vous déclarez un abonnement** (`recurring`) : cochez quatre événements de plus sur le webhook
  (`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`) ; sans
  eux, la souscription est enregistrée mais ni les échéances suivantes ni la résiliation. Pour le bouton « Facture
  PDF » et la résiliation depuis le back-office, la clé limitée demande « Lecture » sur « Invoices » et « Écriture »
  sur « Subscriptions ». Rien à faire pour un site qui ne vend qu'en une fois.
- **Fil d'Ariane** : une page qui appelle `useCmsSeo(entry)` et dont une page parente existe dans le back-office reçoit
  maintenant un bloc `BreadcrumbList`, sans rien changer au code. Le nom des pages parentes est leur `label` dans
  `cms.config.ts` : s'il n'est pas fait pour être lu par des visiteurs (« Page des services »), ou si le site a
  plusieurs langues, réglez `breadcrumb` sur ces pages uniques. Si le site écrit déjà son propre fil d'Ariane en
  JSON-LD, retirez l'un des deux (`breadcrumb: false`, ou `useCmsSeo(entry, { structuredData: false })`).
- Identifiants réservés : une collection ou une page unique ne peut plus s'appeler `health`, `newsletter`,
  `appointments` ni `monitoring` (ce sont maintenant des écrans du back-office). Si c'est le cas, renommez-la avec `renamedFrom`.
- Si une page ou un test du site comptait sur la redirection de `/admin` vers le premier contenu : `/admin` est
  maintenant le tableau de bord.

## 0.13.0 — 2026-11-25

### Nouveautés

- **Écran de chargement du back-office.** À l'ouverture ou au rechargement d'une page `/admin`, une animation
  remplace la page blanche pendant que le back-office démarre. Elle reprend la couleur du back-office.
- **Bouton bloqué pendant son action.** Le bouton qui lance une action (créer un compte, changer de mot de passe,
  enregistrer, supprimer…) est grisé et montre un indicateur jusqu'à la réponse du serveur : une action ne peut plus
  partir deux fois. C'est automatique pour tous les écrans, sans rien écrire dans chacun.

## 0.12.0 — 2026-11-25

### Nouveautés

- **Hébergement hors de Cloudflare.** Un site peut maintenant tourner sur un serveur Node ordinaire, dans un conteneur
  Docker (VPS, serveur du client, autre hébergeur) : `cms: { target: 'node' }` dans son `nuxt.config.ts`. La base est
  alors un fichier SQLite (mêmes tables, mêmes migrations, appliquées au démarrage), les fichiers de la médiathèque
  vont sur le disque ou dans un stockage compatible S3 (`NUXT_S3_*`), les images sont redimensionnées par `sharp`, et
  le site déclenche lui-même la sauvegarde de la nuit et les publications programmées. Demande Node 24.
  `pnpm create-site --hosting node` crée un tel site, avec son `Dockerfile`, son `docker-compose.yml` (Caddy pour le
  HTTPS), son fichier `.env` et un guide `HEBERGEMENT.md`. Rien ne change pour les sites hébergés chez Cloudflare.
- **Référencement : titres de la page.** L'onglet Référencement affiche le plan de la page (H1, H2, H3…) tel que Google
  le lit, mis à jour pendant la saisie, et signale les problèmes : titre principal (H1) absent, en double, vide ou sans
  rapport avec le titre de la page, niveau sauté (H2 puis H4), titre vide. Les textes longs sans intertitre sont
  aussi signalés, dans la vue d'ensemble comme dans l'onglet. Dans l'éditeur, les boutons de titre disent le niveau
  qu'ils produisent (« Titre de section (H2) », « Sous-titre (H3) »).
- **Provenance des contacts.** Le site relève d'où vient chaque visiteur (annonce Google Ads grâce au `gclid`, autre
  publicité, e-mail, réseau social, moteur de recherche, autre site, accès direct) et le joint à ses messages et à ses
  paiements. « Messages reçus » et « Paiements » disent combien de contacts viennent des annonces, campagne par
  campagne, avec un filtre par canal ; l'export CSV et les workflows (`{{ origin.channel }}`…) ont la provenance.
  Par défaut, elle n'est gardée que le temps de la visite, sans rien écrire sur l'appareil du visiteur ;
  `site.attribution` la règle (voir le README du site). Aucun changement à faire dans les pages.
- **Module Google Ads.** Nouvel écran « Annonces Google » : dépense, clics et conversions de chaque
  campagne, lus dans Google Ads, à côté des contacts du site qu'elle a amenés (messages, paiements) et du coût par
  contact. Les contacts sont rattachés aux campagnes par `utm_id={campaignid}`, par le `gclid` (retrouvé auprès de
  Google) ou par le nom de la campagne. À activer dans l'écran Modules ; la mise en route côté Google (projet Cloud,
  client OAuth, jeton) est décrite dans le README du site. L'administrateur peut y mettre une campagne en pause, la
  relancer et changer son budget par jour (avec confirmation, et inscription au journal d'activité) ; rien d'autre
  n'est modifié dans Google Ads.
- **Google Ads : contacts signalés comme conversions.** Avec une action de conversion réglée dans le module, les
  messages et les paiements venus d'une annonce sont signalés à Google Ads (Data Manager API), quelques heures après
  le clic, seulement si le visiteur a donné son accord (module Consentement). Rien de personnel n'est transmis. L'état
  de l'envoi se lit dans le détail de chaque contact et dans l'écran « Annonces Google ». Le jeton d'actualisation
  doit porter aussi l'autorisation `datamanager` (voir le README du site).
- **Module Consentement.** Bandeau de consentement posé par le core sur les pages du site : refuser aussi simple
  qu'accepter, rien avant le choix, choix gardé six mois, français et anglais. `<CmsConsentLink />` (à placer dans le
  pied de page) le rouvre, `useCmsConsent().allows('…')` dit à une page si une finalité est acceptée, et
  `consent({ purposes })` déclare les finalités propres au site. L'accord pour la mesure de la publicité est joint à
  la provenance des contacts. À activer dans l'écran Modules.

## 0.11.0 — 2026-11-23

### Nouveautés

- **Logo du site dans le back-office** : nouveau réglage `site.logo` de `cms.config.ts`, un fichier du dossier `public/`
  du site (`'/logo.svg'`, carré de préférence) ou une adresse complète. Il s'affiche en haut du menu, à la place de
  l'initiale du nom. Sans ce réglage, rien ne change.
- **Menu : logo et compte toujours visibles.** Le haut du menu (nom du site) et le bas (compte, déconnexion, version)
  restent en place ; quand le menu est plus haut que l'écran, seule la liste des écrans défile.

## 0.10.0 — 2026-11-21

### Nouveautés

- **Favoris dans le menu.** Une étoile, au survol de chaque entrée du menu (toujours visible sur écran tactile),
  épingle l'écran dans une section « Favoris » en tête du menu, même s'il est rangé dans un dossier replié. On change
  l'ordre des favoris en les faisant glisser, ou au clavier (Alt + ↑ / ↓). Les favoris sont propres à chaque compte et
  le suivent d'un appareil à l'autre ; un favori vers un écran devenu inaccessible n'est pas montré.

### Correctifs

- Menu : un libellé trop long (« Acoustique (vue d'ensemble) »…) élargissait le menu et cachait les chevrons des
  dossiers. Il est maintenant coupé avec « … », et le libellé entier s'affiche au survol.

## 0.9.1 — 2026-11-20

### À faire dans votre site

- Facultatif, mais à faire avant que GitHub n'arrête Node 20 : dans `.github/workflows/deployer.yml` et
  `.github/workflows/verifier.yml`, passer à `actions/checkout@v7`, `actions/setup-node@v7` et `pnpm/action-setup@v6`
  (actions sous Node 24). Rien d'autre à changer. Les sites créés à partir de cette version les ont déjà.

## 0.9.0 — 2026-11-20

### Nouveautés

- **Menu du back-office en arbre.** Les contenus sont rangés dans des dossiers repliables, un par groupe de
  `cms.config.ts` (`group`, sinon « Pages » et « Collections »). Les outils du quotidien (médiathèque, messages reçus,
  audience, paiements) forment la section « Outils » ; les autres écrans sont regroupés dans trois dossiers repliés
  par défaut : **Référencement** (« Pages et titres », Redirections), **Réglages** (Apparence, Disponibilité, Modules,
  Workflows) et **Administration** (Utilisateurs, Activité, Sauvegardes, Corbeille, Structure des contenus). Le
  dossier de l'écran ouvert s'ouvre tout seul ; un dossier ouvert ou replié à la main le reste dans ce navigateur. La
  recherche (⌘K) donne le nom du dossier de chaque écran. L'écran « Référencement » s'appelle « Pages et titres »
  dans le menu.

## 0.8.0 — 2026-11-20

### Nouveautés

- **Site en construction ou en maintenance.** Nouvel écran « Disponibilité » (menu Site, administrateurs) : un clic
  ferme le site au public le temps d'une construction (réponse 200 `noindex`, `robots.txt` qui interdit l'exploration)
  ou d'une maintenance (réponse 503 avec `Retry-After`, les pages gardent leur référencement), puis le remet en ligne.
  Les visiteurs voient une page d'attente au choix parmi trois modèles (« Sobre », « Image plein écran », « Couleur
  vive ») aux couleurs de l'écran Apparence, avec titre et message par langue, contact et image de la médiathèque, et
  un aperçu en direct dans l'écran. Le back-office, l'API, les médias et les fichiers restent servis ; le mode aperçu
  (connecté ou lien d'aperçu partagé) montre le vrai site, et un bandeau « Site fermé » le rappelle dans le
  back-office. Changement d'état : cache du site vidé, ligne au journal d'activité. Aucune migration (le réglage est
  rangé dans `cms_settings`).
- **Module Resend** : `resend()` dans `cms.config.ts` envoie les e-mails du site (workflows, lien de nouveau mot de
  passe, notifications des formulaires) par Resend, à la place de Brevo. Clé d'API et expéditeur dans l'écran Modules
  (ou `NUXT_RESEND_API_KEY` et `NUXT_EMAIL_FROM`). « Vérifier la connexion » contrôle la clé et, avec une clé « Full
  access », que le domaine de l'expéditeur est vérifié dans Resend.
- Avec plusieurs modules d'envoi déclarés, c'est le premier **réglé** qui envoie (auparavant : le premier déclaré).
- **Modules activés depuis le back-office.** L'écran « Modules » montre tous les modules, rangés par famille (envoi
  d'e-mails, mesure d'audience, formulaires, paiement, sécurité), avec un interrupteur « Activé ». Un module déclaré
  dans `cms.config.ts` reste activé tant qu'un administrateur ne le désactive pas : rien ne change pour un site
  existant. On peut régler un module avant de l'activer ; le désactiver garde ses réglages. Le menu (Audience, Messages
  reçus, Paiements) et le site suivent tout de suite ; activations et désactivations figurent au journal d'activité.
  Formulaires et Stripe, qui ont besoin d'options dans le code, ne s'activent qu'une fois déclarés.
- **Plausible** : nouveau module de mesure d'audience (`plausible()`, ou `analytics({ provider: 'plausible' })`), sans
  cookie, sur plausible.io ou une instance hébergée par le client. Domaine et clé « Stats API » dans l'écran Modules ;
  la balise est ajoutée aux pages et l'écran « Audience » lit ses statistiques. Le module Cloudflare s'appelle
  désormais « Cloudflare Web Analytics » dans le back-office.

## 0.7.0 — 2026-11-20

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
- **Redirections.** Nouvel écran « Redirections » (administrateur et éditeur) : la liste de toutes les redirections,
  celles créées toutes seules quand l'adresse d'un contenu change et celles ajoutées à la main. Une ancienne adresse
  d'un précédent site se redirige vers une page du site (la redirection suit la page si son adresse change) ou vers une
  adresse libre, de façon définitive (301) ou provisoire (302) ; ajout une par une, ou en lot (liste collée ou fichier
  CSV, avec un compte rendu ligne par ligne). Les erreurs sont refusées avec une explication : boucle, adresse réservée,
  doublon, adresse d'une page en ligne ; une chaîne (A → B → C) est signalée et aplatie. Les redirections manuelles
  valent pour toute adresse du site à laquelle aucune page ne répond, à une visite directe comme en navigation interne.
  Adresses exactes seulement (pas de motif avec « * »).
- **Pages introuvables.** Le même écran liste les adresses que des visiteurs ont demandées sans rien trouver (nombre de
  demandes, dernière fois, provenance), avec « Créer une redirection » en un clic. Aucune donnée personnelle n'est
  conservée ; les balayages de robots sont écartés ; 500 adresses au plus, oubliées après 90 jours sans demande.
- L'outil d'import (`pnpm cms:import`) accepte une rubrique `redirections` (voir le README du site).
- **Aperçu en direct.** Dans le formulaire d'un contenu qui a une page, le bouton « Aperçu en direct » affiche la page
  du site à côté du formulaire : elle suit la saisie au bout d'un court délai, sans rien enregistrer ni publier (texte,
  images, galeries, relations, liens, champs masqués par une condition, langue en cours d'édition). Largeurs ordinateur,
  tablette et téléphone, séparation réglable, bascule Formulaire / Aperçu sur petit écran. Il n'y a **rien à écrire dans
  le site** : les pages qui lisent leurs contenus avec `useSingleton`, `useEntry`, `useCollection` ou
  `useCollectionPage` fonctionnent telles quelles, y compris les listes qui contiennent le contenu en cours de saisie.
  Limites : une page qui lit l'API par ses propres moyens (`$fetch`, `useAsyncData` avec sa propre clé) montre ce qui est
  enregistré ; l'adresse de la page, l'ordre et les filtres des listes ne changent qu'à l'enregistrement ; un contenu
  jamais enregistré n'a pas d'aperçu avant son premier enregistrement. Si votre hébergement ajoute un en-tête
  `X-Frame-Options: DENY` ou `Content-Security-Policy: frame-ancestors 'none'`, remplacez-le par `SAMEORIGIN` /
  `frame-ancestors 'self'` : le core, lui, n'en pose aucun.

### Correctifs

- Sur téléphone, la barre d'actions du formulaire d'un contenu passe à la ligne au lieu de déborder.
- Le suffixe du titre n'est plus répété quand le titre le contient déjà (« Cabinet Durand, avocats — Cabinet Durand »).
- Sur téléphone, l'image de partage choisie ne fait plus déborder l'onglet Référencement.
- La page « introuvable » (404) du site n'est plus gardée une heure par le cache du réseau : elle était mise en cache
  comme une page ordinaire.

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
- Rien d'obligatoire. La mise à jour ajoute deux tables (`cms_redirect_rules`, `cms_not_found`), créées par les
  migrations au déploiement.

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
