import { defineCms, collection, singleton, f } from 'backoffice-core/config'
import { brevo } from 'backoffice-core/modules'

// Ce fichier décrit les contenus que le client peut modifier dans le back-office.
// Chaque `singleton` est une page unique, chaque `collection` une liste de contenus du même type.
// Après une modification, le serveur de développement redémarre et le back-office se met à jour : aucune migration de base.
// Pour renommer un champ ou une collection sans perdre les contenus déjà saisis, utiliser `renamedFrom`.
export default defineCms({
  site: __SITE_TS__,

  // Modules : des fonctions ajoutées au site. Leurs clés d'API se saisissent dans le back-office, écran « Modules ».
  // Pour un formulaire de contact : importer `forms` et ajouter
  //   forms({ contact: { label: 'Contact', fields: { email: f.text({ label: 'E-mail', required: true, format: 'email' }), … } } })
  // puis, dans une page : `const form = useCmsForm('contact')`. Voir le README.
  modules: [
    brevo(),
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
        highlights: f.repeater({
          label: 'Points forts',
          itemLabel: 'title',
          max: 6,
          fields: {
            title: f.text({ label: 'Titre', required: true, max: 60 }),
            text: f.textarea({ label: 'Texte', max: 200 }),
          },
        }),
      },
    }),

    // Coordonnées affichées dans le pied de page. Sans brouillon : un enregistrement est aussitôt en ligne.
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
    // Collection d'exemple : à adapter ou à remplacer (services, réalisations, équipe…).
    articles: collection({
      label: 'Actualités',
      icon: 'newspaper',
      labelSingular: 'actualité',
      path: '/actualites/[slug]',
      titleField: 'title',
      seo: true,
      defaultSort: { field: 'date', dir: 'desc' },
      list: { columns: ['date'], thumbnail: 'cover' },
      fields: {
        title: f.text({ label: 'Titre', required: true, max: 120 }),
        date: f.date({ label: 'Date', required: true, width: 'half' }),
        excerpt: f.textarea({ label: 'Résumé', max: 160, help: 'Affiché dans la liste des actualités.' }),
        cover: f.image({ label: 'Image' }),
        body: f.richText({ label: 'Contenu' }),
      },
    }),
  },
})
