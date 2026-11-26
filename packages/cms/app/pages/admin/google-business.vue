<script setup lang="ts">
import { Copy, ExternalLink, RefreshCw, Settings, Star } from '@lucide/vue'
import { type GooglePlace, formatRating, formatVisit } from '../../../shared/google-business'

/**
 * Avis Google (module `google-business`) : ce que Google Maps dit de l'établissement, tel que le site peut le
 * montrer. On répond aux avis et on change les horaires dans Google : cet écran y conduit.
 */
definePageMeta({ layout: 'admin', middleware: 'cms-auth' })

type Answer = { state: 'ok'; place: GooglePlace; updatedAt: string } | { state: 'unconfigured' | 'refused' | 'unavailable'; message: string }

const user = useCmsUser()
const isAdmin = computed(() => user.value?.role === 'admin')
const toast = useCmsToast()
const loading = ref(false)
const load = () => cmsApi<Answer>('/api/cms/google-business').catch(e => ({ state: 'unavailable' as const, message: cmsErrorMessage(e, 'La fiche Google n\'a pas pu être lue.') }))
const answer = ref<Answer>(await load())
async function reload() { loading.value = true; answer.value = await load(); loading.value = false }
const place = computed(() => (answer.value.state === 'ok' ? answer.value.place : null))
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success('Adresse copiée') }
  catch { toast.error('Copie impossible : sélectionnez l\'adresse à la main.') }
}
</script>

<template>
  <section class="max-w-5xl mx-auto" data-google-business>
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Avis Google</h1>
      <p class="text-sm text-base-content/60">La note, les avis et les horaires de l'établissement sur Google Maps, tels que le site peut les afficher.</p>
    </div>

    <div v-if="answer.state === 'unconfigured'" class="card bg-base-100 border border-base-300 p-8 text-center items-center gap-3" data-gb-state="unconfigured">
      <Star :size="32" class="text-base-content/30" />
      <p class="font-medium">Les avis Google ne sont pas encore réglés.</p>
      <template v-if="isAdmin">
        <p class="text-sm text-base-content/60 max-w-md">Il faut l'identifiant de l'établissement sur Google Maps et une clé d'API.</p>
        <NuxtLink to="/admin/modules/google-business" class="btn btn-primary btn-sm"><Settings :size="16" />Régler les avis Google</NuxtLink>
      </template>
      <p v-else class="text-sm text-base-content/60 max-w-md">Demandez à l'administrateur du site de les régler (écran « Modules »).</p>
    </div>

    <div v-else-if="answer.state !== 'ok'" class="alert alert-soft items-start" :class="answer.state === 'refused' ? 'alert-error' : 'alert-warning'" role="alert" :data-gb-state="answer.state">
      <div class="space-y-2">
        <p class="font-medium">{{ answer.state === 'refused' ? 'Google refuse de donner la fiche de l\'établissement.' : 'La fiche Google n\'est pas disponible pour le moment.' }}</p>
        <p class="text-sm" data-gb-message>{{ answer.message }}</p>
        <p class="text-sm">Sur le site, le bloc des avis n'est pas affiché tant que cela dure.</p>
        <div class="flex flex-wrap gap-2">
          <NuxtLink v-if="answer.state === 'refused' && isAdmin" to="/admin/modules/google-business" class="btn btn-sm"><Settings :size="16" />Vérifier les réglages</NuxtLink>
          <button v-if="answer.state === 'unavailable'" class="btn btn-sm" :disabled="loading" @click="reload"><RefreshCw :size="16" />Réessayer</button>
        </div>
      </div>
    </div>

    <template v-else-if="place">
      <div v-if="place.closed" class="alert alert-warning mb-4" role="alert" data-gb-closed>
        Google Maps indique que l'établissement est {{ place.closed === 'permanently' ? 'définitivement fermé' : 'temporairement fermé' }}. Si c'est une erreur, corrigez la fiche dans Google.
      </div>
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] items-start" data-gb-state="ok">
        <div class="space-y-4 min-w-0">
          <div class="card bg-base-100 border border-base-300 p-5">
            <div class="text-sm text-base-content/60">{{ place.name }}<template v-if="place.address"> · {{ place.address }}</template></div>
            <div v-if="place.rating !== null" class="flex flex-wrap items-baseline gap-x-3 mt-1">
              <span class="text-4xl font-bold tabular-nums" data-gb-rating>{{ formatRating(place.rating) }}</span>
              <span class="text-base-content/60">sur 5 · <span data-gb-count>{{ place.count.toLocaleString('fr-FR') }}</span> avis</span>
            </div>
            <p v-else class="mt-2 text-base-content/70" data-gb-empty>L'établissement n'a pas encore d'avis sur Google Maps.</p>
            <div class="flex flex-wrap gap-2 mt-4">
              <a v-if="place.reviewsUrl" :href="place.reviewsUrl" target="_blank" rel="noopener" class="btn btn-sm"><ExternalLink :size="15" />Voir et répondre dans Google</a>
              <button v-if="place.writeReviewUrl" class="btn btn-sm" data-gb-copy @click="copy(place.writeReviewUrl)"><Copy :size="15" />Copier le lien « Laisser un avis »</button>
            </div>
            <p v-if="place.writeReviewUrl" class="text-xs text-base-content/50 mt-2">Ce lien, envoyé à un client après une prestation (dans un e-mail de workflow, par exemple), ouvre directement la fenêtre d'avis.</p>
          </div>

          <div class="card bg-base-100 border border-base-300">
            <h2 class="font-semibold p-4 border-b border-base-300">Les avis que Google donne au site <span class="font-normal text-sm text-base-content/50">cinq au plus, les plus pertinents selon lui</span></h2>
            <ul v-if="place.reviews.length" class="divide-y divide-base-300">
              <li v-for="(r, i) in place.reviews" :key="r.url ?? i" class="p-4" data-gb-review>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="font-medium">{{ r.author }}</span>
                  <span class="text-warning tracking-tight" :aria-label="`${r.rating} sur 5`">{{ '★'.repeat(r.rating) }}<span class="text-base-content/20">{{ '★'.repeat(5 - r.rating) }}</span></span>
                  <span class="text-sm text-base-content/50">{{ r.when }}<template v-if="r.visit"> · visite : {{ formatVisit(r.visit) }}</template></span>
                  <a v-if="r.url" :href="r.url" target="_blank" rel="noopener" class="btn btn-ghost btn-xs ml-auto"><ExternalLink :size="13" />Répondre</a>
                </div>
                <p v-if="r.text" class="text-sm mt-1.5 whitespace-pre-line break-words">{{ r.text }}</p>
                <p v-else class="text-sm mt-1.5 text-base-content/50 italic">Note sans commentaire.</p>
              </li>
            </ul>
            <p v-else class="p-6 text-sm text-base-content/60">Google ne donne aucun avis pour l'instant.</p>
          </div>
        </div>

        <div class="space-y-4 min-w-0">
          <div class="card bg-base-100 border border-base-300 p-4">
            <h2 class="font-semibold mb-2">Horaires sur Google</h2>
            <ul v-if="place.hours?.lines.length" class="text-sm space-y-1" data-gb-hours><li v-for="line in place.hours.lines" :key="line">{{ line }}</li></ul>
            <p v-else class="text-sm text-base-content/60">La fiche n'a pas d'horaires.</p>
            <p class="text-xs text-base-content/50 mt-3">Ils se changent dans la fiche Google de l'établissement. Si le site ne déclare pas ses propres horaires, ce sont eux qui sont transmis aux moteurs de recherche avec la page d'accueil.</p>
          </div>
          <div class="card bg-base-100 border border-base-300 p-4 text-sm space-y-2">
            <h2 class="font-semibold">Sur le site</h2>
            <p>Le composant <code>&lt;CmsGoogleReviews /&gt;</code> affiche la note et les avis, avec les mentions que Google demande.</p>
            <p class="text-base-content/60">Google interdit d'enregistrer les avis : ils sont relus chez lui toutes les heures, et un avis nouveau ou supprimé peut mettre ce temps à apparaître ici.</p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
