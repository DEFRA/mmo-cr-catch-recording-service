import { createRequiredCapability } from './capability-authorizer.js'

/**
 * The one authoritative catalogue of the approved Catch Recording capabilities. It is closed: there are
 * no aliases, no wildcards and no role-named capabilities. Which role grants which capability is owned by
 * the User Profile Service role definitions, never by this service.
 */
export const Capability = Object.freeze({
  READ: createRequiredCapability('catch-record.read'),
  CREATE: createRequiredCapability('catch-record.create'),
  UPDATE: createRequiredCapability('catch-record.update'),
  SUBMIT: createRequiredCapability('catch-record.submit'),
  AMEND: createRequiredCapability('catch-record.amend')
})

const CATALOGUE = new Map(
  Object.values(Capability).map((capability) => [
    capability.capabilityId,
    capability
  ])
)

/**
 * Resolves a capability identifier (as stored in route metadata, which Hapi clones) back to the one
 * catalogue capability it names.
 *
 * @param {unknown} capabilityId
 * @returns {Readonly<{ capabilityId: string }> | null} null unless it is one of the five approved capabilities
 */
export function findCatalogueCapability(capabilityId) {
  return CATALOGUE.get(capabilityId) ?? null
}
