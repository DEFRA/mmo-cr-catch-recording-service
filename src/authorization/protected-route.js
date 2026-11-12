import { ENTRA_AUTH_STRATEGY } from '#/authentication/entra/entra-auth-strategy.js'
import { findCatalogueCapability } from './capabilities.js'

/**
 * Declares a protected Catch Recording route: it is authenticated by the Entra strategy and carries the
 * single capability that operation requires, as route metadata next to the route itself. Optionally the
 * name of a path parameter that holds the vessel the operation applies to, so the check is limited to
 * roles assigned for that exact vessel.
 *
 * The enforcement plugin refuses to start, and fails closed per request, for any authenticated route that
 * does not carry a catalogue capability - there is no default capability.
 *
 * @param {{ capability: Readonly<{ capabilityId: string }>, vesselIdParam?: string }} authorization
 * @param {Object} [options] the remaining Hapi route options (validate, payload, ...)
 * @returns {Object} Hapi route options
 */
export function protectedRoute({ capability, vesselIdParam }, options = {}) {
  return {
    ...options,
    auth: ENTRA_AUTH_STRATEGY,
    app: {
      ...options.app,
      // The identifier only: Hapi clones route metadata, so object identity would not survive it
      requiredCapabilityId: capability.capabilityId,
      ...(vesselIdParam ? { vesselIdParam } : {})
    }
  }
}

/**
 * @param {import('@hapi/hapi').Request | import('@hapi/hapi').RequestRoute} source a request or route
 * @returns {{ capability: Readonly<{ capabilityId: string }> | null, vesselIdParam: string | undefined }}
 *   `capability` is the catalogue capability the route declares, or null when it declares none or an
 *   identifier outside the approved catalogue
 */
export function readRouteAuthorization(source) {
  const route = source.route ?? source
  const app = route.settings?.app ?? {}

  return {
    capability: findCatalogueCapability(app.requiredCapabilityId),
    vesselIdParam: app.vesselIdParam
  }
}
