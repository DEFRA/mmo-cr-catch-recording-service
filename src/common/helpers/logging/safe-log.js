/**
 * Writes one structured log entry and never lets a logging failure (or a logger lacking a level) escape.
 * Security-relevant components use it so that observability can neither fail a request nor change an
 * authentication or authorization outcome.
 *
 * @param {Record<string, Function> | undefined} logger
 * @param {'debug' | 'info' | 'warn' | 'error'} level
 * @param {object} fields
 * @param {string} [message]
 */
export function safeLog(logger, level, fields, message) {
  try {
    logger?.[level]?.(fields, message)
  } catch {
    // observability must never alter the outcome
  }
}
