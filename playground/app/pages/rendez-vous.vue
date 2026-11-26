<script setup lang="ts">
// Page d'exemple du module « Prise de rendez-vous » : à activer dans le back-office, écran « Modules ».
const booking = useCmsAppointments()
useHead({ title: 'Prendre rendez-vous — Cabinet Durand' })

const chosen = computed(() => booking.services.value.find(s => s.id === booking.service.value) ?? null)
const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const slotLabel = computed(() => {
  for (const day of booking.days.value) {
    const slot = day.slots.find(s => s.at === booking.slot.value)
    if (slot) return `${dayName(day.date)} à ${slot.time}`
  }
  return ''
})
</script>

<template>
  <main class="max-w-2xl mx-auto p-6 space-y-6">
    <nav class="flex items-center gap-4 text-sm">
      <NuxtLink to="/" class="font-bold text-lg">Cabinet Durand</NuxtLink>
    </nav>
    <h1 class="text-3xl font-bold">Prendre rendez-vous</h1>

    <div v-if="booking.done.value" class="alert alert-success" role="status" data-booking-done>
      <div>
        <p class="font-medium">Votre rendez-vous est confirmé : {{ slotLabel }}.</p>
        <p class="text-sm">Un e-mail vient de vous être envoyé, avec un lien pour l'ajouter à votre agenda ou l'annuler.</p>
        <a v-if="booking.done.value.manageUrl" :href="booking.done.value.manageUrl" class="link text-sm" data-booking-manage>Voir mon rendez-vous</a>
      </div>
    </div>

    <template v-else>
      <section v-if="booking.services.value.length > 1" class="space-y-2">
        <h2 class="font-semibold">1. La prestation</h2>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="s in booking.services.value" :key="s.id" type="button" class="btn h-auto py-3 justify-start text-left" :class="booking.service.value === s.id ? 'btn-primary' : ''"
            :aria-pressed="booking.service.value === s.id" :data-booking-service="s.id" @click="booking.service.value = s.id"
          >
            <span>
              <span class="block font-semibold">{{ s.label }}</span>
              <span class="block text-sm font-normal opacity-80">{{ s.duration }} min<template v-if="s.deposit"> · acompte de {{ s.deposit }}</template></span>
              <span v-if="s.description" class="block text-sm font-normal opacity-80">{{ s.description }}</span>
            </span>
          </button>
        </div>
      </section>

      <section v-if="booking.service.value" class="space-y-2" data-booking-slots>
        <div class="flex items-center gap-2">
          <h2 class="font-semibold grow">{{ booking.services.value.length > 1 ? '2. ' : '' }}Le créneau</h2>
          <button type="button" class="btn btn-sm" :disabled="!booking.canGoBack.value || booking.loading.value" data-booking-previous @click="booking.previous()">← Avant</button>
          <button type="button" class="btn btn-sm" :disabled="!booking.canGoOn.value || booking.loading.value" data-booking-next @click="booking.next()">Après →</button>
        </div>
        <div class="space-y-3" :class="booking.loading.value ? 'opacity-50' : ''">
          <div v-for="day in booking.days.value" :key="day.date" :data-booking-day="day.date">
            <div class="text-sm font-medium first-letter:uppercase">{{ dayName(day.date) }}</div>
            <div v-if="day.slots.length" class="flex flex-wrap gap-1.5 mt-1">
              <button
                v-for="slot in day.slots" :key="slot.at" type="button" class="btn btn-sm" :class="booking.slot.value === slot.at ? 'btn-primary' : 'btn-outline'"
                :aria-pressed="booking.slot.value === slot.at" :data-booking-slot="slot.at" @click="booking.slot.value = slot.at"
              >
                {{ slot.time }}
              </button>
            </div>
            <div v-else class="text-sm opacity-60">Aucun créneau libre.</div>
          </div>
        </div>
        <p class="text-xs opacity-70">Heures de {{ booking.info.value?.timeZone === 'Europe/Paris' ? 'Paris' : booking.info.value?.timeZone }}.</p>
      </section>

      <form v-if="booking.slot.value" class="space-y-3" novalidate data-booking-form @submit.prevent="booking.submit()">
        <h2 class="font-semibold">{{ booking.services.value.length > 1 ? '3. ' : '' }}Vos coordonnées</h2>
        <p class="text-sm">{{ chosen?.label }}, <strong>{{ slotLabel }}</strong><template v-if="booking.info.value?.location"> — {{ booking.info.value.location }}</template></p>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Nom</legend>
          <input v-model="booking.values.name" name="name" class="input w-full" autocomplete="name">
          <p v-if="booking.errors.value.name" class="text-sm text-error">{{ booking.errors.value.name }}</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">E-mail</legend>
          <input v-model="booking.values.email" name="email" type="email" class="input w-full" autocomplete="email">
          <p v-if="booking.errors.value.email" class="text-sm text-error">{{ booking.errors.value.email }}</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Téléphone (facultatif)</legend>
          <input v-model="booking.values.phone" name="phone" type="tel" class="input w-full" autocomplete="tel">
          <p v-if="booking.errors.value.phone" class="text-sm text-error">{{ booking.errors.value.phone }}</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Un mot sur votre demande (facultatif)</legend>
          <textarea v-model="booking.values.note" name="note" class="textarea w-full" rows="3" />
        </fieldset>
        <!-- Champ piège : invisible pour une personne, rempli seulement par les robots. -->
        <input v-model="booking.trap.value" name="website" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true">
        <CmsTurnstile />
        <p v-if="booking.error.value" class="text-sm text-error" role="alert" data-booking-error>{{ booking.error.value }}</p>
        <button class="btn btn-primary" :disabled="booking.pending.value">
          {{ booking.pending.value ? 'Envoi…' : chosen?.deposit ? `Réserver et régler l'acompte de ${chosen.deposit}` : 'Réserver ce créneau' }}
        </button>
      </form>
      <p v-else-if="booking.error.value" class="text-sm text-error" role="alert" data-booking-error>{{ booking.error.value }}</p>
    </template>
  </main>
</template>
