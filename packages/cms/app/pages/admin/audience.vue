<script setup lang="ts">
import { ChartLine, RefreshCw, Settings } from '@lucide/vue'
import type { AudienceStats } from '../../../shared/analytics'

// L'audience est ouverte à l'administrateur et à l'éditeur (le serveur le vérifie aussi).
definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-editor'] })

type Answer =
  | { state: 'ok'; stats: AudienceStats; updatedAt: string }
  | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

const user = useCmsUser()
const isAdmin = computed(() => user.value?.role === 'admin')
const period = ref<7 | 30>(7)
const answer = ref<Answer | null>(null)
const loading = ref(false)
let request = 0

async function load() {
  const mine = ++request
  loading.value = true
  try {
    const result = await cmsApi<Answer>('/api/cms/audience', { query: { period: period.value } })
    if (mine === request) answer.value = result
  }
  catch (e) {
    if (mine === request) answer.value = { state: 'unavailable', message: cmsErrorMessage(e, 'Les statistiques n\'ont pas pu être lues.') }
  }
  finally {
    if (mine === request) loading.value = false
  }
}
await load()
watch(period, load)

const stats = computed(() => (answer.value?.state === 'ok' ? answer.value.stats : null))
const empty = computed(() => !!stats.value && stats.value.totals.pageViews === 0)
const format = (n: number) => n.toLocaleString('fr-FR')
const maxPage = computed(() => Math.max(1, ...(stats.value?.pages ?? []).map(p => p.pageViews)))
const maxReferrer = computed(() => Math.max(1, ...(stats.value?.referrers ?? []).map(r => r.visits)))
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)
</script>

<template>
  <section class="max-w-5xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div class="min-w-0 grow">
        <h1 class="text-2xl font-bold">Audience</h1>
        <p class="text-sm text-base-content/60">La fréquentation du site, mesurée sans cookie.</p>
      </div>
      <div class="join" role="group" aria-label="Période">
        <button v-for="p in [7, 30] as const" :key="p" class="btn btn-sm join-item" :class="period === p ? 'btn-primary' : ''" :aria-pressed="period === p" @click="period = p">{{ p }} jours</button>
      </div>
    </div>

    <!-- Module pas encore réglé. -->
    <div v-if="answer?.state === 'unconfigured'" class="card bg-base-100 border border-base-300 p-8 text-center items-center gap-3">
      <ChartLine :size="32" class="text-base-content/30" />
      <p class="font-medium">La mesure d'audience n'est pas encore réglée.</p>
      <template v-if="isAdmin">
        <p class="text-sm text-base-content/60 max-w-md">Il faut saisir une fois les identifiants de Cloudflare Web Analytics. Les statistiques apparaîtront ensuite ici.</p>
        <NuxtLink to="/admin/modules/analytics" class="btn btn-primary btn-sm"><Settings :size="16" />Régler la mesure d'audience</NuxtLink>
      </template>
      <p v-else class="text-sm text-base-content/60 max-w-md">Demandez à l'administrateur du site de la régler (écran « Modules »).</p>
    </div>

    <!-- Jeton refusé, ou panne. -->
    <div v-else-if="answer && answer.state !== 'ok'" class="alert alert-soft items-start" :class="answer.state === 'refused' ? 'alert-error' : 'alert-warning'" role="alert">
      <div class="space-y-2">
        <p class="font-medium">{{ answer.state === 'refused' ? 'Cloudflare refuse l\'accès aux statistiques.' : 'Les statistiques ne sont pas disponibles pour le moment.' }}</p>
        <p class="text-sm">{{ answer.message }}</p>
        <p v-if="answer.state === 'refused' && !isAdmin" class="text-sm">Prévenez l'administrateur du site : un réglage est à corriger.</p>
        <div class="flex flex-wrap gap-2">
          <NuxtLink v-if="answer.state === 'refused' && isAdmin" to="/admin/modules/analytics" class="btn btn-sm"><Settings :size="16" />Vérifier les réglages</NuxtLink>
          <button v-if="answer.state === 'unavailable'" class="btn btn-sm" :disabled="loading" @click="load"><RefreshCw :size="16" />Réessayer</button>
        </div>
      </div>
    </div>

    <template v-else-if="stats">
      <div class="transition-opacity" :class="loading ? 'opacity-50' : ''">
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Visites</div>
            <div class="text-3xl font-bold tabular-nums" data-total="visits">{{ format(stats.totals.visits) }}</div>
            <div class="text-xs text-base-content/50 mt-1">Arrivées sur le site depuis un autre site ou en direct</div>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5">
            <div class="text-sm text-base-content/60">Pages vues</div>
            <div class="text-3xl font-bold tabular-nums" data-total="pageViews">{{ format(stats.totals.pageViews) }}</div>
            <div class="text-xs text-base-content/50 mt-1">Toutes les pages ouvertes, y compris pendant une même visite</div>
          </div>
        </div>

        <div v-if="empty" class="card bg-base-100 border border-base-300 p-8 text-center items-center gap-2">
          <ChartLine :size="32" class="text-base-content/30" />
          <p class="font-medium">Pas encore de visite enregistrée sur ces {{ period }} jours.</p>
          <p class="text-sm text-base-content/60 max-w-md">Les visites apparaissent quelques minutes après les premiers passages sur le site. Les vôtres comptent aussi, sauf celles faites depuis le back-office ou un aperçu.</p>
        </div>

        <template v-else>
          <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 mb-4">
            <h2 class="font-semibold mb-3">Jour par jour</h2>
            <CmsAudienceChart :days="stats.days" />
          </div>

          <div class="grid lg:grid-cols-2 gap-4">
            <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 min-w-0">
              <h2 class="font-semibold mb-3">Pages les plus vues</h2>
              <ol class="space-y-2.5" data-list="pages">
                <li v-for="p in stats.pages" :key="p.path" class="text-sm">
                  <div class="flex items-baseline justify-between gap-3">
                    <a :href="p.path" target="_blank" class="min-w-0 truncate hover:underline" :title="p.path">{{ p.path }}</a>
                    <span class="tabular-nums font-medium shrink-0">{{ format(p.pageViews) }}</span>
                  </div>
                  <div class="h-1.5 rounded-full bg-base-200 mt-1 overflow-hidden"><div class="h-full rounded-full bg-primary/70" :style="{ width: `${(p.pageViews / maxPage) * 100}%` }" /></div>
                </li>
              </ol>
            </div>
            <div class="card bg-base-100 border border-base-300 p-4 sm:p-5 min-w-0">
              <h2 class="font-semibold mb-3">D'où viennent les visiteurs</h2>
              <ol v-if="stats.referrers.length" class="space-y-2.5" data-list="referrers">
                <li v-for="r in stats.referrers" :key="r.host ?? ''" class="text-sm">
                  <div class="flex items-baseline justify-between gap-3">
                    <span v-if="r.host" class="min-w-0 truncate" :title="r.host">{{ r.host }}</span>
                    <span v-else class="min-w-0 truncate text-base-content/70">Accès direct <span class="text-base-content/50">(adresse tapée, favori, application)</span></span>
                    <span class="tabular-nums font-medium shrink-0">{{ format(r.visits) }} {{ plural(r.visits, 'visite', 'visites') }}</span>
                  </div>
                  <div class="h-1.5 rounded-full bg-base-200 mt-1 overflow-hidden"><div class="h-full rounded-full bg-base-content/35" :style="{ width: `${(r.visits / maxReferrer) * 100}%` }" /></div>
                </li>
              </ol>
              <p v-else class="text-sm text-base-content/60">Aucune visite venue d'un autre site sur cette période.</p>
            </div>
          </div>
        </template>
      </div>

      <p class="text-xs text-base-content/50 mt-4">
        Source : Cloudflare Web Analytics, sans cookie. Chiffres relus toutes les 5 minutes (dernière lecture {{ cmsFormatWhen(answer!.state === 'ok' ? answer!.updatedAt : new Date()) }}).
        Les journées sont comptées en heure universelle ; les robots connus sont écartés.
      </p>
    </template>
  </section>
</template>
