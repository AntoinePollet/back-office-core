<script setup lang="ts">
import { cmsImageSrcset, cmsImageUrl } from '../../../shared/media'

/**
 * Image de la médiathèque, pour les pages du site : `<CmsImage :media="service.cover" sizes="(min-width: 768px) 50vw, 100vw" />`.
 * Le navigateur reçoit plusieurs largeurs et télécharge la plus adaptée à l'écran ; le texte alternatif vient de la médiathèque.
 */
const props = withDefaults(defineProps<{
  media: { url: string; alt?: string; mime?: string; width?: number | null; height?: number | null } | null | undefined
  /** Place occupée par l'image dans la page, au format de l'attribut HTML `sizes`. Défaut : toute la largeur de l'écran. */
  sizes?: string
  /** Largeur maximale à servir, en pixels. Défaut : la largeur d'origine. */
  maxWidth?: number
  /** `eager` pour l'image principale visible dès l'arrivée sur la page ; `lazy` sinon. */
  loading?: 'lazy' | 'eager'
}>(), { sizes: '100vw', loading: 'lazy' })

const fallbackWidth = computed(() => Math.min(props.maxWidth ?? 1280, props.media?.width ?? 1280))
</script>

<template>
  <img
    v-if="media"
    :src="cmsImageUrl(media, fallbackWidth)"
    :srcset="cmsImageSrcset(media, maxWidth)"
    :sizes="sizes"
    :alt="media.alt ?? ''"
    :width="media.width ?? undefined"
    :height="media.height ?? undefined"
    :loading="loading"
    decoding="async"
  >
</template>
