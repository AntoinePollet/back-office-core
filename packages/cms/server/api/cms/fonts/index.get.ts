/** Polices envoyées sur ce site (écran Apparence). Administrateurs. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { fonts: await loadCustomFonts(event) }
})
