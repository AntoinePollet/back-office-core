<script setup lang="ts">
import { LogOut } from '@lucide/vue'
import '../../assets/css/admin.css'

/**
 * Écran d'activation obligatoire : le site exige la double authentification et ce compte ne l'a pas encore.
 * Rien d'autre n'est accessible (le serveur refuse le reste) ; on peut seulement l'activer ou se déconnecter.
 */
definePageMeta({ layout: false, middleware: 'cms-auth' })

const user = useCmsUser()
// Arrivée ici sans y être tenu (adresse saisie à la main, double authentification déjà activée) : retour au back-office.
if (!user.value?.twoFactor?.setupRequired) await navigateTo('/admin')

async function logout() {
  await cmsApi('/api/auth/sign-out', { method: 'POST', body: {} })
  user.value = null
  await navigateTo('/admin/login')
}
</script>

<template>
  <div class="cms-admin min-h-screen bg-base-200 text-base-content grid place-items-center p-4" data-theme="light" :style="useCmsAdminStyle().value">
    <div class="w-full max-w-xl space-y-4">
      <div>
        <h1 class="text-xl font-bold">Protégez votre compte pour continuer</h1>
        <p class="text-sm text-base-content/70 mt-1">
          Bonjour {{ user?.name }}. Ce site demande la double authentification pour votre compte.
          L'activer prend deux minutes, avec votre téléphone ; vous accéderez ensuite au back-office.
        </p>
      </div>
      <CmsTwoFactor forced @done="navigateTo('/admin')" />
      <div class="text-center"><button class="btn btn-ghost btn-sm" @click="logout"><LogOut :size="16" />Se déconnecter</button></div>
    </div>
  </div>
</template>
