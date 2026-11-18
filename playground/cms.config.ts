import { defineCms, collection, singleton, f, type InferEntry } from 'backoffice-core/config'
import { analytics, brevo, forms, turnstile } from 'backoffice-core/modules'

const config = defineCms({
  site: { name: 'Cabinet Durand', url: 'https://cabinet-durand.fr', locales: ['fr', 'en'], defaultLocale: 'fr' },

  // Fonctions ajoutées au site. Les clés d'API se saisissent dans le back-office, écran « Modules ».
  modules: [
    brevo(),
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
  ],

  singletons: {
    home: singleton({
      label: 'Accueil',
      icon: 'house',
      path: '/',
      seo: true,
      fields: {
        heroTitle: f.text({ label: 'Titre principal', required: true, max: 80 }),
        heroText: f.textarea({ label: 'Texte d\'introduction', max: 240 }),
        heroImage: f.image({ label: 'Image' }),
        cta: f.link({ label: 'Bouton principal' }),
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
        body: f.richText({ label: 'Contenu' }),
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
  // @ts-expect-error un champ obligatoire n'est jamais null
  const wrong: null = s.title
  // @ts-expect-error champ inexistant
  s.unknown
  return { title, excerpt, audience, price, priceAlways, faqLink, coverUrl, featured, firstQuestion, wrong }
}
