<script setup lang="ts">
import { ArrowLeft, Plus, Trash2 } from '@lucide/vue'
import { type CustomRights, CMS_ROLES, ROLE_HELP, ROLE_LABELS } from '../../../shared/access'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type Role = { id: string; name: string; rights: CustomRights; users: number }
type Row = { edit: boolean; publish: boolean; delete: boolean; own: boolean }

const toast = useCmsToast()
const schema = await useCmsSchema()
const roles = ref(await cmsApi<Role[]>('/api/cms/roles'))

// Un contenu réservé aux administrateurs ne peut être ouvert à aucun autre rôle : il n'est pas proposé.
const types = [...Object.entries(schema.value.singletons ?? {}), ...Object.entries(schema.value.collections ?? {})]
  .filter(([, def]) => !def.adminOnly)
  .map(([key, def]) => ({ key, label: def.label, single: def.kind === 'singleton', drafts: def.drafts !== false }))

const editing = ref<{ id: string | null; name: string; rows: Record<string, Row>; restrictedFields: boolean; deleteMedia: boolean } | null>(null)
const saving = ref(false)

function open(role?: Role) {
  editing.value = {
    id: role?.id ?? null,
    name: role?.name ?? '',
    rows: Object.fromEntries(types.map(t => [t.key, { edit: false, publish: false, delete: false, own: false, ...role?.rights.types[t.key] }])),
    restrictedFields: role?.rights.restrictedFields ?? false,
    deleteMedia: role?.rights.deleteMedia ?? false,
  }
}

/** Garde la ligne cohérente : sans « modifier », rien d'autre ; sans brouillons, modifier c'est publier. */
function touch(key: string, changed: keyof Row) {
  const row = editing.value!.rows[key]!
  const type = types.find(t => t.key === key)!
  if (changed === 'edit' && !row.edit) Object.assign(row, { publish: false, delete: false, own: false })
  if (changed !== 'edit' && row[changed]) row.edit = true
  if (!type.drafts && row.edit) row.publish = true
  if (!type.drafts && changed === 'publish' && !row.publish) Object.assign(row, { edit: false, delete: false, own: false })
}

async function save() {
  const role = editing.value!
  saving.value = true
  try {
    const body = { name: role.name, rights: { types: role.rows, restrictedFields: role.restrictedFields, deleteMedia: role.deleteMedia } }
    await cmsApi(role.id ? `/api/cms/roles/${role.id}` : '/api/cms/roles', { method: role.id ? 'PUT' : 'POST', body })
    roles.value = await cmsApi<Role[]>('/api/cms/roles')
    editing.value = null
    toast.success(role.id ? 'Rôle modifié. Les comptes concernés ont les nouveaux droits.' : 'Rôle créé. Attribuez-le depuis la page Utilisateurs.')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  saving.value = false
}

async function remove(role: Role) {
  if (!confirm(`Supprimer le rôle « ${role.name} » ?`)) return
  try {
    await cmsApi(`/api/cms/roles/${role.id}`, { method: 'DELETE' })
    roles.value = roles.value.filter(r => r.id !== role.id)
    toast.success('Rôle supprimé')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

const summary = (role: Role) => {
  const rows = Object.values(role.rights.types)
  const publish = rows.filter(r => r.publish).length
  return `${rows.length} contenu${rows.length > 1 ? 's' : ''}${publish ? `, publie sur ${publish}` : ', sans publication'}`
}
</script>

<template>
  <section class="max-w-5xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <NuxtLink to="/admin/users" class="btn btn-ghost btn-sm btn-square" title="Retour aux utilisateurs" aria-label="Retour aux utilisateurs"><ArrowLeft :size="18" /></NuxtLink>
      <div>
        <h1 class="text-2xl font-bold">Rôles</h1>
        <p class="text-sm text-base-content/60">Trois rôles sont fournis. Créez les vôtres quand ils ne suffisent pas.</p>
      </div>
      <button class="btn btn-primary ml-auto" @click="open()"><Plus :size="18" />Créer un rôle</button>
    </div>

    <h2 class="text-sm font-semibold mb-2">Rôles fournis</h2>
    <div class="card bg-base-100 border border-base-300 divide-y divide-base-300 mb-6 text-sm">
      <div v-for="r in CMS_ROLES" :key="r" class="p-4 flex flex-wrap gap-x-4">
        <span class="font-medium w-32">{{ ROLE_LABELS[r] }}</span>
        <span class="text-base-content/70">{{ ROLE_HELP[r] }}</span>
      </div>
    </div>
    <p class="text-xs text-base-content/50 -mt-4 mb-6">Pour l'éditeur et le rédacteur, le détail par contenu se règle dans le fichier de configuration du site.</p>

    <h2 class="text-sm font-semibold mb-2">Vos rôles</h2>
    <div v-if="roles.length" class="card bg-base-100 border border-base-300 overflow-x-auto">
      <table class="table">
        <thead><tr><th>Nom</th><th>Droits</th><th>Comptes</th><th /></tr></thead>
        <tbody>
          <tr v-for="r in roles" :key="r.id" class="hover:bg-base-200 cursor-pointer" @click="open(r)">
            <td class="font-medium">{{ r.name }}</td>
            <td class="text-sm">{{ summary(r) }}</td>
            <td class="text-sm">{{ r.users }}</td>
            <td class="text-right" @click.stop>
              <button
                class="btn btn-ghost btn-xs text-error" :disabled="r.users > 0"
                :title="r.users ? 'Des comptes portent ce rôle : donnez-leur d\'abord un autre rôle' : 'Supprimer ce rôle'" @click="remove(r)"
              >
                <Trash2 :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="card bg-base-100 border border-base-300 p-6 text-sm text-base-content/60">Aucun rôle personnalisé pour l'instant.</p>

    <div v-if="editing" class="modal modal-open">
      <form class="modal-box max-w-3xl space-y-4" @submit.prevent="save">
        <h3 class="font-bold text-lg">{{ editing.id ? 'Modifier le rôle' : 'Nouveau rôle' }}</h3>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Nom</legend>
          <input v-model="editing.name" class="input w-full" placeholder="Ex. : Stagiaire, Responsable des actualités" required autofocus>
        </fieldset>

        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Contenu</th>
                <th class="text-center" title="Voir et modifier le brouillon">Modifier</th>
                <th class="text-center" title="Mettre en ligne, retirer du site, changer l'ordre">Publier</th>
                <th class="text-center">Supprimer</th>
                <th class="text-center" title="Ne voit et ne modifie que les contenus qu'il a créés">Seulement les siens</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in types" :key="t.key">
                <td>{{ t.label }}<span v-if="!t.drafts" class="text-xs text-base-content/50 block">sans brouillon : modifier, c'est publier</span></td>
                <td v-for="col in (['edit', 'publish', 'delete', 'own'] as const)" :key="col" class="text-center">
                  <input
                    v-if="!(t.single && (col === 'own' || col === 'delete'))" v-model="editing.rows[t.key]![col]" type="checkbox" class="checkbox checkbox-sm"
                    :aria-label="`${t.label} : ${col}`" @change="touch(t.key, col)"
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="space-y-2">
          <label class="flex items-center gap-3 cursor-pointer text-sm"><input v-model="editing.restrictedFields" type="checkbox" class="toggle toggle-sm">Modifier les champs réservés</label>
          <label class="flex items-center gap-3 cursor-pointer text-sm"><input v-model="editing.deleteMedia" type="checkbox" class="toggle toggle-sm">Supprimer des fichiers de la médiathèque</label>
        </div>
        <p class="text-xs text-base-content/50">Ce rôle n'aura jamais accès aux utilisateurs, à l'apparence, aux workflows ni aux contenus réservés aux administrateurs.</p>

        <div class="modal-action">
          <button type="button" class="btn" @click="editing = null">Annuler</button>
          <button class="btn btn-primary" :disabled="saving">Enregistrer</button>
        </div>
      </form>
      <div class="modal-backdrop" @click="editing = null" />
    </div>
  </section>
</template>
