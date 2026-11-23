import { defineCms, collection, section, singleton, f, type InferEntry } from 'backoffice-core/config'
import { analytics, brevo, forms, resend, stripe, turnstile } from 'backoffice-core/modules'

const config = defineCms({
  site: {
    name: 'Cabinet Durand', url: 'https://cabinet-durand.fr', locales: ['fr', 'en'], defaultLocale: 'fr',
    // Référencement : fin du titre de chaque page, et image de partage des pages qui n'en ont pas (fichier de public/).
    titleSuffix: 'Cabinet Durand',
    shareImage: '/partage.png',
    // Logo en haut du menu du back-office (sans logo : l'initiale du nom).
    logo: '/logo.svg',
  },

  // Fonctions ajoutées au site. Les clés d'API se saisissent dans le back-office, écran « Modules ».
  modules: [
    brevo(),
    // Autre fournisseur d'e-mails : le premier des deux qui est réglé envoie.
    resend(),
    // Mesure d'audience sans cookie (Cloudflare Web Analytics) : écran « Audience » du back-office.
    analytics(),
    // Anti-robots des formulaires (Cloudflare Turnstile) : <CmsTurnstile /> dans la page de contact.
    turnstile(),
    forms({
      contact: {
        label: 'Contact',
        fields: {
          name: f.text({ label: 'Nom', required: true }),
          email: f.text({ label: 'E-mail', required: true, format: 'email' }),
          subject: f.select({ label: 'Sujet', options: [{ value: 'devis', label: 'Demande de devis' }, { value: 'autre', label: 'Autre question' }] }),
          message: f.textarea({ label: 'Message', required: true, min: 10 }),
          consent: f.boolean({ label: 'J\'accepte que mes données soient utilisées pour me répondre', required: true }),
        },
      },
    }),
    // Paiement en ligne des produits de la boutique : le prix vient du champ « price », saisi dans le back-office.
    stripe({
      collections: { products: { price: 'price', image: 'image', available: 'onSale', maxQuantity: 5 } },
      currency: 'eur',
      shipping: { countries: ['FR', 'BE'] },
      successPath: '/merci',
    }),
  ],

  singletons: {
    home: singleton({
      label: 'Accueil',
      icon: 'house',
      path: '/',
      seo: true,
      fields: {
        // Sections du formulaire : pure présentation, les noms des champs et les données ne changent pas.
        ...section({ label: 'Bandeau', help: 'Le haut de la page d\'accueil.' }, {
          heroTitle: f.text({ label: 'Titre principal', required: true, max: 80 }),
          heroText: f.textarea({ label: 'Texte d\'introduction', max: 240 }),
          heroImage: f.image({ label: 'Image' }),
          cta: f.link({ label: 'Bouton principal' }),
        }),
        // Galerie au premier niveau : commune aux langues, comme une image seule. Masquée, sa section disparaît.
        showGallery: f.boolean({ label: 'Afficher une galerie de photos', default: true }),
        ...section({ label: 'Le cabinet en images', collapsed: true }, {
          gallery: f.image({
            label: 'Photos du cabinet', multiple: true, captions: true, max: 12,
            showIf: { field: 'showGallery', equals: true },
            help: 'Le texte alternatif de chaque photo se règle dans la médiathèque ; la légende est propre à cette page.',
          }),
        }),
        featured: f.relation({ label: 'Services mis en avant', to: 'services', multiple: true }),
        faq: f.repeater({
          label: 'Questions fréquentes',
          itemLabel: 'question',
          max: 10,
          fields: {
            question: f.text({ label: 'Question', required: true }),
            answer: f.textarea({ label: 'Réponse', required: true }),
            hasLink: f.boolean({ label: 'Ajouter un lien « En savoir plus »' }),
            more: f.link({ label: 'Lien', required: true, showIf: { field: 'hasLink', equals: true } }),
          },
        }),
      },
    }),

    settings: singleton({
      label: 'Réglages du site',
      icon: 'settings',
      group: 'Site',
      drafts: false,
      adminOnly: true,
      fields: {
        phone: f.text({ label: 'Téléphone', format: 'tel', localized: false, width: 'half' }),
        email: f.text({ label: 'E-mail de contact', format: 'email', localized: false, width: 'half' }),
        address: f.textarea({ label: 'Adresse', rows: 3 }),
        footerText: f.text({ label: 'Mention de pied de page' }),
      },
    }),
  },

  collections: {
    services: collection({
      label: 'Services',
      icon: 'briefcase',
      labelSingular: 'service',
      path: '/services/[slug]',
      titleField: 'title',
      seo: true,
      orderable: true,
      list: { columns: ['category'], thumbnail: 'cover' },
      fields: {
        title: f.text({ label: 'Titre', required: true }),
        excerpt: f.textarea({ label: 'Résumé', max: 160, help: 'Affiché dans la liste des services.' }),
        cover: f.image({ label: 'Image' }),
        category: f.relation({ label: 'Catégorie', to: 'categories' }),
        ...section({ label: 'Public et tarif', help: 'À qui s\'adresse le service, et à quel prix.' }, {
          audience: f.select({
            label: 'Public',
            width: 'half',
            // Exemple de champ réservé : un rédacteur le voit mais ne le modifie pas.
            restricted: true,
            options: [{ value: 'companies', label: 'Entreprises' }, { value: 'individuals', label: 'Particuliers' }],
          }),
          onQuote: f.boolean({ label: 'Tarif sur devis', width: 'half' }),
          fromPrice: f.number({ label: 'Tarif à partir de', unit: '€ HT', min: 0, required: true, width: 'half', showIf: { field: 'onQuote', equals: false } }),
          companySize: f.select({
            label: 'Taille d\'entreprise visée',
            showIf: { field: 'audience', equals: 'companies' },
            options: [{ value: 'small', label: 'TPE et PME' }, { value: 'large', label: 'Grandes entreprises' }],
          }),
        }),
        body: f.richText({ label: 'Contenu' }),
        // Galerie dans un répéteur : chaque réalisation a ses photos légendées (traduites avec le répéteur).
        ...section({ label: 'Réalisations', help: 'Quelques dossiers menés, avec leurs photos.', collapsed: true }, {
          cases: f.repeater({
            label: 'Dossiers présentés',
            itemLabel: 'title',
            max: 6,
            fields: {
              title: f.text({ label: 'Titre', required: true }),
              text: f.textarea({ label: 'Texte', rows: 2 }),
              photos: f.image({ label: 'Photos', multiple: true, captions: true, max: 8 }),
            },
          }),
        }),
      },
    }),

    categories: collection({
      label: 'Catégories',
      icon: 'tags',
      labelSingular: 'catégorie',
      titleField: 'name',
      drafts: false,
      defaultSort: { field: 'name', dir: 'asc' },
      fields: { name: f.text({ label: 'Nom', required: true }) },
    }),

    testimonials: collection({
      label: 'Témoignages',
      icon: 'message-square-quote',
      // Exemple de droits par collection : ici les rédacteurs publient eux-mêmes, mais seuls les éditeurs suppriment.
      // et chaque rédacteur ne voit que les témoignages qu'il a saisis.
      access: { publish: ['editor', 'writer'], own: ['writer'] },
      labelSingular: 'témoignage',
      titleField: 'author',
      orderable: true,
      fields: {
        author: f.text({ label: 'Nom', required: true, localized: false }),
        quote: f.textarea({ label: 'Citation', required: true }),
        photo: f.image({ label: 'Photo' }),
        visible: f.boolean({ label: 'Afficher sur l\'accueil', default: true }),
      },
    }),

    products: collection({
      label: 'Boutique',
      icon: 'shopping-bag',
      labelSingular: 'produit',
      // Les prix sont encaissés en ligne : seuls les éditeurs (et l'administrateur) modifient la boutique.
      access: { edit: ['editor'], publish: ['editor'], delete: ['editor'] },
      titleField: 'title',
      orderable: true,
      list: { columns: ['price', 'onSale'], thumbnail: 'image' },
      fields: {
        title: f.text({ label: 'Nom du produit', required: true }),
        description: f.textarea({ label: 'Description', max: 300 }),
        image: f.image({ label: 'Photo' }),
        price: f.number({ label: 'Prix', unit: '€ TTC', min: 0, step: 0.01, width: 'half', help: 'Prix payé en ligne, avec les centimes (49,90). Laissé vide : le produit ne peut pas être acheté.' }),
        onSale: f.boolean({ label: 'En vente', default: true, width: 'half' }),
      },
    }),

    documents: collection({
      label: 'Documents',
      icon: 'file-text',
      labelSingular: 'document',
      titleField: 'title',
      // Réservé aux administrateurs. Avec les contenus ci-dessus, le playground couvre tous les types de champs
      // (ici : date, fichier, choix multiples) ; l'exemple d'import `import/contenus.json` les remplit tous.
      adminOnly: true,
      defaultSort: { field: 'date', dir: 'desc' },
      fields: {
        title: f.text({ label: 'Titre', required: true }),
        date: f.date({ label: 'Date', width: 'half' }),
        file: f.file({ label: 'Fichier', accept: ['application/pdf'] }),
        topics: f.select({
          label: 'Thèmes',
          multiple: true,
          options: [{ value: 'tarifs', label: 'Tarifs' }, { value: 'cabinet', label: 'Le cabinet' }, { value: 'presse', label: 'Presse' }],
        }),
      },
    }),
  },
})

export default config

// Vérification des types : ce que le site reçoit pour un service et pour l'accueil.
type Service = InferEntry<typeof config.collections.services>
type Home = InferEntry<typeof config.singletons.home>

export function typeChecks(s: Service, h: Home) {
  const title: string = s.title
  const excerpt: string | null = s.excerpt
  const audience: 'companies' | 'individuals' | null = s.audience
  const price: number | null = s.fromPrice
  // @ts-expect-error obligatoire mais conditionnel : peut être null quand il est masqué
  const priceAlways: number = s.fromPrice
  const faqLink: string | undefined = h.faq[0]?.more?.href
  const coverUrl: string | undefined = s.cover?.url
  const featured: string[] = h.featured.map(e => e.title)
  const firstQuestion: string | undefined = h.faq[0]?.question
  // Galeries : jamais null (liste vide), légende par image.
  const photoCaption: string | null | undefined = s.cases[0]?.photos[0]?.caption
  const galleryUrls: string[] = h.gallery.map(p => p.url)
  // @ts-expect-error une galerie n'est jamais null
  const galleryNull: null = h.gallery
  // @ts-expect-error un champ obligatoire n'est jamais null
  const wrong: null = s.title
  // @ts-expect-error champ inexistant
  s.unknown
  return { title, excerpt, audience, price, priceAlways, faqLink, coverUrl, featured, firstQuestion, photoCaption, galleryUrls, galleryNull, wrong }
}
