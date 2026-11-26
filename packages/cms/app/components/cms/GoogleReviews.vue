<script setup lang="ts">
import { formatRating, formatVisit, reviewTexts } from '../../../shared/google-business'

/**
 * Les avis Google de l'établissement (module `google-business`), tels que Google demande de les montrer : auteur
 * (photo, nom, lien), note, date, lien vers l'avis, mention « Google Maps » et phrase sur l'ordre des avis.
 * N'affiche rien tant que le module n'est pas actif et réglé, ou si l'établissement n'a pas d'avis.
 *
 *   <CmsGoogleReviews />                       les cinq avis, sous la note
 *   <CmsGoogleReviews :max="3" :min-rating="4" />   trois avis au plus, de quatre étoiles ou plus
 *   <CmsGoogleReviews summary />               la note et le nombre d'avis seulement
 *
 * Le composant n'impose que sa mise en page : il reprend la police et les couleurs de la page. Ses couleurs se
 * règlent par `--cms-reviews-star` (étoiles) et `--cms-reviews-border`.
 */
const props = withDefaults(defineProps<{
  /** Langue des textes ; par défaut celle du site. */
  locale?: string
  /** Nombre d'avis affichés (Google en donne cinq au plus). */
  max?: number
  /** N'affiche que les avis d'au moins cette note. */
  minRating?: number
  /** La note et le nombre d'avis seulement, sans les avis. */
  summary?: boolean
}>(), { max: 5, minRating: 1, summary: false })

const { data: place } = await useCmsGoogleBusiness({ locale: () => props.locale })
const lang = computed(() => props.locale ?? 'fr')
const t = computed(() => reviewTexts(lang.value))
const reviews = computed(() => (props.summary ? [] : (place.value?.reviews ?? []).filter(r => r.rating >= props.minRating).slice(0, props.max)))
const shown = computed(() => !!place.value && place.value.rating !== null)
</script>

<template>
  <section v-if="shown && place" class="cms-reviews" data-cms-reviews>
    <header class="cms-reviews-head">
      <span class="cms-reviews-rating" data-cms-reviews-rating>{{ formatRating(place.rating!, lang) }}</span>
      <span class="cms-reviews-stars" role="img" :aria-label="`${formatRating(place.rating!, lang)} ${t.outOf}`" :style="{ '--cms-reviews-fill': `${(place.rating! / 5) * 100}%` }" />
      <a v-if="place.reviewsUrl" :href="place.reviewsUrl" target="_blank" rel="noopener" data-cms-reviews-count>{{ t.count(place.count) }}</a>
      <span v-else data-cms-reviews-count>{{ t.count(place.count) }}</span>
      <!-- Mention exigée par Google : jamais traduite, jamais coupée. -->
      <span class="cms-reviews-source" translate="no" data-cms-reviews-source>Google Maps</span>
    </header>

    <ul v-if="reviews.length" class="cms-reviews-list">
      <li v-for="(review, i) in reviews" :key="review.url ?? i" class="cms-reviews-item" data-cms-review>
        <div class="cms-reviews-author">
          <img v-if="review.authorPhoto" :src="review.authorPhoto" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer">
          <div>
            <a v-if="review.authorUrl" :href="review.authorUrl" target="_blank" rel="noopener nofollow">{{ review.author }}</a>
            <span v-else>{{ review.author }}</span>
            <div class="cms-reviews-meta">
              <span class="cms-reviews-stars" role="img" :aria-label="t.stars(review.rating)" :style="{ '--cms-reviews-fill': `${review.rating * 20}%` }" />
              <span v-if="review.when">{{ review.when }}</span>
              <span v-if="review.visit">· {{ t.visit(formatVisit(review.visit, lang)) }}</span>
            </div>
          </div>
        </div>
        <p v-if="review.text" class="cms-reviews-text">{{ review.text }}</p>
        <p class="cms-reviews-meta">
          <span v-if="review.translated">{{ t.translated }} ·</span>
          <a v-if="review.url" :href="review.url" target="_blank" rel="noopener nofollow">{{ t.source }}</a>
        </p>
      </li>
    </ul>

    <footer v-if="!summary" class="cms-reviews-foot">
      <span v-if="reviews.length">{{ t.order }}</span>
      <a v-if="place.reviewsUrl" :href="place.reviewsUrl" target="_blank" rel="noopener">{{ t.all }}</a>
      <a v-if="place.writeReviewUrl" :href="place.writeReviewUrl" target="_blank" rel="noopener" data-cms-reviews-write>{{ t.write }}</a>
    </footer>
  </section>
</template>

<style>
.cms-reviews { --cms-reviews-star: #f5a623; --cms-reviews-border: color-mix(in srgb, currentColor 15%, transparent); display: grid; gap: 1rem; }
.cms-reviews a { text-decoration: underline; text-underline-offset: 2px; }
.cms-reviews-head { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; }
.cms-reviews-rating { font-size: 1.75em; font-weight: 700; line-height: 1; }
.cms-reviews-source { margin-left: auto; white-space: nowrap; font-family: Roboto, Arial, sans-serif; font-weight: 400; font-size: .875rem; color: #5e5e5e; }
.cms-reviews-stars { display: inline-block; width: 5.2em; height: 1em; flex: none; background: linear-gradient(90deg, var(--cms-reviews-star) var(--cms-reviews-fill, 0%), color-mix(in srgb, currentColor 20%, transparent) var(--cms-reviews-fill, 0%)); -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'/%3E%3C/svg%3E") left center / 1.04em 1em repeat-x; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'/%3E%3C/svg%3E") left center / 1.04em 1em repeat-x; }
.cms-reviews-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); }
.cms-reviews-item { border: 1px solid var(--cms-reviews-border); border-radius: .75rem; padding: 1rem; display: grid; gap: .5rem; align-content: start; }
.cms-reviews-author { display: flex; align-items: center; gap: .75rem; }
.cms-reviews-author img { border-radius: 50%; flex: none; }
.cms-reviews-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; margin: 0; font-size: .85em; opacity: .75; }
.cms-reviews-text { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.cms-reviews-foot { display: flex; flex-wrap: wrap; gap: .5rem 1rem; font-size: .85em; opacity: .8; }
</style>
