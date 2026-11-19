<script setup lang="ts">
import { CircleAlert, CircleCheck, DatabaseBackup, Download, History, TriangleAlert } from '@lucide/vue'
import { type BackupKind, type BackupStatus, BACKUP_KIND_LABELS, RESTORE_WORD, formatBackupSize } from '../../../shared/backup'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type Item = { name: string; createdAt: string; kind: BackupKind; size: number }
type Failure = { at: string; kind: BackupKind; error: string }
type State = { status: BackupStatus; items: Item[]; failures: Failure[]; retentionDays: number; dedicatedBucket: boolean }
type Restored = { restored: string; safety: string; rows: number; tables: Record<string, number>; missingFiles: string[]; notes: string[]; purgeFailed: boolean }

const toast = useCmsToast()
const state = ref<State>(await cmsApi<State>('/api/cms/backups'))
const refresh = async () => { state.value = await cmsApi<State>('/api/cms/backups') }

/** Sauvegardes et tentatives échouées, dans une seule liste, de la plus récente à la plus ancienne. */
const rows = computed(() => [
  ...state.value.items.map(i => ({ ...i, key: i.name, failed: false as const, error: '' })),
  ...state.value.failures.map(f => ({ name: '', createdAt: f.at, kind: f.kind, size: 0, key: `echec-${f.at}`, failed: true as const, error: f.error })),
].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

const statusLook = computed(() => ({
  ok: { cls: 'alert-success', icon: CircleCheck },
  warning: { cls: 'alert-warning', icon: TriangleAlert },
  error: { cls: 'alert-error', icon: CircleAlert },
})[state.value.status.level])

const saving = ref(false)
async function backupNow() {
  saving.value = true
  try {
    const made = await cmsApi<{ size: number }>('/api/cms/backups', { method: 'POST' })
    toast.success(`Sauvegarde faite (${formatBackupSize(made.size)})`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  await refresh().catch(() => {})
  saving.value = false
}

// Restauration : une fenêtre de confirmation où il faut saisir un mot, puis le compte rendu.
const restoring = ref<Item | null>(null)
const word = ref('')
const busy = ref(false)
const result = ref<Restored | null>(null)
function askRestore(item: Item) {
  word.value = ''
  restoring.value = item
}
async function restore() {
  const item = restoring.value!
  busy.value = true
  try {
    const done = await cmsApi<Restored>(`/api/cms/backups/${item.name}/restore`, { method: 'POST', body: { confirm: word.value } })
    cmsSiteUpdated(done)
    result.value = done
    restoring.value = null
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  await refresh().catch(() => {})
  busy.value = false
}
/** Après une restauration, tout ce que le back-office a en mémoire peut être périmé : on repart d'une page fraîche. */
const reload = () => window.location.reload()
</script>

<template>
  <section class="max-w-4xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div class="grow">
        <h1 class="text-2xl font-bold">Sauvegardes</h1>
        <p class="text-sm text-base-content/60">Une copie du site est faite chaque nuit et gardée {{ state.retentionDays }} jours.</p>
      </div>
      <button class="btn btn-primary" :disabled="saving" @click="backupNow">
        <span v-if="saving" class="loading loading-spinner loading-sm" /><DatabaseBackup v-else :size="18" />Sauvegarder maintenant
      </button>
    </div>

    <div role="status" class="alert alert-soft mb-4 items-start" :class="statusLook.cls" data-test="backup-status" :data-code="state.status.code">
      <component :is="statusLook.icon" :size="20" class="mt-0.5 shrink-0" />
      <div>
        <div class="font-semibold">{{ state.status.title }}</div>
        <div class="text-sm">{{ state.status.message }}</div>
      </div>
    </div>
    <div v-if="state.status.cronMissing" class="alert alert-soft alert-info mb-4 text-sm" data-test="backup-cron-missing">
      La sauvegarde de nuit n'est pas activée sur ce site : pour l'instant, une sauvegarde se fait quand un administrateur ouvre le back-office.
      Demandez à la personne qui s'occupe du site de l'activer.
    </div>

    <div class="card bg-base-100 border border-base-300">
      <p v-if="!rows.length" class="p-6 text-sm text-base-content/60">Aucune sauvegarde pour l'instant.</p>
      <ul v-else class="divide-y divide-base-300">
        <li v-for="row in rows" :key="row.key" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" :data-backup="row.name || 'echec'">
          <div class="grow min-w-48">
            <div class="font-medium first-letter:uppercase">{{ cmsFormatWhen(row.createdAt) }}</div>
            <div class="flex flex-wrap items-center gap-2 mt-1 text-xs text-base-content/60">
              <span class="badge badge-sm badge-ghost">{{ BACKUP_KIND_LABELS[row.kind] }}</span>
              <template v-if="row.failed">
                <span class="badge badge-sm badge-error">Échec</span>
                <span class="basis-full sm:basis-auto">{{ row.error }}</span>
              </template>
              <template v-else>
                <span class="badge badge-sm badge-success badge-soft">Complète</span>
                <span>{{ formatBackupSize(row.size) }}</span>
              </template>
            </div>
          </div>
          <div v-if="!row.failed" class="flex gap-2">
            <a class="btn btn-sm" :href="`/api/cms/backups/${row.name}/download`" :download="`sauvegarde-${row.name}`"><Download :size="15" />Télécharger</a>
            <button class="btn btn-sm" @click="askRestore(row)"><History :size="15" />Restaurer</button>
          </div>
        </li>
      </ul>
    </div>

    <div class="mt-6 text-sm text-base-content/70 space-y-2">
      <p><strong>Ce que contient une sauvegarde :</strong> les contenus et leur historique, la liste et le rangement des fichiers de la médiathèque, les réglages, les workflows, les messages reçus, les paiements et les comptes. Les mots de passe et les clés d'accès y sont chiffrés.</p>
      <p><strong>Les fichiers eux-mêmes</strong> (images, PDF) ne sont pas dans la sauvegarde : ils restent dans le stockage du site, qui les conserve en plusieurs exemplaires.</p>
      <p>Les sauvegardes de plus de {{ state.retentionDays }} jours s'effacent toutes seules ; les trois plus récentes sont toujours gardées.</p>
    </div>

    <!-- Confirmation -->
    <div v-if="restoring" class="modal modal-open">
      <form class="modal-box space-y-3" @submit.prevent="restore">
        <h3 class="font-bold text-lg">Revenir à cette sauvegarde ?</h3>
        <p class="text-sm">Sauvegarde faite <strong>{{ cmsFormatWhen(restoring.createdAt) }}</strong> ({{ BACKUP_KIND_LABELS[restoring.kind].toLowerCase() }}).</p>
        <div class="alert alert-soft alert-warning text-sm items-start">
          <TriangleAlert :size="18" class="mt-0.5 shrink-0" />
          <span>Tout ce qui a été écrit, modifié ou supprimé dans les contenus et les réglages <strong>depuis cette date sera remplacé</strong>, y compris sur le site public.</span>
        </div>
        <ul class="text-sm list-disc pl-5 space-y-1 text-base-content/80">
          <li>L'état actuel est d'abord sauvegardé : vous pourrez y revenir de la même façon.</li>
          <li>Les comptes ne changent pas : chacun garde son accès et son mot de passe, vous restez connecté.</li>
          <li>Les fichiers de la médiathèque ajoutés depuis sont conservés.</li>
        </ul>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Pour confirmer, écrivez {{ RESTORE_WORD }}</legend>
          <input v-model="word" class="input w-full" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Mot de confirmation" autofocus>
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn" :disabled="busy" @click="restoring = null">Annuler</button>
          <button class="btn btn-error" :disabled="busy || word.trim() !== RESTORE_WORD"><span v-if="busy" class="loading loading-spinner loading-sm" />Restaurer cette sauvegarde</button>
        </div>
      </form>
      <div class="modal-backdrop" @click="busy || (restoring = null)" />
    </div>

    <!-- Compte rendu -->
    <div v-if="result" class="modal modal-open">
      <div class="modal-box space-y-3" data-test="restore-result">
        <h3 class="font-bold text-lg">Le site est revenu à la sauvegarde choisie</h3>
        <p class="text-sm">{{ result.rows }} élément{{ result.rows > 1 ? 's' : '' }} remis en place. L'état d'avant a été sauvegardé : il est dans la liste sous le nom « Avant restauration ».</p>
        <p v-if="result.purgeFailed" class="alert alert-soft alert-warning text-sm">Le site public peut mettre jusqu'à une heure à afficher ce changement.</p>
        <div v-if="result.missingFiles.length" class="alert alert-soft alert-warning text-sm block">
          <div class="font-medium">{{ result.missingFiles.length }} fichier{{ result.missingFiles.length > 1 ? 's' : '' }} de la médiathèque n'existe{{ result.missingFiles.length > 1 ? 'nt' : '' }} plus</div>
          <div>Ils avaient été supprimés depuis la sauvegarde : il faudra les envoyer à nouveau. {{ result.missingFiles.slice(0, 8).join(', ') }}{{ result.missingFiles.length > 8 ? '…' : '' }}</div>
        </div>
        <ul v-if="result.notes.length" class="text-sm list-disc pl-5 text-base-content/70">
          <li v-for="note in result.notes" :key="note">{{ note }}</li>
        </ul>
        <div class="modal-action">
          <button class="btn btn-primary" @click="reload">Continuer</button>
        </div>
      </div>
    </div>
  </section>
</template>
