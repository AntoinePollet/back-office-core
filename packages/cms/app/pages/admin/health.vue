<script setup lang="ts">
import { CircleCheck, ExternalLink, FileSearch, HeartPulse, ImageOff, Link2Off, RefreshCw, Sparkles, Trash2, Weight } from '@lucide/vue'
import { HEALTH_LIMITS, type HealthReport, type HealthUse, type LinkVerdict, VERDICT_LABELS, healthCertainCount, verdictForStatus } from '../../../shared/health'

/**
 * Santé du site : liens cassés, images sans texte alternatif ou trop lourdes, fichiers inutilisés, dans les contenus
 * en ligne que la personne peut modifier. Le serveur dit tout de suite ce qui est certain ; les liens vers des
 * adresses qu'il ne connaît pas sont ensuite vérifiés un à un, les pages du site par le navigateur, les autres sites
 * par le serveur (voir `shared/health.ts`).
 */
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Checked = { href: string; internal: boolean; verdict: LinkVerdict; detail: string; uses: HealthUse[] }

const load = () => cmsApi<HealthReport>('/api/cms/health')

// Module « Assistant de rédaction » : texte alternatif proposé pour une image, relu ici puis enregistré.
const assistant = useCmsAssistant()
const assistantToast = useCmsToast()
const proposals = reactive<Record<string, string>>({})
const defaultLocale = useState<{ site: { defaultLocale: string } } | null>('cms-schema').value?.site.defaultLocale ?? 'fr'
async function proposeAlt(id: string) {
  const proposed = await assistant.alt(id, defaultLocale)
  if (proposed) proposals[id] = proposed
}
async function saveAlt(id: string) {
  try {
    // L'enregistrement remplace le texte de toutes les langues : celui des autres langues est relu, puis renvoyé tel quel.
    const current = (await useCmsMedia().load()).find(m => m.id === id)?.alt ?? {}
    const { purgeFailed } = await cmsApi<{ purgeFailed: boolean }>(`/api/cms/media/${id}`, { method: 'PATCH', body: { alt: { ...current, [defaultLocale]: proposals[id]!.trim() } } })
    cmsSiteUpdated({ purgeFailed })
    delete proposals[id]
    report.value = { ...report.value, images: { ...report.value.images, withoutAlt: report.value.images.withoutAlt.filter(file => file.id !== id) } }
    assistantToast.success('Texte alternatif enregistré')
  }
  catch (e) {
    assistantToast.error(cmsErrorMessage(e))
  }
}
const report = ref(await load().catch((e) => { throw createError({ statusCode: e?.statusCode ?? 500, message: cmsErrorMessage(e), fatal: true }) }))
const schema = await useCmsSchema()
const multi = (schema.value.site.locales as readonly string[]).length > 1
const toast = useCmsToast()
// Site fermé au public : toutes les pages répondent par la page d'attente, les vérifier ne dirait rien.
// L'état est relu avant chaque vérification (celui du menu peut ne pas être encore arrivé, ou dater).
const siteClosed = ref(false)

// ───── Vérification des liens, après l'affichage ─────
const checked = ref<Checked[]>([])
const total = computed(() => (siteClosed.value ? 0 : report.value.links.internal.length) + report.value.links.external.length)
// Vrai dès l'affichage : la première vérification part au montage, et l'écran ne dit pas « terminé » avant elle.
const checking = ref(true)
let run = 0

async function checkInternal(path: string): Promise<{ verdict: LinkVerdict; detail: string }> {
  try {
    // Sans la session du back-office : la page telle qu'un visiteur la reçoit. L'en-tête évite de compter ces
    // demandes parmi les « pages introuvables ».
    const response = await fetch(path, { credentials: 'omit', cache: 'no-store', headers: { 'x-cms-health': '1' } })
    const verdict = verdictForStatus(response.status)
    return { verdict, detail: verdict === 'ok' ? '' : `Réponse ${response.status}.` }
  }
  catch {
    return { verdict: 'down', detail: 'La page n\'a pas répondu.' }
  }
}

async function verifyLinks() {
  const mine = ++run
  checked.value = []
  checking.value = true
  const { internal, external } = report.value.links
  try {
    siteClosed.value = await cmsApi<{ mode: string }>('/api/cms/availability').then(r => r.mode !== 'online', () => false)
    if (mine !== run) return
    const pages = siteClosed.value ? [] : [...internal]
    // Quelques pages du site à la fois ; les autres sites par paquets envoyés au serveur.
    await Promise.all(Array.from({ length: HEALTH_LIMITS.internalParallel }, async () => {
      for (let item = pages.shift(); item; item = pages.shift()) {
        const result = await checkInternal(item.path)
        if (mine !== run) return
        checked.value.push({ href: item.path, internal: true, uses: item.uses, ...result })
      }
    }))
    for (let i = 0; i < external.length; i += HEALTH_LIMITS.externalBatch) {
      const batch = external.slice(i, i + HEALTH_LIMITS.externalBatch)
      const { results } = await cmsApi<{ results: { url: string; verdict: LinkVerdict; detail: string }[] }>('/api/cms/health/links', { method: 'POST', body: { urls: batch.map(b => b.url) }, busy: false })
        .catch(() => ({ results: batch.map(b => ({ url: b.url, verdict: 'unknown' as const, detail: 'La vérification n\'a pas pu être faite.' })) }))
      if (mine !== run) return
      for (const item of batch) {
        const result = results.find(r => r.url === item.url)
        checked.value.push({ href: item.url, internal: false, uses: item.uses, verdict: result?.verdict ?? 'unknown', detail: result?.detail ?? '' })
      }
    }
  }
  finally {
    if (mine === run) checking.value = false
  }
}
onMounted(verifyLinks)
onBeforeUnmount(() => { run++ })

async function refresh() {
  try {
    report.value = await load()
    await verifyLinks()
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

const dead = computed(() => checked.value.filter(c => c.verdict === 'broken' || c.verdict === 'down'))
const unverifiable = computed(() => checked.value.filter(c => c.verdict === 'unknown'))
const linkProblems = computed(() => report.value.links.missingPages.length + report.value.links.invalid.length + dead.value.length)
const done = computed(() => !checking.value && checked.value.length >= total.value)
const allGood = computed(() => done.value && !linkProblems.value && !healthCertainCount(report.value))
const verdictClass: Record<LinkVerdict, string> = { ok: 'badge-success', broken: 'badge-error', down: 'badge-warning', unknown: 'badge-ghost' }
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
</script>

<template>
  <section class="max-w-5xl mx-auto space-y-6" data-health :data-health-state="checking ? 'checking' : 'done'">
    <div class="flex flex-wrap items-start gap-3">
      <div class="grow min-w-0">
        <h1 class="text-2xl font-bold">Santé du site</h1>
        <p class="text-sm text-base-content/60">
          Ce qui gêne un visiteur ou un moteur de recherche dans les contenus en ligne : liens qui ne mènent nulle part, images sans description, images trop lourdes.
          {{ plural(report.examined, 'page ou contenu examiné', 'pages et contenus examinés') }}, {{ plural(report.links.total, 'lien', 'liens') }}.
        </p>
      </div>
      <button class="btn btn-sm" :disabled="checking" @click="refresh"><RefreshCw :size="16" :class="{ 'animate-spin': checking }" />Vérifier à nouveau</button>
    </div>

    <div v-if="allGood" class="card bg-base-100 border border-base-300 p-8 text-center" data-health-ok>
      <CircleCheck :size="32" class="mx-auto text-success mb-2" />
      <p class="font-medium">Rien à signaler.</p>
      <p class="text-sm text-base-content/60">Tous les liens répondent et toutes les images utilisées ont un texte alternatif.</p>
    </div>

    <!-- Liens -->
    <section class="card bg-base-100 border border-base-300" data-health-section="links">
      <div class="p-4 flex flex-wrap items-center gap-3 border-b border-base-300">
        <Link2Off :size="18" class="shrink-0 text-base-content/60" />
        <h2 class="font-semibold grow">Liens</h2>
        <span v-if="checking" class="text-xs text-base-content/60 flex items-center gap-2" data-health-progress>
          <span class="loading loading-spinner loading-xs" />Vérification {{ checked.length }} / {{ total }}
        </span>
        <span v-else class="badge badge-sm" :class="linkProblems ? 'badge-warning' : 'badge-success badge-soft'" data-health-count="links">{{ linkProblems ? plural(linkProblems, 'lien à corriger', 'liens à corriger') : 'Aucun lien cassé' }}</span>
      </div>
      <ul class="divide-y divide-base-300 text-sm">
        <li v-for="(issue, i) in report.links.missingPages" :key="`m${i}`" class="p-4 space-y-1" data-health-issue="missing-page">
          <div><span class="badge badge-sm badge-error mr-2">Page hors ligne</span>Le lien mène à {{ issue.target }}.</div>
          <div class="text-base-content/70">
            Dans <NuxtLink :to="issue.to" class="link link-primary">{{ issue.name }}</NuxtLink><span v-if="multi" class="badge badge-xs badge-ghost uppercase ml-1">{{ issue.locale }}</span>, champ « {{ issue.field }} ». Le site n'affiche plus ce lien.
          </div>
        </li>
        <li v-for="(issue, i) in report.links.invalid" :key="`i${i}`" class="p-4 space-y-1" data-health-issue="invalid">
          <div class="break-all"><span class="badge badge-sm badge-error mr-2">Adresse mal écrite</span><code>{{ issue.href }}</code></div>
          <div class="text-base-content/70">
            {{ issue.reason }} Dans <NuxtLink :to="issue.to" class="link link-primary">{{ issue.name }}</NuxtLink><span v-if="multi" class="badge badge-xs badge-ghost uppercase ml-1">{{ issue.locale }}</span>, champ « {{ issue.field }} ».
          </div>
        </li>
        <li v-for="link in dead" :key="link.href" class="p-4 space-y-1" data-health-issue="dead" :data-health-verdict="link.verdict">
          <div class="break-all">
            <span class="badge badge-sm mr-2" :class="verdictClass[link.verdict]">{{ VERDICT_LABELS[link.verdict] }}</span>
            <a :href="link.href" target="_blank" rel="noopener" class="link">{{ link.href }}<ExternalLink :size="12" class="inline ml-1" /></a>
            <span class="text-base-content/50 ml-2">{{ link.detail }}</span>
          </div>
          <div class="text-base-content/70">
            Dans
            <template v-for="(use, j) in link.uses.slice(0, 5)" :key="j">
              <template v-if="j">, </template><NuxtLink :to="use.to" class="link link-primary">{{ use.name }}</NuxtLink><span v-if="multi" class="badge badge-xs badge-ghost uppercase ml-1">{{ use.locale }}</span> (« {{ use.field }} »)</template><template v-if="link.uses.length > 5"> et {{ link.uses.length - 5 }} autres</template>.
          </div>
        </li>
      </ul>
      <p v-if="!linkProblems && !checking" class="p-4 text-sm text-base-content/60">
        {{ report.links.total ? 'Tous les liens vérifiés répondent.' : 'Aucun lien dans les contenus en ligne.' }}
      </p>
      <p v-if="siteClosed && report.links.internal.length" class="px-4 pb-3 text-xs text-warning" data-health-closed>
        Le site est fermé au public : {{ plural(report.links.internal.length, 'lien vers une page du site n\'a pas été vérifié', 'liens vers des pages du site n\'ont pas été vérifiés') }}.
      </p>
      <details v-if="unverifiable.length" class="px-4 pb-3 text-xs text-base-content/60" data-health-unknown>
        <summary class="cursor-pointer">{{ plural(unverifiable.length, 'lien n\'a pas pu être vérifié', 'liens n\'ont pas pu être vérifiés') }} : le site visé refuse les vérifications automatiques. Ce n'est pas forcément un problème.</summary>
        <ul class="mt-2 space-y-1"><li v-for="link in unverifiable" :key="link.href" class="break-all"><a :href="link.href" target="_blank" rel="noopener" class="link">{{ link.href }}</a> {{ link.detail }}</li></ul>
      </details>
    </section>

    <!-- Images sans texte alternatif -->
    <section class="card bg-base-100 border border-base-300" data-health-section="alt">
      <div class="p-4 flex flex-wrap items-center gap-3 border-b border-base-300">
        <ImageOff :size="18" class="shrink-0 text-base-content/60" />
        <h2 class="font-semibold grow">Images sans texte alternatif</h2>
        <span class="badge badge-sm" :class="report.images.withoutAlt.length ? 'badge-warning' : 'badge-success badge-soft'" data-health-count="alt">{{ report.images.withoutAlt.length || 'Aucune' }}</span>
      </div>
      <p class="px-4 pt-3 text-xs text-base-content/60">Le texte alternatif décrit l'image en une phrase : c'est lui que lisent Google et les personnes qui ne voient pas l'image. Il se saisit une fois, dans la médiathèque.</p>
      <ul class="p-4 pt-2 text-sm space-y-1">
        <li v-for="file in report.images.withoutAlt" :key="file.id" class="flex flex-wrap items-baseline gap-x-3" data-health-issue="alt">
          <NuxtLink :to="file.to" class="link link-primary break-all">{{ file.name }}</NuxtLink>
          <span class="text-base-content/50">{{ plural(file.uses, 'utilisation', 'utilisations') }}</span>
          <!-- Module « Assistant de rédaction » : proposition à relire, puis à enregistrer d'ici. -->
          <template v-if="assistant.active.value">
            <button v-if="proposals[file.id] === undefined" type="button" class="btn btn-xs" :disabled="!!assistant.busy.value" data-health-suggest @click="proposeAlt(file.id)">
              <span v-if="assistant.busy.value?.startsWith(`alt:${file.id}:`)" class="loading loading-spinner loading-xs" /><Sparkles v-else :size="13" />Proposer
            </button>
            <form v-else class="basis-full flex flex-wrap items-center gap-2 mt-1" data-health-proposal @submit.prevent="saveAlt(file.id)">
              <input v-model="proposals[file.id]" class="input input-sm grow min-w-48" maxlength="300" :aria-label="`Texte alternatif de ${file.name}`">
              <button class="btn btn-sm btn-primary" :disabled="!proposals[file.id]?.trim()">Enregistrer</button>
              <button type="button" class="btn btn-sm btn-ghost" @click="delete proposals[file.id]">Annuler</button>
            </form>
          </template>
        </li>
        <li v-if="!report.images.withoutAlt.length" class="text-base-content/60">Toutes les images utilisées en ont un.</li>
      </ul>
    </section>

    <!-- Images lourdes -->
    <section v-if="report.images.heavy.length" class="card bg-base-100 border border-base-300" data-health-section="heavy">
      <div class="p-4 flex flex-wrap items-center gap-3 border-b border-base-300">
        <Weight :size="18" class="shrink-0 text-base-content/60" />
        <h2 class="font-semibold grow">Images lourdes</h2>
        <span class="badge badge-sm badge-warning" data-health-count="heavy">{{ report.images.heavy.length }}</span>
      </div>
      <p class="px-4 pt-3 text-xs text-base-content/60">Au-delà de {{ formatFileSize(HEALTH_LIMITS.heavyImageBytes) }}, une image ralentit la page là où elle est servie telle quelle. Enregistrez-la en JPEG ou en WebP à 2 000 pixels de large au plus, puis remplacez-la.</p>
      <ul class="p-4 pt-2 text-sm space-y-1">
        <li v-for="file in report.images.heavy" :key="file.id" class="flex flex-wrap items-baseline gap-x-3" data-health-issue="heavy">
          <NuxtLink :to="file.to" class="link link-primary break-all">{{ file.name }}</NuxtLink>
          <span class="font-medium">{{ formatFileSize(file.size) }}</span>
          <span class="text-base-content/50">{{ plural(file.uses, 'utilisation', 'utilisations') }}</span>
        </li>
      </ul>
    </section>

    <!-- Référencement -->
    <section v-if="report.seo" class="card bg-base-100 border border-base-300 p-4 flex flex-row flex-wrap items-center gap-3" data-health-section="seo">
      <FileSearch :size="18" class="shrink-0 text-base-content/60" />
      <div class="grow min-w-0 text-sm">
        <h2 class="font-semibold text-base">Référencement</h2>
        <p class="text-base-content/70">
          <template v-if="report.seo.improve">{{ plural(report.seo.improve, 'page à améliorer', 'pages à améliorer') }} sur {{ report.seo.pages }}<template v-if="report.seo.missingTitle || report.seo.missingDescription"> (dont {{ [report.seo.missingTitle && plural(report.seo.missingTitle, 'sans titre', 'sans titre'), report.seo.missingDescription && plural(report.seo.missingDescription, 'sans description', 'sans description')].filter(Boolean).join(', ') }})</template>.</template>
          <template v-else>Les {{ report.seo.pages }} pages ont un titre et une description.</template>
        </p>
      </div>
      <NuxtLink to="/admin/seo" class="btn btn-sm">Pages et titres</NuxtLink>
    </section>

    <!-- Fichiers inutilisés -->
    <section v-if="report.unused.count" class="card bg-base-100 border border-base-300" data-health-section="unused">
      <details>
        <summary class="p-4 flex flex-wrap items-center gap-3 cursor-pointer">
          <Trash2 :size="18" class="shrink-0 text-base-content/60" />
          <h2 class="font-semibold grow">Fichiers inutilisés</h2>
          <span class="text-sm text-base-content/60" data-health-count="unused">{{ plural(report.unused.count, 'fichier', 'fichiers') }}, {{ formatFileSize(report.unused.size) }}</span>
        </summary>
        <p class="px-4 text-xs text-base-content/60">Ces fichiers de la médiathèque ne sont cités par aucun contenu, brouillon ou réglage. Rien d'urgent : ils ne ralentissent pas le site. Un fichier supprimé reste 30 jours dans la corbeille.</p>
        <ul class="p-4 pt-2 text-sm space-y-1">
          <li v-for="file in report.unused.files" :key="file.id" class="flex flex-wrap items-baseline gap-x-3" data-health-issue="unused">
            <NuxtLink :to="file.to" class="link link-primary break-all">{{ file.name }}</NuxtLink><span class="text-base-content/50">{{ formatFileSize(file.size) }}</span>
          </li>
          <li v-if="report.unused.count > report.unused.files.length" class="text-base-content/50">… et {{ report.unused.count - report.unused.files.length }} autres.</li>
        </ul>
      </details>
    </section>

    <p class="text-xs text-base-content/50 flex gap-2"><HeartPulse :size="14" class="shrink-0 mt-0.5" />Ce sont les versions en ligne qui sont examinées : une correction disparaît de cette liste une fois publiée.</p>
  </section>
</template>
