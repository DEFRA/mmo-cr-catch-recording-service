import { normaliseReferenceSelection } from '../object-helpers.js'

/**
 * Normalises the client-owned vessel selection. Only the stable vessel `id` is client-owned input —
 * the vessel display snapshots (`rssSnapshot`, `nameSnapshot`, etc.) are resolved server-side by a
 * later step (Reference Data Service integration) and are never accepted from the client here.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseVesselSelection(input) {
  return normaliseReferenceSelection(input)
}
