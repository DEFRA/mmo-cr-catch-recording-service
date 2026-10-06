import { createReferenceDataHttpClient } from './reference-data-http-client.js'
import {
  createGetVesselById,
  createListAccessibleVesselIds
} from './vessels-client.js'
import { createGetGearById } from './gears-client.js'
import { createGetPortById } from './ports-client.js'
import { createGetSpeciesById } from './species-client.js'
import { createGetStatisticalAreaById } from './statistical-areas-client.js'

/**
 * The one public, framework-neutral Reference Data Service client contract. Exposes exactly six
 * explicit, read-only, resource-specific retrieval operations - no generic `get(resourceType, id)`
 * method, no search, no mutation. `listAccessibleVesselIds` is the one approved collection-level
 * operation (Step 18's vessel-authorisation source, `docs/configuration-decisions.md` "Vessel-permission
 * source") - it returns only IDs, never full vessel records.
 *
 * @param {Object} [options]
 * @param {string|null} [options.baseUrl] `referenceData.baseUrl`
 * @param {string|null} [options.serviceToken] `referenceData.serviceToken`
 * @param {number} [options.timeoutMs] `referenceData.timeoutMs`
 * @param {number} [options.retryCount] `referenceData.retryCount`
 * @param {number} [options.retryDelayMs] `referenceData.retryDelayMs`
 * @param {string} [options.tracingHeader] `tracing.header`
 * @param {typeof fetch} [options.fetchFn] test-only override
 * @returns {{ getVesselById: Function, listAccessibleVesselIds: Function, getGearById: Function,
 *   getPortById: Function, getSpeciesById: Function, getStatisticalAreaById: Function }}
 */
export function createReferenceDataClient(options = {}) {
  const httpClient = createReferenceDataHttpClient(options)

  return Object.freeze({
    getVesselById: createGetVesselById({ httpClient }),
    listAccessibleVesselIds: createListAccessibleVesselIds({ httpClient }),
    getGearById: createGetGearById({ httpClient }),
    getPortById: createGetPortById({ httpClient }),
    getSpeciesById: createGetSpeciesById({ httpClient }),
    getStatisticalAreaById: createGetStatisticalAreaById({ httpClient })
  })
}
