import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { addTemplate, addTypeTemplate, defineNuxtModule, installModule } from '@nuxt/kit'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import cloudflareDev from 'nitro-cloudflare-dev'

/**
 * Branche le core sur le projet client :
 * - rend son `cms.config.ts` accessible sous le nom `#cms-config` ;
 * - prépare, sous `#cms-icons`, les seules icônes Lucide citées dans ce fichier (option `icon`),
 *   pour ne pas embarquer toute la bibliothèque dans le back-office ;
 * - déduit de ce fichier, sous `#cms-types`, le type de chaque contenu : les pages du site ont l'autocomplétion des champs ;
 * - transmet aux pages du site les réglages de référencement (`site.titleSuffix`, `site.shareImage`), lus par `useCmsSeo`.
 * - sert les polices proposées par l'écran Apparence (dossier `fonts/`) sous `/_cms/fonts/` ;
 * - branche le core sur l'hébergement choisi (`cms: { target }` dans le nuxt.config.ts du site) : Cloudflare ou serveur Node.
 */

/** Où le site est hébergé : chez Cloudflare (Workers, D1, R2), ou sur un serveur Node ordinaire (Docker, VPS…). */
export type CmsTarget = 'cloudflare' | 'node'
export type CmsModuleOptions = {
  /**
   * Hébergement du site. Par défaut « cloudflare ». La variable d'environnement CMS_TARGET passe avant ce réglage.
   */
  target?: CmsTarget
}

export default defineNuxtModule<CmsModuleOptions>({
  meta: { name: 'backoffice-core', configKey: 'cms' },
  async setup(options, nuxt) {
    const here = dirname(fileURLToPath(import.meta.url))
    const target = process.env.CMS_TARGET || options.target || 'cloudflare'
    if (target !== 'cloudflare' && target !== 'node') throw new Error(`[backoffice-core] Hébergement inconnu : « ${target} ». Valeurs possibles : cloudflare, node.`)

    // L'hébergement : `#cms-platform` désigne la version du core écrite pour lui (server/platform).
    const platform = resolve(here, 'server/platform', target)
    nuxt.options.alias['#cms-platform'] = platform
    nuxt.options.nitro.alias = { ...nuxt.options.nitro.alias, '#cms-platform': platform }
    // Ce que seule la version « serveur Node » utilise est décrit dans tous les cas : TypeScript relit ses fichiers partout.
    addTypeTemplate({
      filename: 'types/cms-platform.d.ts',
      getContents: () => `declare module '#cms-migrations' {\n  const migrations: { name: string; sql: string }[]\n  export default migrations\n}\n`,
    }, { nitro: true, nuxt: true })
    const useImages = (file: string) => {
      const images = resolve(here, 'server/platform/node', file)
      nuxt.options.alias['#cms-images'] = images
      nuxt.options.nitro.alias = { ...nuxt.options.nitro.alias, '#cms-images': images }
    }
    if (target === 'cloudflare') {
      nuxt.options.nitro.preset ??= 'cloudflare_module'
      useImages('images-none')
      // Les liaisons Cloudflare (D1, R2…) dans le serveur de développement.
      await installModule(cloudflareDev)
    }
    else {
      nuxt.options.nitro.preset ??= 'node-server'
      // sharp redimensionne les images s'il est installé dans le projet du site ; sinon elles sont servies telles quelles.
      const sharp = (() => { try { createRequire(join(nuxt.options.rootDir, 'package.json')).resolve('sharp'); return true } catch { return false } })()
      if (!sharp) console.warn('[backoffice-core] Paquet « sharp » absent : les images seront servies dans leur taille d\'origine (pnpm add sharp).')
      useImages(sharp ? 'images-sharp' : 'images-none')
      // Les migrations de la base voyagent avec le serveur, qui les applique à son démarrage.
      const dir = resolve(here, 'server/database/migrations')
      const migrations = readdirSync(dir).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
      nuxt.options.nitro.virtual = { ...nuxt.options.nitro.virtual, '#cms-migrations': `export default ${JSON.stringify(migrations)}` }
    }

    // Polices proposées dans l'écran Apparence : servies par le site lui-même, sans service tiers (shared/fonts.ts).
    nuxt.options.nitro.publicAssets = [...(nuxt.options.nitro.publicAssets ?? []), { dir: resolve(here, 'fonts'), baseURL: '/_cms/fonts', maxAge: 60 * 60 * 24 * 365 }]

    const file = resolve(nuxt.options.rootDir, 'cms.config.ts')
    if (!existsSync(file)) throw new Error(`[backoffice-core] Fichier introuvable : ${file}`)
    nuxt.options.alias['#cms-config'] = file
    nuxt.options.nitro.alias = { ...nuxt.options.nitro.alias, '#cms-config': file }
    // Une icône ajoutée dans la configuration demande de régénérer la liste : le serveur de développement redémarre.
    nuxt.options.watch.push(file)

    // Redirections manuelles : un gestionnaire d'erreurs placé avant celui de Nuxt. Il ne s'exécute que pour une demande
    // qui échoue (page introuvable) : voir server/redirects-error-handler.ts.
    nuxt.hook('nitro:config', (nitroConfig) => {
      const handler = resolve(dirname(fileURLToPath(import.meta.url)), 'server/redirects-error-handler')
      nitroConfig.errorHandler = [handler, ...[nitroConfig.errorHandler ?? []].flat()]
    })

    // Lire la configuration ici la valide aussi : une erreur arrête le démarrage avec un message clair.
    const config = await createJiti(nuxt.options.rootDir).import<any>(file, { default: true })
    // Réglages de référencement du site, pour `useCmsSeo` : les pages n'embarquent pas toute la configuration.
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    publicConfig.cmsSeo = { siteName: String(config.site?.name ?? ''), titleSuffix: String(config.site?.titleSuffix ?? ''), shareImage: String(config.site?.shareImage ?? ''), defaultLocale: String(config.site?.defaultLocale ?? '') }
    // Provenance des contacts : lue par le site à l'arrivée du visiteur (`site.attribution`).
    const attribution = config.site?.attribution
    publicConfig.cmsAttribution = { enabled: attribution !== false, rememberDays: attribution ? Number(attribution.rememberDays ?? 0) : 0 }
    const definitions = [...Object.values(config.singletons ?? {}), ...Object.values(config.collections ?? {})] as { icon?: string; label: string }[]
    const iconsDir = join(dirname(createRequire(import.meta.url).resolve('@lucide/vue')), '../esm/icons')
    const names = [...new Set(definitions.map(d => d.icon).filter((n): n is string => !!n))].filter((name) => {
      const found = /^[a-z0-9-]+$/.test(name) && existsSync(join(iconsDir, `${name}.mjs`))
      if (!found) console.warn(`[backoffice-core] Icône « ${name} » inconnue de Lucide (https://lucide.dev/icons) : icône par défaut utilisée.`)
      return found
    })

    const template = addTemplate({
      filename: 'cms-icons.mjs',
      getContents: () => [
        ...names.map((name, i) => `import icon${i} from ${JSON.stringify(join(iconsDir, `${name}.mjs`))}`),
        `export default { ${names.map((name, i) => `${JSON.stringify(name)}: icon${i}`).join(', ')} }`,
      ].join('\n'),
    })
    nuxt.options.alias['#cms-icons'] = template.dst
    addTypeTemplate({
      filename: 'types/cms-icons.d.ts',
      getContents: () => `declare module '#cms-icons' {\n  const icons: Record<string, import('vue').Component>\n  export default icons\n}\n`,
    })

    // Types des contenus, calculés par TypeScript à partir de la configuration : rien à régénérer quand elle change.
    const format = resolve(dirname(fileURLToPath(import.meta.url)), 'shared/format')
    addTypeTemplate({
      filename: 'types/cms-types.d.ts',
      getContents: () => `declare module '#cms-types' {
  type Config = typeof import(${JSON.stringify(file.replace(/\.ts$/, ''))}).default
  type Entry<T> = import(${JSON.stringify(format)}).InferEntry<T>
  type Defined<T> = T extends object ? T : {}
  /** Le contenu de chaque collection, tel que le site le reçoit. */
  export type CmsCollections = { [K in keyof Defined<Config['collections']>]: Entry<Defined<Config['collections']>[K]> }
  /** Le contenu de chaque page unique, tel que le site le reçoit. */
  export type CmsSingletons = { [K in keyof Defined<Config['singletons']>]: Entry<Defined<Config['singletons']>[K]> }
  /** Les valeurs de chaque formulaire du site (module « forms »), pour \`useCmsForm\`. */
  export type CmsForms = [Forms] extends [never] ? Record<string, Record<string, any>> : Forms
  type Forms = import(${JSON.stringify(resolve(dirname(format), 'modules'))}).InferForms<Config>
  /** Les collections vendables (module « stripe »), pour \`useCmsCheckout\`. */
  export type CmsSellable = [Sellable] extends [never] ? string : Sellable
  type Sellable = import(${JSON.stringify(resolve(dirname(format), 'stripe'))}).InferSellable<Config>
}
`,
    })
  },
})
