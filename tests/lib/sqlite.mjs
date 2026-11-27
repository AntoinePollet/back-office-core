// La base du serveur de test, lue ou modifiée avec l'outil sqlite3 pendant que le serveur tourne : dates avancées
// (un lien expire, un élément de la corbeille dépasse son délai), lignes ajoutées en nombre, contenu vérifié.
import { execFileSync } from 'node:child_process'

/** Temps laissé à sqlite3 pour attendre que le serveur ait fini d'écrire. */
const BUSY_MS = 10_000

/** L'outil sqlite3 est-il installé sur cette machine ? */
export function hasSqlite() {
  try { execFileSync('sqlite3', ['-version'], { stdio: 'ignore' }); return true }
  catch { return false }
}

/**
 * Exécute une requête (ou une commande comme `.dump`) sur le fichier de la base et renvoie ce qu'elle affiche.
 *
 * Le serveur écrit dans la base en même temps (journal d'activité, compteurs, tâches de fond d'une requête qui vient
 * de répondre) : sans délai d'attente, la commande échoue par moments avec « database is locked ». `.timeout` la
 * fait patienter. Toute autre erreur est levée : une étape ne doit pas passer pour « non vérifiée » parce que la
 * commande a échoué.
 */
export const runSql = (file, query) => execFileSync('sqlite3', ['-cmd', `.timeout ${BUSY_MS}`, file, query]).toString().trim()
