import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#/common/helpers/convict/validate-mongo-uri.js'
import { convictValidateNonEmptyString } from '#/common/helpers/convict/validate-non-empty-string.js'
import { convictValidateHttpsUrl } from '#/common/helpers/convict/validate-https-url.js'
import { convictValidateBaseUrl } from '#/common/helpers/convict/validate-base-url.js'
import { convictValidateAlgorithmAllowlist } from '#/common/helpers/convict/validate-algorithm-allowlist.js'
import { convictValidatePositiveIntegerSeconds } from '#/common/helpers/convict/validate-positive-integer-seconds.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormat(convictValidateNonEmptyString)
convict.addFormat(convictValidateHttpsUrl)
convict.addFormat(convictValidateBaseUrl)
convict.addFormat(convictValidateAlgorithmAllowlist)
convict.addFormat(convictValidatePositiveIntegerSeconds)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'mmo-cr-catch-recording-service'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: [
      'local',
      'infra-dev',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : ['req', 'res', 'responseTime']
    }
  },
  mongo: {
    mongoUrl: {
      doc: 'URI for mongodb',
      format: String,
      default: 'mongodb://127.0.0.1:27017/',
      env: 'MONGO_URI'
    },
    databaseName: {
      doc: 'database for mongodb',
      format: String,
      default: 'mmo-cr-catch-recording-service',
      env: 'MONGO_DATABASE'
    },
    mongoOptions: {
      retryWrites: {
        doc: 'Enable Mongo write retries, overrides mongo URI when set.',
        format: Boolean,
        default: null,
        nullable: true,
        env: 'MONGO_RETRY_WRITES'
      },
      readPreference: {
        doc: 'Mongo read preference, overrides mongo URI when set.',
        format: [
          'primary',
          'primaryPreferred',
          'secondary',
          'secondaryPreferred',
          'nearest'
        ],
        default: null,
        nullable: true,
        env: 'MONGO_READ_PREFERENCE'
      }
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  businessTimezone: {
    doc: 'Approved IANA business timezone used for every server-controlled Catch Record business date/time (e.g. the friendly Catch Record reference, trip "today" dates) - never the host machine or request timezone',
    format: String,
    default: 'Europe/London',
    env: 'BUSINESS_TIMEZONE'
  },
  authentication: {
    baseUrl: {
      doc: 'Base URL of the Authentication Service used to validate trusted caller bearer tokens',
      format: String,
      nullable: true,
      default: null,
      env: 'AUTHENTICATION_SERVICE_URL'
    },
    timeoutMs: {
      doc: 'Timeout in milliseconds for Authentication Service token-validation requests',
      format: 'nat',
      default: 2000,
      env: 'AUTHENTICATION_SERVICE_TIMEOUT_MS'
    },
    retryCount: {
      doc: 'Number of bounded retries for approved transient (502/503/504) Authentication Service failures',
      format: 'nat',
      default: 1,
      env: 'AUTHENTICATION_SERVICE_RETRY_COUNT'
    },
    retryDelayMs: {
      doc: 'Delay in milliseconds between bounded Authentication Service retries',
      format: 'nat',
      default: 100,
      env: 'AUTHENTICATION_SERVICE_RETRY_DELAY_MS'
    }
  },
  referenceData: {
    baseUrl: {
      doc: 'Base URL of the Reference Data Service',
      format: String,
      nullable: true,
      default: null,
      env: 'REFERENCE_DATA_SERVICE_URL'
    },
    serviceToken: {
      doc: 'Catch Recording Service own service-to-service credential presented to the Reference Data Service (never the inbound caller token)',
      format: String,
      nullable: true,
      default: null,
      env: 'REFERENCE_DATA_SERVICE_TOKEN'
    },
    timeoutMs: {
      doc: 'Timeout in milliseconds for Reference Data Service requests',
      format: 'nat',
      default: 2000,
      env: 'REFERENCE_DATA_SERVICE_TIMEOUT_MS'
    },
    retryCount: {
      doc: 'Number of bounded retries for approved transient (502/503/504) Reference Data Service failures',
      format: 'nat',
      default: 1,
      env: 'REFERENCE_DATA_SERVICE_RETRY_COUNT'
    },
    retryDelayMs: {
      doc: 'Delay in milliseconds between bounded Reference Data Service retries',
      format: 'nat',
      default: 100,
      env: 'REFERENCE_DATA_SERVICE_RETRY_DELAY_MS'
    }
  },
  catchArtifacts: {
    bucketName: {
      doc: 'S3-compatible bucket name used for immutable Catch Record submission artifacts (canonical JSON snapshots and PDF receipts). No credential is configured here - the AWS SDK default credential provider chain is used (env vars locally, an IAM task role in deployed CDP environments).',
      format: String,
      nullable: true,
      default: null,
      env: 'CATCH_ARTIFACTS_BUCKET'
    },
    region: {
      doc: 'AWS region for the S3-compatible artifact bucket',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    },
    endpoint: {
      doc: 'Optional S3-compatible endpoint override (e.g. the local floci emulator). Null uses the default AWS endpoint for the configured region.',
      format: String,
      nullable: true,
      default: null,
      env: 'AWS_ENDPOINT_URL'
    },
    forcePathStyle: {
      doc: 'Use path-style S3 addressing. Required by local S3-compatible emulators such as floci; must remain false against real AWS S3.',
      format: Boolean,
      default: false,
      env: 'CATCH_ARTIFACTS_FORCE_PATH_STYLE'
    },
    maxPdfRenderedItems: {
      doc: 'A pragmatic rendering-safety bound: the maximum number of gear/species entries rendered into a PDF receipt (approved PDF safety-limit decision - Step 33, no externally mandated value exists).',
      format: 'nat',
      default: 200,
      env: 'CATCH_ARTIFACTS_MAX_PDF_RENDERED_ITEMS'
    }
  },
  entra: {
    issuer: {
      doc: 'Expected Microsoft Entra External ID token issuer (Phase 01/Step 02 configuration foundation only - not yet consumed; JWT validation is implemented in Step 03). Nullable/unset like `authentication.baseUrl` - no production requiredness gate exists yet because nothing consumes this value in this phase (user-confirmed decision, no approved activation contract exists).',
      format: 'non-empty-string',
      nullable: true,
      default: null,
      env: 'ENTRA_ISSUER'
    },
    audience: {
      doc: 'Expected Microsoft Entra External ID token audience (API identifier). Distinct from `issuer` and from any scope/client identifier. Not yet consumed - see `entra.issuer` doc.',
      format: 'non-empty-string',
      nullable: true,
      default: null,
      env: 'ENTRA_AUDIENCE'
    },
    oidcMetadataUrl: {
      doc: 'Approved OpenID Connect metadata endpoint for Microsoft Entra External ID. Must be an absolute `https://` URL - no approved local/test HTTP exception exists, so none is permitted. Not yet consumed - see `entra.issuer` doc.',
      format: 'https-url',
      nullable: true,
      default: null,
      env: 'ENTRA_OIDC_METADATA_URL'
    },
    allowedAlgorithms: {
      doc: 'Explicit JWT signing-algorithm allowlist for future Entra token validation. `RS256` is the only initially-approved algorithm; `none` and symmetric algorithms (e.g. `HS256`) are always rejected. Not yet consumed - see `entra.issuer` doc.',
      format: 'algorithm-allowlist',
      default: ['RS256'],
      env: 'ENTRA_ALLOWED_ALGORITHMS'
    }
  },
  authorization: {
    rolesClaim: {
      doc: 'Name of the future Entra token claim carrying vessel roles. Approved default `vessel_roles`. Claim extraction itself is implemented in Step 06 - this is configuration only.',
      format: 'non-empty-string',
      default: 'vessel_roles',
      env: 'AUTHORIZATION_ROLES_CLAIM'
    },
    serviceId: {
      doc: "This service's own identifier when requesting role definitions from the User Profile Service. Approved default `catch-recording`. Not yet consumed - the User Profile Service client is implemented in Step 07.",
      format: 'non-empty-string',
      default: 'catch-recording',
      env: 'AUTHORIZATION_SERVICE_ID'
    },
    roleDefinitionsUrl: {
      doc: 'User Profile Service **base URL** (user-confirmed contract: a base URL, mirroring `authentication.baseUrl`/`referenceData.baseUrl` - the Step 07 client appends `/roles-definitions/services/{serviceId}`). Nullable/unset like those existing base URLs; not yet consumed.',
      format: 'base-url',
      nullable: true,
      default: null,
      env: 'USER_PROFILE_SERVICE_URL'
    },
    roleCacheTtlSeconds: {
      doc: 'User-approved duration (seconds) after which the Step 08 role-definition cache must refresh. Must be a positive integer. Not yet consumed - the cache itself is implemented in Step 08.',
      format: 'positive-integer-seconds',
      default: 600,
      env: 'AUTHORIZATION_ROLE_CACHE_TTL_SECONDS'
    },
    roleCacheMaximumStaleSeconds: {
      doc: 'User-approved maximum age (seconds) at which the Step 08 role-definition cache may still serve previously-validated data during a User Profile Service outage. Must be a positive integer greater than or equal to `roleCacheTtlSeconds` (enforced immediately below, since convict cannot express a cross-field relationship in a single format). Not yet consumed - see `roleCacheTtlSeconds` doc.',
      format: 'positive-integer-seconds',
      default: 6000,
      env: 'AUTHORIZATION_ROLE_CACHE_MAX_STALE_SECONDS'
    }
  }
})

config.validate({ allowed: 'strict' })

// Convict validates each property independently; this relationship spans two properties, so it is
// checked explicitly, immediately after the standard schema validation above, following the same
// "fail fast and loud at module load" convention.
if (
  config.get('authorization.roleCacheMaximumStaleSeconds') <
  config.get('authorization.roleCacheTtlSeconds')
) {
  throw new Error(
    'authorization.roleCacheMaximumStaleSeconds must be greater than or equal to authorization.roleCacheTtlSeconds'
  )
}
