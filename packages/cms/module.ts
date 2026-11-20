import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { addTemplate, addTypeTemplate, defineNuxtModule } from '@nuxt/kit'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

/**
 * Branche le core sur le projet client :
 * - rend son `cms.config.ts` accessible sous le nom `#cms-config` ;
 * - prépare, sous `#cms-icons`, les seules icônes Lucide citées dans ce fichier (option `icon`),
 *   pour ne pas embarquer toute la bibliothèque dans le back-office ;
 * - déduit de ce fichier, sous `#cms-types`, le type de chaque contenu : les pages du site ont l'autocomplétion des champs.
 */
export default defineNuxtModule({
  meta: { name: 'backoffice-core' },
  async setup(_options, nuxt) {
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
