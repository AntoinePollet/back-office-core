<script lang="ts">
type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
const turnstileApi = () => (window as { turnstile?: TurnstileApi }).turnstile

/** Le script de Cloudflare, chargé une seule fois par page, et seulement quand un formulaire en a besoin. */
let loading: Promise<TurnstileApi> | null = null
function loadTurnstile(src: string) {
  const ready = turnstileApi()
  if (ready) return Promise.resolve(ready)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => { const api = turnstileApi(); if (api) resolve(api); else reject(new Error('Turnstile absent')) }
    script.onerror = () => { loading = null; script.remove(); reject(new Error('script Turnstile non chargé')) }
    document.head.appendChild(script)
  })
  return loading
}
</script>

<script setup lang="ts">
import { CMS_FORM_PROTECTION, type CmsFormProtection } from '../../composables/useCms'

/**
 * Anti-robots d'un formulaire du site (module `turnstile`, Cloudflare Turnstile). À placer dans le formulaire :
 *
 *   <form @submit.prevent="form.submit()"> … <CmsTurnstile /> <button>Envoyer</button> </form>
 *
 * Il retrouve tout seul le formulaire créé par `useCmsForm` dans la même page (ou celui passé par `:form`),
 * lui donne son jeton et se relance après chaque envoi. Le script de Cloudflare n'est chargé que sur les pages
 * qui contiennent ce composant. Si l'anti-robots n'est pas actif ou pas réglé, il n'affiche rien.
 */
const props = withDefaults(defineProps<{
  /** Le formulaire à protéger (`useCmsForm(…)`). Facultatif quand la page n'en a qu'un. */
  form?: { protection: CmsFormProtection }
  /** Apparence de la case : suit le thème du système par défaut. */
  theme?: 'auto' | 'light' | 'dark'
  /** `flexible` : prend toute la largeur disponible. */
  size?: 'normal' | 'flexible' | 'compact'
}>(), { theme: 'auto', size: 'flexible' })

const protection = props.form?.protection ?? inject(CMS_FORM_PROTECTION, null)
const { data } = await useFetch<{ siteKey: string | null }>('/api/turnstile', { key: 'cms-turnstile' })
const siteKey = computed(() => data.value?.siteKey ?? null)
const scriptUrl = useRuntimeConfig().public.turnstileScriptUrl as string

const el = ref<HTMLElement | null>(null)
const failed = ref(false)
let widget: string | null = null

const setToken = (token: string | null) => { if (protection) protection.token.value = token }

onMounted(async () => {
  if (!siteKey.value || !el.value) return
  // Dès qu'il y a un anti-robots, le formulaire exige son jeton (le serveur aussi, de toute façon).
  if (protection) protection.active.value = true
  try {
    const api = await loadTurnstile(scriptUrl)
    if (!el.value) return
    widget = api.render(el.value, {
      'sitekey': siteKey.value,
      'theme': props.theme,
      'size': props.size,
      'language': 'fr',
      // Un jeton expire au bout de cinq minutes : la case en redemande un toute seule.
      'refresh-expired': 'auto',
      'callback': (token: string) => { failed.value = false; setToken(token) },
      'expired-callback': () => setToken(null),
      'error-callback': () => { failed.value = true; setToken(null) },
    })
    if (protection) {
      protection.reset = () => {
        setToken(null)
        if (widget) turnstileApi()?.reset(widget)
      }
    }
  }
  catch {
    failed.value = true
  }
})

onBeforeUnmount(() => {
  if (widget) turnstileApi()?.remove(widget)
  widget = null
  if (protection) { protection.active.value = false; protection.token.value = null }
})
</script>

<template>
  <div v-if="siteKey" class="cms-turnstile">
    <div ref="el" />
    <p v-if="failed" class="text-sm text-error mt-1" role="alert">
      La vérification anti-robots n'a pas pu s'afficher. Rechargez la page ; si cela continue, écrivez-nous directement par e-mail.
    </p>
  </div>
</template>
