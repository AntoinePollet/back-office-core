import type { H3Event } from 'h3'

/**
 * Signature d'un lien envoyé hors du site (e-mail, agenda) : elle dépend du secret du site (NUXT_AUTH_SECRET), de
 * l'usage du lien et de ce qu'il désigne. Rien n'est à garder en base, et le même lien peut être redonné à tout
 * moment tant que le secret du site ne change pas.
 */
export async function signLink(event: H3Event, scope: string, value: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(cmsSiteSecret(event)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${scope}:${value}`)))
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32)
}

/** Vérifie une signature reçue, sans s'arrêter au premier caractère différent. */
export async function verifyLink(event: H3Event, scope: string, value: string, given: unknown) {
  if (typeof given !== 'string' || !given) return false
  const expected = await signLink(event, scope, value)
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
