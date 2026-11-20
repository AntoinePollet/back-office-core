/**
 * Publication programmée, repli : si l'heure d'une mise en ligne ou d'un retrait est passée sans que la tâche planifiée
 * s'en soit chargée (déclencheur absent ou en retard), la première lecture qui atteint le serveur l'exécute avant de
 * répondre. Sans échéance passée, cela ne coûte rien : voir `catchUpSchedules` (server/utils/schedule.ts).
 */
export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const path = event.path
  if (path.startsWith('/_') || path.startsWith('/api/auth/') || path.startsWith('/media/')) return
  await catchUpSchedules(event)
})
