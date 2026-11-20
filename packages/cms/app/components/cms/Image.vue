<script setup lang="ts">
import { type Focus, cmsImageSrcset, cmsImageUrl, cmsObjectPosition, cropRect, parseRatio, snapRatio } from '../../../shared/media'

/**
 * Image de la médiathèque, pour les pages du site : `<CmsImage :media="service.cover" sizes="(min-width: 768px) 50vw, 100vw" />`.
 * Le navigateur reçoit plusieurs largeurs et télécharge la plus adaptée à l'écran ; le texte alternatif vient de la médiathèque.
 *
 * Cadrage : si l'image a un point d'intérêt (réglé dans la médiathèque), il est transmis au navigateur (`object-position`) ;
 * une image recadrée en CSS (`object-fit: cover`) garde donc son sujet visible, sans rien écrire de plus.
 *
 * Avec `ratio` (`<CmsImage :media="photo" ratio="1/1" />`) ou `:width` et `:height` ensemble, l'image est recadrée par le
 * serveur à ces proportions, autour du point d'intérêt : le navigateur ne télécharge que la partie affichée.
 */
const props = withDefaults(defineProps<{
  media: { url: string; alt?: string; mime?: string; width?: number | null; height?: number | null; focus?: Focus | null } | null | undefined
  /** Place occupée par l'image dans la page, au format de l'attribut HTML `sizes`. Défaut : toute la largeur de l'écran. */
  sizes?: string
  /** Largeur maximale à servir, en pixels. Défaut : la largeur d'origine. */
  maxWidth?: number
  /** `eager` pour l'image principale visible dès l'arrivée sur la page ; `lazy` sinon. */
  loading?: 'lazy' | 'eager'
  /**
   * Proportions voulues, largeur/hauteur : `'1/1'`, `'4/3'`, `'16/9'`, `'3/4'`… L'image est recadrée par le serveur.
   * Des proportions hors de la liste servie sont ramenées à la plus proche, et le navigateur ajuste le reste.
   */
  ratio?: string | number
  /** Dimensions d'affichage en pixels. Données ensemble, elles valent `ratio` : l'image est recadrée à ces proportions. */
  width?: number | string
  height?: number | string
}>(), { sizes: '100vw', loading: 'lazy' })

/** Proportions demandées, sous forme de nombre ; rien si l'image n'est pas à recadrer. */
const wanted = computed(() => parseRatio(props.ratio) ?? (Number(props.width) > 0 && Number(props.height) > 0 ? Number(props.width) / Number(props.height) : null))
const served = computed(() => (wanted.value ? snapRatio(wanted.value) : null))
const crop = computed(() => (props.media && served.value ? cropRect(props.media, served.value) : null))

const limit = computed(() => props.maxWidth ?? (wanted.value && Number(props.width) > 0 ? Number(props.width) * 2 : undefined))
const fallbackWidth = computed(() => Math.min(limit.value ?? 1280, crop.value?.width ?? props.media?.width ?? 1280))
// Dimensions annoncées au navigateur (il réserve la place avant le chargement) : celles demandées, sinon celles de
// l'image servie, recadrée ou non.
const size = computed(() => ({
  width: props.width ?? crop.value?.width ?? props.media?.width ?? undefined,
  height: props.height ?? crop.value?.height ?? props.media?.height ?? undefined,
}))
const style = computed(() => {
  const objectPosition = cmsObjectPosition(props.media)
  // Proportions garanties même si l'image arrive non recadrée (format non pris en charge, service d'images absent).
  if (wanted.value) return { objectPosition, aspectRatio: String(Math.round(wanted.value * 10000) / 10000), objectFit: 'cover' as const }
  // Sans point d'intérêt ni proportions : aucun style, la balise est celle d'avant.
  return objectPosition ? { objectPosition } : undefined
})
</script>

<template>
  <img
    v-if="media"
    :src="cmsImageUrl(media, fallbackWidth, served)"
    :srcset="cmsImageSrcset(media, limit, served)"
    :sizes="sizes"
    :alt="media.alt ?? ''"
    :width="size.width"
    :height="size.height"
    :style="style"
    :loading="loading"
    decoding="async"
  >
</template>
