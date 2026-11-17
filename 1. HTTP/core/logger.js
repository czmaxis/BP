/**
 * Formátovaný konzolový výstup pro Kategorii 1: Výkon HTTP serveru.
 */

/**
 * Vypíše formátovanou hlavičku do konzole.
 *
 * @param {string} title
 */
export function logSection(title) {
  const line = "═".repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

/**
 * Vypíše informační zprávu s časovým razítkem.
 *
 * @param {string} message
 */
export function logInfo(message) {
  const now = new Date().toISOString().slice(11, 23);
  console.log(`[${now}] ${message}`);
}
