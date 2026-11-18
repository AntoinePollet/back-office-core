<script setup lang="ts">
import { Eye, Trash2 } from '@lucide/vue'

/** Bouton « Aperçu » de la barre du haut : ouvrir le site avec les brouillons, ou partager cet aperçu par un lien temporaire. */
type Link = { id: string; label: string; by: string; mine: boolean; createdAt: string; expiresAt: string; expired: boolean }

const user = useCmsUser()
const toast = useCmsToast()
const open = ref(false)
const links = ref<Link[]>([])
const form = reactive({ label: '', days: 7 })
const busy = ref(false)
/** Adresse du lien qui vient d'être créé : affichée une seule fois. */
const created = ref<{ url: string; label: string } | null>(null)
const durations = [{ days: 1, label: '1 jour' }, { days: 7, label: '7 jours' }, { days: 30, label: '30 jours' }]
const canShare = computed(() => user.value?.sharePreview !== false)

async function show() {
  open.value = true
  created.value = null
  if (canShare.value) links.value = await cmsApi<Link[]>('/api/cms/preview-links').catch(() => [])
}

async function create() {
  busy.value = true
  try {
    const res = await cmsApi<{ url: string; label: string }>('/api/cms/preview-links', { method: 'POST', body: form })
    created.value = res
    form.label = ''
    links.value = await cmsApi<Link[]>('/api/cms/preview-links')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  busy.value = false
}

async function revoke(link: Link) {
  if (!link.expired && !confirm(`Révoquer le lien « ${link.label} » ? Il cessera de fonctionner tout de suite.`)) return
  try {
    await cmsApi(`/api/cms/preview-links/${link.id}`, { method: 'DELETE' })
    links.value = links.value.filter(l => l.id !== link.id)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

const copy = () => navigator.clipboard.writeText(created.value!.url).then(() => toast.success('Lien copié'), () => toast.error('Copie impossible : sélectionnez le lien à la main.'))
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
</script>

<template>
  <button class="btn btn-ghost btn-sm" title="Voir le site avec les brouillons, sans rien publier" @click="show"><Eye :size="16" />Aperçu</button>

  <div v-if="open" class="modal modal-open">
    <div class="modal-box max-w-xl space-y-4">
      <div>
        <h3 class="font-bold text-lg">Aperçu du site</h3>
        <p class="text-sm text-base-content/60">Le site tel qu'il sera avec les brouillons en cours. Le site en ligne ne change pas.</p>
      </div>
      <a href="/?preview=1" target="_blank" class="btn btn-primary btn-block"><Eye :size="16" />Ouvrir l'aperçu</a>

      <template v-if="canShare">
        <div class="border-t border-base-300 pt-4 space-y-3">
          <div>
            <div class="font-semibold">Partager l'aperçu</div>
            <p class="text-sm text-base-content/60">Un lien temporaire pour quelqu'un qui n'a pas de compte, par exemple pour faire valider. Il montre les brouillons en lecture seule.</p>
          </div>

          <div v-if="created" class="rounded-field bg-success/10 p-3 space-y-2">
            <div class="text-sm font-medium">Lien créé pour « {{ created.label }} »</div>
            <div class="flex gap-2">
              <input class="input input-sm w-full font-mono text-xs" :value="created.url" readonly @focus="($event.target as HTMLInputElement).select()">
              <button class="btn btn-sm btn-primary" @click="copy">Copier</button>
            </div>
            <p class="text-xs text-base-content/60">Copiez-le maintenant : il ne sera plus affiché ensuite. Toute personne qui a ce lien voit les brouillons.</p>
          </div>

          <form class="flex flex-wrap items-end gap-2" @submit.prevent="create">
            <fieldset class="fieldset grow">
              <legend class="fieldset-legend">Pour qui ?</legend>
              <input v-model="form.label" class="input input-sm w-full" placeholder="Ex. : validation par la direction" maxlength="80" required>
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Valable</legend>
              <select v-model.number="form.days" class="select select-sm">
                <option v-for="d in durations" :key="d.days" :value="d.days">{{ d.label }}</option>
              </select>
            </fieldset>
            <button class="btn btn-sm mb-1" :disabled="busy">Créer le lien</button>
          </form>

          <ul v-if="links.length" class="text-sm divide-y divide-base-300 border border-base-300 rounded-field">
            <li v-for="l in links" :key="l.id" class="flex items-center gap-3 px-3 py-2" :class="{ 'opacity-50': l.expired }">
              <span class="grow min-w-0">
                <span class="font-medium truncate block">{{ l.label }}</span>
                <span class="text-xs text-base-content/60">{{ l.expired ? 'expiré' : 'jusqu\'au' }} {{ formatDate(l.expiresAt) }}<template v-if="!l.mine"> · créé par {{ l.by }}</template></span>
              </span>
              <button class="btn btn-ghost btn-xs text-error" :title="l.expired ? 'Retirer de la liste' : 'Révoquer ce lien'" :aria-label="`Révoquer le lien ${l.label}`" @click="revoke(l)"><Trash2 :size="14" /></button>
            </li>
          </ul>
        </div>
      </template>

      <div class="modal-action"><button class="btn" @click="open = false">Fermer</button></div>
    </div>
    <div class="modal-backdrop" @click="open = false" />
  </div>
</template>
