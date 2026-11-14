import { createSecurityTelemetry } from '#/authorization/security-telemetry.js'

/**
 * Decorates the server with `securityTelemetry`, the one bounded, privacy-safe logging and metrics sink
 * used by every authentication and authorization component. Built from the server logger and the existing
 * `@defra/cdp-metrics` instance (`server.metrics`) when registered, so register it after `metrics`.
 */
export const securityTelemetry = {
  plugin: {
    name: 'security-telemetry',
    once: true,
    register: (server) => {
      server.decorate(
        'server',
        'securityTelemetry',
        createSecurityTelemetry({
          logger: server.logger,
          metrics: server.metrics
        })
      )
    }
  }
}
