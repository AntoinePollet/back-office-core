/**
 * Chiffrement des clés d'API saisies dans le back-office (écran « Modules »).
 *
 * Une clé n'est jamais enregistrée en clair : elle est chiffrée (AES-GCM 256 bits) avec une clé dérivée du secret
 * du site (NUXT_AUTH_SECRET), qui vit dans l'hébergement et pas dans la base. Une copie de la base seule ne
 * suffit donc pas à lire les clés. Conséquence : changer NUXT_AUTH_SECRET rend les clés enregistrées illisibles,
 * il faut alors les saisir à nouveau.
 *
 * N'utilise que l'API Web Crypto : fonctionne sur Cloudflare Workers comme dans Node.
 */
const encoder = new TextEncoder()

async function deriveKey(secret: string) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('backoffice-core/modules/v1') },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))

/** Chiffre un texte. Le résultat (vecteur d'initialisation + texte chiffré, en base64) est différent à chaque appel. */
export async function encryptSecret(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(secret), encoder.encode(plain)))
  const out = new Uint8Array(iv.length + data.length)
  out.set(iv)
  out.set(data, iv.length)
  return toBase64(out)
}

/** Déchiffre un texte. Renvoie null s'il est illisible (secret du site changé, donnée abîmée). */
export async function decryptSecret(secret: string, encrypted: string): Promise<string | null> {
  try {
    const bytes = fromBase64(encrypted)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await deriveKey(secret), bytes.slice(12))
    return new TextDecoder().decode(plain)
  }
  catch {
    return null
  }
}

/** Ce qu'on montre d'une clé enregistrée pour la reconnaître sans la révéler : ses quatre derniers caractères. */
export const secretHint = (plain: string) => (plain.length >= 12 ? `…${plain.slice(-4)}` : '…')
