<script setup lang="ts">
import { consentLocale, consentTexts } from '../../../shared/consent'

/**
 * Bandeau de consentement, posé par le core en bas des pages du site (plugin `cms-consent.client.ts`).
 * Son style ne dépend d'aucune feuille de style du site. Deux couleurs se règlent par des variables CSS, sur `:root` :
 * `--cms-consent-accent` (boutons) et `--cms-consent-accent-text` (leur texte).
 *
 * Refuser est aussi simple qu'accepter : « Tout refuser » et « Tout accepter » ont la même forme, côte à côte.
 * Dans « Personnaliser », rien n'est coché d'avance.
 */
const consent = useCmsConsent()
const route = useRoute()
const view = ref<'summary' | 'details'>('summary')
const picked = reactive<Record<string, boolean>>({})
const root = ref<HTMLElement>()

const config = computed(() => consent.config.value)
const t = computed(() => consentTexts(config.value ? consentLocale(route.path, config.value) : 'fr'))
// Jamais dans le back-office (navigation interne depuis le site).
const shown = computed(() => consent.isOpen.value && !!config.value && !route.path.startsWith('/admin'))

function customize() {
  // Le choix déjà fait est rappelé ; à la première visite, tout est décoché.
  for (const p of consent.purposes.value) picked[p.id] = consent.choices.value?.[p.id] === true
  view.value = 'details'
}
watch(shown, async (now) => {
  if (!now) { view.value = 'summary'; return }
  // Rouvert par le lien « Gérer mes cookies » : on arrive sur le détail, le clavier dans le bandeau.
  if (consent.decided.value) customize()
  await nextTick()
  root.value?.focus({ preventScroll: true })
})
// Première apparition (le bandeau est déjà ouvert quand il est posé dans la page) : le clavier et les lecteurs d'écran
// y arrivent tout de suite, sans faire défiler la page.
onMounted(() => { if (shown.value) root.value?.focus({ preventScroll: true }) })
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && consent.decided.value) consent.close()
}
</script>

<template>
  <div
    v-if="shown" ref="root" class="cms-consent" role="dialog" aria-modal="false" aria-labelledby="cms-consent-title" tabindex="-1"
    data-cms-consent :data-view="view" @keydown="onKey"
  >
    <div class="cms-consent-box">
      <h2 id="cms-consent-title" class="cms-consent-title">{{ t.title }}</h2>
      <p class="cms-consent-text">
        {{ t.intro }}
        <a v-if="config!.policyUrl" :href="config!.policyUrl" class="cms-consent-policy" data-cms-consent-policy>{{ t.policy }}</a>
      </p>

      <template v-if="view === 'summary'">
        <ul class="cms-consent-list">
          <li v-for="p in consent.purposes.value" :key="p.id"><strong>{{ p.label }}.</strong> {{ p.description }}</li>
        </ul>
        <div class="cms-consent-actions">
          <button type="button" class="cms-consent-btn cms-consent-ghost" data-cms-consent-action="customize" @click="customize">{{ t.customize }}</button>
          <button type="button" class="cms-consent-btn cms-consent-main" data-cms-consent-action="refuse" @click="consent.refuseAll()">{{ t.refuse }}</button>
          <button type="button" class="cms-consent-btn cms-consent-main" data-cms-consent-action="accept" @click="consent.acceptAll()">{{ t.accept }}</button>
        </div>
      </template>

      <template v-else>
        <ul class="cms-consent-list cms-consent-choices">
          <li v-for="p in consent.purposes.value" :key="p.id">
            <label class="cms-consent-choice">
              <input v-model="picked[p.id]" type="checkbox" class="cms-consent-check" :data-cms-consent-purpose="p.id">
              <span><strong>{{ p.label }}</strong> <span class="cms-consent-state">({{ picked[p.id] ? t.on : t.off }})</span><br>{{ p.description }}</span>
            </label>
          </li>
        </ul>
        <p class="cms-consent-note">{{ t.necessary }}</p>
        <div class="cms-consent-actions">
          <button type="button" class="cms-consent-btn cms-consent-ghost" data-cms-consent-action="save" @click="consent.save({ ...picked })">{{ t.save }}</button>
          <button type="button" class="cms-consent-btn cms-consent-main" data-cms-consent-action="refuse" @click="consent.refuseAll()">{{ t.refuse }}</button>
          <button type="button" class="cms-consent-btn cms-consent-main" data-cms-consent-action="accept" @click="consent.acceptAll()">{{ t.accept }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style>
/* Styles autonomes : aucune classe du site ni du back-office. Préfixe « cms-consent » pour ne rien heurter. */
.cms-consent { position: fixed; inset: auto 0 0 0; z-index: 2147483000; display: flex; justify-content: center; padding: 12px; pointer-events: none; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; outline: none; }
.cms-consent-box { pointer-events: auto; box-sizing: border-box; width: 100%; max-width: 720px; max-height: calc(100vh - 24px); overflow: auto; padding: 18px 20px; border-radius: 14px; background: #fff; color: #1f2328; border: 1px solid #d0d7de; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18); text-align: left; }
.cms-consent-title { margin: 0 0 6px; font-size: 16px; font-weight: 700; line-height: 1.3; color: inherit; }
.cms-consent-text, .cms-consent-note { margin: 0 0 10px; font-size: 14px; color: inherit; }
.cms-consent-note { font-size: 12px; opacity: 0.75; }
.cms-consent-policy { color: inherit; text-decoration: underline; white-space: nowrap; }
.cms-consent-list { margin: 0 0 14px; padding: 0 0 0 18px; font-size: 13px; }
.cms-consent-list li { margin: 0 0 4px; }
.cms-consent-choices { list-style: none; padding: 0; }
.cms-consent-choice { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
.cms-consent-check { flex: none; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--cms-consent-accent, #1f2328); }
.cms-consent-state { font-weight: 400; opacity: 0.7; }
.cms-consent-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.cms-consent-btn { box-sizing: border-box; min-height: 40px; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; font: inherit; font-weight: 600; cursor: pointer; }
.cms-consent-btn:focus-visible, .cms-consent-check:focus-visible, .cms-consent-policy:focus-visible { outline: 3px solid #4c9aff; outline-offset: 2px; }
/* « Tout refuser » et « Tout accepter » : même forme, même couleur, même taille. */
.cms-consent-main { flex: 1 1 150px; background: var(--cms-consent-accent, #1f2328); color: var(--cms-consent-accent-text, #fff); border-color: var(--cms-consent-accent, #1f2328); }
.cms-consent-ghost { flex: 0 1 auto; margin-right: auto; background: transparent; color: inherit; border-color: currentColor; }
@media (prefers-color-scheme: dark) {
  .cms-consent-box { background: #1c2128; color: #e6edf3; border-color: #444c56; }
  .cms-consent-main { background: var(--cms-consent-accent, #e6edf3); color: var(--cms-consent-accent-text, #1c2128); border-color: var(--cms-consent-accent, #e6edf3); }
  .cms-consent-check { accent-color: var(--cms-consent-accent, #e6edf3); }
}
@media (max-width: 480px) {
  .cms-consent { padding: 8px; }
  .cms-consent-box { padding: 14px; }
  .cms-consent-ghost { flex: 1 1 100%; margin-right: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .cms-consent-box { animation: cms-consent-in 0.2s ease-out; }
  @keyframes cms-consent-in { from { transform: translateY(12px); opacity: 0; } }
}
</style>
