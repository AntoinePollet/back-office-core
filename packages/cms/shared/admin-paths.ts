/**
 * Adresse d'un contenu dans le back-office.
 * Une page unique a pour identifiant celui de son type : elle s'ouvre à `/admin/home`, pas à `/admin/home/home`.
 * Un élément de collection s'ouvre à `/admin/services/<identifiant>`.
 */
export const adminEntryPath = (type: string, id: string) => (id === type ? `/admin/${type}` : `/admin/${type}/${id}`)
