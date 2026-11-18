<script setup lang="ts">
import { UserPlus } from '@lucide/vue'

definePageMeta({ layout: 'admin', middleware: ['cms-auth', 'cms-admin'] })

type Role = 'admin' | 'editor'
type User = { id: string; name: string; email: string; role: Role; status: 'active' | 'invited' | 'expired'; createdAt: string }

const me = useCmsUser()
const toast = useCmsToast()
const users = ref<User[]>(await cmsApi<User[]>('/api/cms/users'))
const refresh = async () => { users.value = await cmsApi<User[]>('/api/cms/users') }

const roles: { value: Role; label: string; help: string }[] = [
  { value: 'editor', label: 'Éditeur', help: 'Modifie les contenus et la médiathèque.' },
  { value: 'admin', label: 'Administrateur', help: 'Peut aussi gérer les utilisateurs et les contenus réservés.' },
]
const statusMeta = {
  active: { label: 'Actif', cls: 'badge-success' },
  invited: { label: 'Invitation en attente', cls: 'badge-warning' },
  expired: { label: 'Invitation expirée', cls: 'badge-error' },
}

// Invitation
const inviting = ref(false)
const form = reactive({ name: '', email: '', role: 'editor' as Role })
const busy = ref(false)
/** Lien à transmettre : affiché une seule fois, il n'est pas relisible ensuite. */
const link = ref<{ url: string; days: number; name: string; reset: boolean } | null>(null)

function openInvite() {
  Object.assign(form, { name: '', email: '', role: 'editor' })
  inviting.value = true
}
async function invite() {
  busy.value = true
  try {
    const res = await cmsApi<{ link: string; days: number }>('/api/cms/users', { method: 'POST', body: form })
    link.value = { url: res.link, days: res.days, name: form.name, reset: false }
    inviting.value = false
    await refresh()
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  busy.value = false
}

async function newLink(user: User) {
  const reset = user.status === 'active'
  if (reset && !confirm(`Créer un lien pour que ${user.name} choisisse un nouveau mot de passe ? L'ancien restera valable tant que le lien n'est pas utilisé.`)) return
  try {
    const res = await cmsApi<{ link: string; days: number }>(`/api/cms/users/${user.id}/invite`, { method: 'POST' })
    link.value = { url: res.link, days: res.days, name: user.name, reset }
    await refresh()
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
}

async function setRole(user: User, role: Role) {
  try {
    await cmsApi(`/api/cms/users/${user.id}`, { method: 'PATCH', body: { role } })
    toast.success(`${user.name} est maintenant ${roles.find(r => r.value === role)!.label.toLowerCase()}`)
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  await refresh()
}

async function remove(user: User) {
  if (!confirm(`Supprimer le compte de ${user.name} ? La personne ne pourra plus se connecter. Ses contenus sont conservés.`)) return
  try {
    await cmsApi(`/api/cms/users/${user.id}`, { method: 'DELETE' })
    toast.success('Compte supprimé')
  }
  catch (e) {
    toast.error(cmsErrorMessage(e))
  }
  await refresh()
}

const copy = () => navigator.clipboard.writeText(link.value!.url).then(() => toast.success('Lien copié'), () => toast.error('Copie impossible : sélectionnez le lien à la main.'))
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<template>
  <section class="max-w-6xl mx-auto">
    <div class="flex flex-wrap items-end gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold">Utilisateurs</h1>
        <p class="text-sm text-base-content/60">{{ users.length }} compte{{ users.length > 1 ? 's' : '' }}</p>
      </div>
      <button class="btn btn-primary ml-auto" @click="openInvite"><UserPlus :size="18" />Inviter</button>
    </div>

    <div class="card bg-base-100 border border-base-300 overflow-x-auto">
      <table class="table">
        <thead>
          <tr><th>Nom</th><th>Rôle</th><th>État</th><th>Créé le</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>
              <div class="font-medium">{{ u.name }} <span v-if="u.id === me?.id" class="badge badge-xs badge-ghost">vous</span></div>
              <div class="text-xs text-base-content/50">{{ u.email }}</div>
            </td>
            <td>
              <select
                class="select select-sm w-40" :value="u.role" :disabled="u.id === me?.id"
                :title="u.id === me?.id ? 'Vous ne pouvez pas changer votre propre rôle' : ''"
                @change="setRole(u, ($event.target as HTMLSelectElement).value as Role)"
              >
                <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
            </td>
            <td><span class="badge badge-sm badge-soft" :class="statusMeta[u.status].cls">{{ statusMeta[u.status].label }}</span></td>
            <td class="text-sm text-base-content/60 whitespace-nowrap">{{ formatDate(u.createdAt) }}</td>
            <td class="text-right whitespace-nowrap">
              <button class="btn btn-ghost btn-xs" @click="newLink(u)">{{ u.status === 'active' ? 'Nouveau mot de passe' : 'Nouveau lien' }}</button>
              <button v-if="u.id !== me?.id" class="btn btn-ghost btn-xs text-error" @click="remove(u)">Supprimer</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
      <div v-for="r in roles" :key="r.value" class="text-base-content/60"><span class="font-medium text-base-content">{{ r.label }}</span> : {{ r.help }}</div>
    </div>

    <!-- Invitation -->
    <div v-if="inviting" class="modal modal-open">
      <form class="modal-box space-y-3" @submit.prevent="invite">
        <h3 class="font-bold text-lg">Inviter une personne</h3>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Nom</legend>
          <input v-model="form.name" class="input w-full" required autofocus>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">E-mail</legend>
          <input v-model="form.email" type="email" class="input w-full" required>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Rôle</legend>
          <select v-model="form.role" class="select w-full">
            <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
          <p class="label">{{ roles.find(r => r.value === form.role)?.help }}</p>
        </fieldset>
        <div class="modal-action">
          <button type="button" class="btn" @click="inviting = false">Annuler</button>
          <button class="btn btn-primary" :disabled="busy">Créer l'invitation</button>
        </div>
      </form>
      <div class="modal-backdrop" @click="inviting = false" />
    </div>

    <!-- Lien à transmettre -->
    <div v-if="link" class="modal modal-open">
      <div class="modal-box space-y-3">
        <h3 class="font-bold text-lg">{{ link.reset ? 'Lien de nouveau mot de passe' : 'Invitation créée' }}</h3>
        <p class="text-sm">
          Transmettez ce lien à {{ link.name }}. Il lui permet de choisir son mot de passe, fonctionne une seule fois et reste valable {{ link.days }} jours.
        </p>
        <div class="flex gap-2">
          <input class="input input-sm w-full font-mono text-xs" :value="link.url" readonly @focus="($event.target as HTMLInputElement).select()">
          <button class="btn btn-sm btn-primary" @click="copy">Copier</button>
        </div>
        <p class="text-xs text-base-content/60">Ce lien ne sera plus affiché après la fermeture de cette fenêtre. En cas de perte, créez-en un nouveau.</p>
        <div class="modal-action"><button class="btn" @click="link = null">Fermer</button></div>
      </div>
    </div>
  </section>
</template>
