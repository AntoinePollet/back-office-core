import assert from 'node:assert/strict'
import { test } from 'node:test'
import { f } from './format'
import {
  SEO_LIMITS, contentImageIds, contentWordCount, seoOutlineTips, seoPageTitle, seoPath, seoPoints, seoState, seoTips, seoView, textWidth,
  truncateToChars, truncateToWidth, type SeoInput, type SeoMedia,
} from './seo'

const site = { name: 'Cabinet Durand', url: 'https://cabinet-durand.fr', titleSuffix: 'Cabinet Durand' }
const service = {
  kind: 'collection', label: 'Services', path: '/services/[slug]', titleField: 'title',
  fields: {
    title: { ...f.text({ label: 'Titre' }), localized: true },
    cover: { ...f.image({ label: 'Image' }), localized: false },
    onQuote: { ...f.boolean({ label: 'Sur devis' }), localized: false },
    hidden: { ...f.image({ label: 'Image masquée', showIf: { field: 'onQuote', equals: true } }), localized: false },
    body: { ...f.richText({ label: 'Contenu' }), localized: true },
    cases: { ...f.repeater({ label: 'Dossiers', fields: { text: f.textarea({ label: 'Texte' }), photos: f.image({ label: 'Photos', multiple: true, captions: true }) } }), localized: true },
  },
}
const home = { kind: 'singleton', label: 'Accueil', path: '/', fields: { heroTitle: { ...f.text({ label: 'Titre' }), localized: true } } }

const words = (n: number) => Array.from({ length: n }, (_, i) => `mot${i}`).join(' ')
const media: Record<string, SeoMedia> = {
  large: { name: 'large.jpg', mime: 'image/jpeg', width: 1200, height: 630, alt: { fr: 'Le cabinet' } },
  small: { name: 'petite.png', mime: 'image/png', width: 320, height: 240, alt: {} },
  square: { name: 'carree.jpg', mime: 'image/jpeg', width: 1000, height: 1000, alt: { fr: 'x' } },
  photo: { name: 'photo-3-2.jpg', mime: 'image/jpeg', width: 1500, height: 1000, alt: { fr: 'x' } },
  banner: { name: 'bandeau.jpg', mime: 'image/jpeg', width: 3000, height: 700, alt: { fr: 'x' } },
  logo: { name: 'logo.svg', mime: 'image/svg+xml', width: null, height: null, alt: { fr: 'Logo' } },
  unknown: { name: 'sans-taille.jpg', mime: 'image/jpeg', width: null, height: null, alt: { fr: 'x' } },
  mute: { name: 'muette.jpg', mime: 'image/jpeg', width: 800, height: 600, alt: { fr: '  ' } },
  english: { name: 'anglaise.jpg', mime: 'image/jpeg', width: 800, height: 600, alt: { en: 'Only English' } },
}
const good = 'Conseil et contentieux pour les sociétés lyonnaises : contrats, cessions, baux commerciaux.'
/** Une page sans rien à signaler ; chaque test n'en change qu'un aspect. */
const input = (over: Partial<SeoInput> = {}, seo: Record<string, unknown> = {}, sharedSeo: Record<string, unknown> = { image: 'large' }): SeoInput => ({
  def: service, site, locale: 'fr', defaultLocale: 'fr',
  shared: { seo: sharedSeo },
  values: { title: 'Droit des affaires', body: `<p>${words(60)}</p>`, seo: { description: good, ...seo } },
  slug: 'droit-des-affaires', published: true, media: id => media[id], others: [],
  ...over,
})
const ids = (i: SeoInput) => seoTips(i).map(t => t.id)

test('titre de la page : suffixe du site, jamais répété, seul quand il n\'y a pas de titre', () => {
  assert.equal(seoPageTitle('Droit des affaires', 'Cabinet Durand'), 'Droit des affaires — Cabinet Durand')
  assert.equal(seoPageTitle('  Droit   des affaires ', ''), 'Droit des affaires')
  assert.equal(seoPageTitle('Droit des affaires', undefined), 'Droit des affaires')
  // Le titre contient déjà le nom du site (majuscules et espaces près) : pas de doublon.
  assert.equal(seoPageTitle('Cabinet durand, avocats à Lyon', 'Cabinet Durand'), 'Cabinet durand, avocats à Lyon')
  assert.equal(seoPageTitle('Contact & devis – Rezicle', 'Rezicle'), 'Contact & devis – Rezicle')
  // Sans titre : le suffixe réglé pour le site, ou rien pour l'ancienne option passée par la page.
  assert.equal(seoPageTitle('', 'Cabinet Durand'), 'Cabinet Durand')
  assert.equal(seoPageTitle(null, 'Cabinet Durand', false), null)
  assert.equal(seoPageTitle(null, ''), null)
})

test('largeur d\'un texte : les lettres étroites comptent moins que les larges, les accents ne changent rien', () => {
  assert.equal(textWidth('', 20), 0)
  assert.ok(textWidth('iiii', 20) < textWidth('WWWW', 20) / 4 + 1)
  assert.equal(textWidth('é', 20), textWidth('e', 20))
  assert.equal(textWidth('abc', 20) * 2, textWidth('abc', 40))
  // 60 lettres moyennes en Arial 20 px dépassent la colonne de Google ; 45 y tiennent.
  assert.ok(textWidth('a'.repeat(60), 20) > SEO_LIMITS.titleMaxPx)
  assert.ok(textWidth('a'.repeat(45), 20) < SEO_LIMITS.titleMaxPx)
})

test('troncature du titre : à la largeur, sur une fin de mot, avec « … »', () => {
  const short = truncateToWidth('Droit des affaires — Cabinet Durand')
  assert.deepEqual(short, { text: 'Droit des affaires — Cabinet Durand', cut: false, kept: 35 })
  const title = 'Accompagnement juridique des entreprises en difficulté et de leurs dirigeants — Cabinet Durand'
  const long = truncateToWidth(title)
  assert.equal(long.cut, true)
  assert.ok(long.text.endsWith(' …'))
  assert.equal(long.text, title.slice(0, long.kept) + ' …')
  // La coupe tombe entre deux mots, et le texte affiché tient dans la largeur.
  assert.equal(title[long.kept], ' ')
  assert.ok(textWidth(long.text, SEO_LIMITS.titleFontPx) <= SEO_LIMITS.titleMaxPx)
  assert.ok(long.kept > 40 && long.kept < 70, String(long.kept))
  // Des lettres étroites : plus de caractères tiennent.
  assert.equal(truncateToWidth('i'.repeat(100)).cut, false)
  // Pas de ponctuation orpheline avant les points de suspension.
  assert.ok(!/[—,;:\s] …$/.test(truncateToWidth(`${'Droit des affaires '.repeat(3).trim()} — ${'Cabinet Durand '.repeat(3)}`).text))
  // Un seul mot interminable est coupé quand même.
  assert.ok(truncateToWidth('W'.repeat(80)).kept > 0)
})

test('troncature de la description : au nombre de caractères, sur une fin de mot', () => {
  assert.deepEqual(truncateToChars('Courte.'), { text: 'Courte.', cut: false, kept: 7 })
  assert.equal(truncateToChars('a'.repeat(160)).cut, false)
  const long = truncateToChars(`${'mot '.repeat(60)}`.trim())
  assert.equal(long.cut, true)
  assert.ok(long.text.length <= SEO_LIMITS.descriptionMaxChars && long.text.endsWith('mot …'), long.text)
  assert.ok(truncateToChars('mot '.repeat(60), SEO_LIMITS.descriptionMobileChars).text.length <= SEO_LIMITS.descriptionMobileChars)
})

test('replis : ce que le site affichera', () => {
  // Titre de référencement vide : le titre du contenu, puis le suffixe.
  const fallback = seoView(service, {}, { title: 'Droit des affaires' }, site)
  assert.deepEqual([fallback.baseTitle, fallback.titleFrom, fallback.pageTitle], ['Droit des affaires', 'content', 'Droit des affaires — Cabinet Durand'])
  assert.deepEqual([fallback.description, fallback.shareDescription, fallback.imageId, fallback.fallbackImage, fallback.noindex], ['', '', null, null, false])
  // Le partage reprend le titre de la page, suffixe compris.
  assert.deepEqual([fallback.shareTitle, fallback.shareTitleOwn], ['Droit des affaires — Cabinet Durand', false])
  // Titre et description de partage distincts : utilisés tels quels, sans suffixe.
  const own = seoView(service, { seo: { image: 'large', noindex: true } }, { title: 'T', seo: { title: 'Avocat d\'affaires à Lyon', description: 'D', shareTitle: 'Votre avocat d\'affaires', shareDescription: 'P' } }, { ...site, shareImage: '/partage.jpg' })
  assert.deepEqual([own.baseTitle, own.titleFrom, own.pageTitle], ['Avocat d\'affaires à Lyon', 'seo', 'Avocat d\'affaires à Lyon — Cabinet Durand'])
  assert.deepEqual([own.shareTitle, own.shareTitleOwn, own.shareDescription, own.shareDescriptionOwn], ['Votre avocat d\'affaires', true, 'P', true])
  assert.deepEqual([own.imageId, own.fallbackImage, own.noindex], ['large', '/partage.jpg', true])
  // Page unique : pas de titre de contenu. Le suffixe seul, ou rien si le site n'en a pas.
  assert.deepEqual([seoView(home, {}, { heroTitle: 'Bienvenue' }, site).titleFrom, seoView(home, {}, {}, site).pageTitle], ['none', 'Cabinet Durand'])
  assert.equal(seoView(home, {}, {}, { name: 'Site' }).pageTitle, null)
  assert.equal(seoView(home, {}, {}, { name: 'Site' }).shareTitle, null)
  // Un titre commun aux langues (champ non traduit) est lu dans les champs communs.
  assert.equal(seoView(service, { title: 'Commun' }, {}, { name: 'Site' }).pageTitle, 'Commun')
})

test('adresse de la page par langue', () => {
  assert.equal(seoPath(service, 'fr', 'fr', 'droit-social'), '/services/droit-social')
  assert.equal(seoPath(service, 'en', 'fr', 'employment'), '/en/services/employment')
  assert.equal(seoPath(home, 'en', 'fr', null), '/en/')
  assert.equal(seoPath({}, 'fr', 'fr', 'x'), null)
})

test('images et mots du contenu : galeries, répéteurs, champs masqués ignorés', () => {
  const values = {
    cover: 'a', onQuote: false, hidden: 'cachee', body: '<h2>Un titre</h2><p>Deux&nbsp;mots <strong>forts</strong> !</p>', title: 'Droit des affaires',
    cases: [{ text: 'Trois petits mots', photos: [{ media: 'b', caption: 'Légende' }, { media: 'a' }, 'c'] }, null],
  }
  assert.deepEqual(contentImageIds(service.fields, values), ['a', 'b', 'c'])
  assert.deepEqual(contentImageIds(service.fields, { ...values, onQuote: true }), ['a', 'cachee', 'b', 'c'])
  assert.deepEqual(contentImageIds(service.fields, {}), [])
  // Titre (3) + texte mis en forme (2 + 3 ; « ! » n'est pas un mot) + répéteur (3) ; les légendes ne comptent pas.
  assert.equal(contentWordCount(service.fields, values), 11)
  assert.equal(contentWordCount({ email: f.text({ label: 'E-mail', format: 'email' }) }, { email: 'a@b.fr' }), 0)
})

test('conseils : une page complète n\'a aucun point', () => {
  assert.deepEqual(ids(input()), [])
  assert.equal(seoState(seoTips(input()), false), 'complete')
})

test('conseils sur le titre : absent, trop long (coupure citée), trop court', () => {
  const none = seoTips(input({ def: home, values: { seo: { description: good } } }))
  assert.deepEqual(none.map(t => t.id), ['title-missing'])
  assert.match(none[0]!.advice, /Google n'affichera que « Cabinet Durand »/)
  assert.doesNotMatch(seoTips(input({ def: home, site: { name: 'S', shareImage: '/x.jpg' }, values: { seo: { description: good } } }))[0]!.advice, /Google n'affichera/)

  const long = seoTips(input({}, { title: 'Accompagnement juridique des entreprises en difficulté et de leurs dirigeants' }))
  assert.deepEqual(long.map(t => t.id), ['title-long'])
  assert.match(long[0]!.advice, /Google le coupera après « .+ »/)
  // Le suffixe compte : un titre qui tient seul peut déborder avec lui.
  const edge = 'Accompagnement juridique des sociétés lyonnaises'
  assert.deepEqual(ids(input({ site: { name: 'S', shareImage: '/x.jpg' } }, { title: edge })), [])
  assert.deepEqual(ids(input({ site: { ...site, titleSuffix: 'Cabinet Durand, avocats au barreau de Lyon' } }, { title: edge })), ['title-long'])

  assert.deepEqual(ids(input({ site: { name: 'S' }, shared: { seo: { image: 'large' } } }, { title: 'Contact' })), ['title-short'])
  // Avec le suffixe, le même titre atteint la longueur minimale.
  assert.deepEqual(ids(input({}, { title: 'Contact' })), [])
  assert.equal('Contact — Cabinet Durand'.length >= SEO_LIMITS.titleMinChars, true)
})

test('conseils sur la description : absente, trop longue, trop courte (seuils exacts)', () => {
  assert.deepEqual(ids(input({}, { description: '' })), ['description-missing'])
  assert.deepEqual(ids(input({}, { description: '   ' })), ['description-missing'])
  assert.deepEqual(ids(input({}, { description: 'a'.repeat(SEO_LIMITS.descriptionMaxChars) })), [])
  const long = seoTips(input({}, { description: 'a'.repeat(SEO_LIMITS.descriptionMaxChars + 1) }))
  assert.deepEqual(long.map(t => t.id), ['description-long'])
  assert.match(long[0]!.advice, /vers 160 caractères \(elle en fait 161\)/)
  assert.deepEqual(ids(input({}, { description: 'a'.repeat(SEO_LIMITS.descriptionMinChars) })), [])
  assert.deepEqual(ids(input({}, { description: 'a'.repeat(SEO_LIMITS.descriptionMinChars - 1) })), ['description-short'])
})

test('doublons : même titre ou même description qu\'une autre page, nommée et liée', () => {
  const others = [
    { name: 'Droit social', title: 'Droit social', description: 'Autre description.', to: '/admin/services/b?tab=seo' },
    { name: 'Affaires (ancienne)', title: ' droit  DES affaires ', description: good.toUpperCase(), to: '/admin/services/c?tab=seo' },
  ]
  const tips = seoTips(input({ others }))
  assert.deepEqual(tips.map(t => t.id), ['title-duplicate', 'description-duplicate'])
  assert.equal(tips[0]!.title, 'Même titre que la page « Affaires (ancienne) »')
  assert.deepEqual(tips[0]!.links, [{ label: 'Ouvrir « Affaires (ancienne) »', to: '/admin/services/c?tab=seo' }])
  assert.equal(tips[1]!.level, 'important')
  // Le doublon porte sur le titre sans le suffixe ; un titre vide n'est le doublon de rien.
  assert.deepEqual(ids(input({ others: [{ name: 'X', title: '', description: '' }] })), [])
  assert.deepEqual(ids(input({ def: home, values: { seo: { description: good } }, others: [{ name: 'X', title: '', description: '' }] })), ['title-missing'])
  // Un doublon peut aussi être trop long : les deux points sont dits.
  const title = 'Accompagnement juridique des entreprises en difficulté et de leurs dirigeants'
  assert.deepEqual(ids(input({ others: [{ name: 'X', title, description: '' }] }, { title })), ['title-duplicate', 'title-long'])
})

test('conseils sur l\'image de partage : absente, trop petite, mal proportionnée, format', () => {
  const withImage = (image: string | null, extra: Partial<SeoInput> = {}) => ids(input(extra, {}, image ? { image } : {}))
  assert.deepEqual(withImage(null), ['image-missing'])
  // L'image par défaut du site suffit.
  assert.deepEqual(withImage(null, { site: { ...site, shareImage: '/partage.jpg' } }), [])
  assert.deepEqual(withImage('small'), ['image-small'])
  assert.match(seoTips(input({}, {}, { image: 'small' }))[0]!.title, /320 × 240 px/)
  assert.deepEqual(withImage('square'), ['image-ratio'])
  assert.equal(seoTips(input({}, {}, { image: 'square' }))[0]!.title, 'Image de partage trop haute')
  assert.equal(seoTips(input({}, {}, { image: 'banner' }))[0]!.title, 'Image de partage trop allongée')
  // Une photo 3:2 est recadrée de moins d'un quart : rien à dire.
  assert.deepEqual(withImage('photo'), [])
  assert.deepEqual(withImage('logo'), ['image-format'])
  // Taille inconnue, ou fichier introuvable (supprimé) : pas de conseil inventé.
  assert.deepEqual(withImage('unknown'), [])
  assert.deepEqual(withImage('disparue'), [])
})

test('images du contenu sans texte alternatif : comptées, nommées, liées à la médiathèque', () => {
  const tips = seoTips(input({ shared: { seo: { image: 'large' }, cover: 'mute' }, values: { ...input().values, cases: [{ photos: [{ media: 'small' }, { media: 'large' }, { media: 'mute' }] }] } }))
  assert.deepEqual(tips.map(t => t.id), ['alt-missing'])
  assert.equal(tips[0]!.title, '2 images sans texte alternatif')
  assert.deepEqual(tips[0]!.links, [{ label: 'muette.jpg', to: '/admin/media?file=mute' }, { label: 'petite.png', to: '/admin/media?file=small' }])
  assert.equal(seoTips(input({ shared: { seo: { image: 'large' }, cover: 'small' } }))[0]!.title, '1 image sans texte alternatif')
  // Comme sur le site, le texte de la langue par défaut sert aux autres langues ; l'inverse n'est pas vrai.
  assert.deepEqual(ids(input({ locale: 'en', shared: { seo: { image: 'large' }, cover: 'large' } })), [])
  assert.deepEqual(ids(input({ shared: { seo: { image: 'large' }, cover: 'english' } })), ['alt-missing'])
  assert.deepEqual(ids(input({ locale: 'en', shared: { seo: { image: 'large' }, cover: 'english' } })), [])
  // L'image de partage n'est pas une image du contenu ; un champ masqué n'est pas examiné.
  assert.deepEqual(ids(input({ shared: { seo: { image: 'photo' }, hidden: 'mute', onQuote: false } })), [])
  assert.deepEqual(ids(input({ shared: { seo: { image: 'photo' }, hidden: 'mute', onQuote: true } })), ['alt-missing'])
})

test('page masquée : un rappel si elle est publiée, et plus de conseils pour Google', () => {
  const hidden = seoTips(input({ values: { title: 'T', body: '' } }, {}, { noindex: true }))
  // Ni titre court, ni description, ni texte : seuls le rappel et le partage restent.
  assert.deepEqual(hidden.map(t => [t.id, t.level]), [['hidden-published', 'rappel'], ['image-missing', 'conseil']])
  assert.equal(seoState(hidden, true), 'hidden')
  assert.equal(seoPoints(hidden), 1)
  assert.deepEqual(ids(input({ published: false }, {}, { noindex: true, image: 'large' })), [])
  // Un rappel seul ne fait pas une page « à améliorer ».
  assert.equal(seoState(seoTips(input({}, {}, { noindex: true, image: 'large' })), false), 'complete')
  assert.equal(seoState(seoTips(input({}, { description: '' })), false), 'improve')
})

test('adresse de la page : copie, sans mot, trop longue', () => {
  assert.deepEqual(ids(input({ slug: 'droit-des-affaires-copie' })), ['slug-unclear'])
  assert.deepEqual(ids(input({ slug: 'copie-2' })), ['slug-unclear'])
  assert.deepEqual(ids(input({ slug: '2026-11' })), ['slug-unclear'])
  assert.deepEqual(ids(input({ slug: 'photocopie' })), [])
  assert.deepEqual(ids(input({ slug: 'a'.repeat(SEO_LIMITS.slugMaxChars) })), [])
  assert.deepEqual(ids(input({ slug: 'a'.repeat(SEO_LIMITS.slugMaxChars + 1) })), ['slug-long'])
  // Publiée : le conseil rassure sur l'ancienne adresse. Pas d'adresse (nouveau contenu, page unique) : rien.
  assert.match(seoTips(input({ slug: 'x-copie' }))[0]!.advice, /L'ancienne adresse continuera de mener à la page/)
  assert.doesNotMatch(seoTips(input({ slug: 'x-copie', published: false }))[0]!.advice, /ancienne adresse/)
  assert.deepEqual(ids(input({ slug: '' })), [])
  assert.deepEqual(ids(input({ def: home, slug: 'x-copie', values: { seo: { title: 'Accueil du cabinet', description: good } } })), [])
})

test('texte très court : seulement si le contenu a un texte mis en forme', () => {
  const few = { title: 'Droit des affaires', body: `<p>${words(SEO_LIMITS.bodyMinWords - 4)}</p>`, seo: { description: good } }
  const tips = seoTips(input({ values: few }))
  assert.deepEqual(tips.map(t => t.id), ['body-short'])
  assert.equal(tips[0]!.title, 'Très peu de texte (49 mots)')
  assert.deepEqual(ids(input({ values: { ...few, body: `<p>${words(SEO_LIMITS.bodyMinWords - 3)}</p>` } })), [])
  // Les textes des répéteurs comptent ; une page sans champ de texte mis en forme n'est pas jugée.
  assert.deepEqual(ids(input({ values: { ...few, cases: [{ text: 'quatre mots de plus' }] } })), [])
  assert.deepEqual(ids(input({ def: home, values: { seo: { title: 'Accueil du cabinet', description: good } } })), [])
})

test('texte long sans intertitre : conseillé, sauf s\'il a des titres de section ou si l\'éditeur n\'en propose pas', () => {
  const long = (body: string) => ids(input({ values: { title: 'Droit des affaires', body, seo: { description: good } } }))
  assert.ok(long(`<p>${words(320)}</p>`).includes('headings-none'))
  assert.ok(!long(`<p>${words(150)}</p>`).includes('headings-none'))
  assert.ok(!long(`<h2>Nos domaines</h2><p>${words(320)}</p>`).includes('headings-none'))
  assert.ok(!long(`<h3 class="x">Contrats</h3><p>${words(320)}</p>`).includes('headings-none'))
  // Texte mis en forme sans le bouton de titre : rien à conseiller, la personne ne pourrait pas le faire.
  const plainBody = { ...service, fields: { ...service.fields, body: { ...f.richText({ label: 'Contenu', features: ['bold', 'list'] }), localized: true } } }
  assert.ok(!ids(input({ def: plainBody as never, values: { title: 'Droit des affaires', body: `<p>${words(320)}</p>`, seo: { description: good } } })).includes('headings-none'))
  // Page masquée des moteurs : pas de conseil sur le texte.
  assert.ok(!ids(input({ values: { title: 'Droit des affaires', body: `<p>${words(320)}</p>`, seo: { description: good } } }, {}, { image: 'large', noindex: true })).includes('headings-none'))
})

test('titres de la page : H1 absent, en double, vide, niveaux sautés, sans rapport avec le titre', () => {
  const h = (level: number, text: string, place = 'main') => ({ level, text, place })
  const page = { baseTitle: 'Droit des affaires', noindex: false }
  const tipsOf = (headings: ReturnType<typeof h>[], p = page) => seoOutlineTips(headings, p).map(t => t.id)
  // Une page bien construite : rien à dire. Remonter d'un H3 à un H2 est normal.
  assert.deepEqual(tipsOf([h(2, 'Menu', 'header'), h(1, 'Droit des affaires à Lyon'), h(2, 'Contrats'), h(3, 'Cessions'), h(2, 'Baux'), h(2, 'Contact', 'footer')]), [])
  assert.deepEqual(tipsOf([h(2, 'Contrats'), h(3, 'Cessions')]), ['h1-missing'])
  assert.deepEqual(tipsOf([]), ['h1-missing'])
  assert.deepEqual(tipsOf([h(1, 'Droit des affaires'), h(1, 'Nos tarifs')]), ['h1-multiple'])
  assert.deepEqual(tipsOf([h(1, '')]), ['h1-empty'])
  assert.deepEqual(tipsOf([h(1, 'Droit des affaires'), h(2, ''), h(2, '')]), ['heading-empty'])
  assert.match(seoOutlineTips([h(1, 'Droit des affaires'), h(2, '')], page)[0]!.title, /^1 titre vide$/)
  const skip = seoOutlineTips([h(1, 'Droit des affaires'), h(2, 'Contrats'), h(4, 'Clauses'), h(2, 'Baux'), h(5, 'Loyer')], page)
  assert.deepEqual(skip.map(t => t.id), ['heading-skip'])
  assert.match(skip[0]!.title, /H2 puis H4/)
  assert.match(skip[0]!.advice, /« Clauses »/)
  // Le H1 et le titre de la page : un mot important en commun suffit, accents et majuscules près.
  assert.deepEqual(tipsOf([h(1, 'Bienvenue chez nous')]), ['h1-unrelated'])
  assert.deepEqual(tipsOf([h(1, 'Avocat en DROIT des sociétés')], { baseTitle: 'Le droit des entreprises', noindex: false }), [])
  assert.deepEqual(tipsOf([h(1, 'Équipe')], { baseTitle: 'Notre equipe', noindex: false }), [])
  // Sans titre de page, ou avec des mots trop courts pour comparer : pas de conseil.
  assert.deepEqual(tipsOf([h(1, 'Bienvenue')], { baseTitle: '', noindex: false }), [])
  assert.deepEqual(tipsOf([h(1, 'Le A et le B')]), [])
  // Page masquée des moteurs : rien.
  assert.deepEqual(tipsOf([], { baseTitle: 'x', noindex: true }), [])
  // Titres du gabarit (en-tête, pied de page) : ni niveau sauté ni titre vide à reprocher à la page.
  assert.deepEqual(tipsOf([h(3, 'Menu', 'header'), h(1, 'Droit des affaires'), h(2, 'Contrats'), h(4, 'Contact', 'footer'), h(5, '', 'footer')]), [])
  assert.deepEqual(tipsOf([h(1, 'Droit des affaires'), h(2, 'Contrats'), h(2, 'Menu', 'aside'), h(4, 'Clauses')]), ['heading-skip'])
  // Deux H1 dont un dans l'en-tête : signalé, en disant que le gabarit est en cause.
  const two = seoOutlineTips([h(1, 'Cabinet Durand', 'header'), h(1, 'Droit des affaires')], page)
  assert.deepEqual(two.map(t => t.id), ['h1-multiple'])
  assert.match(two[0]!.advice, /gabarit/)
})
