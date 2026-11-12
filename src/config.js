import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#/common/helpers/convict/validate-mongo-uri.js'
import { validateEntraAuthorizationConfig } from '#/common/helpers/convict/validate-entra-authorization-config.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

// Non-production, clearly synthetic values so tests start with a complete, internally consistent
// configuration. Outside tests, every trust-boundary value has no default and must be supplied.
const testValue = (value) => (isTest ? value : null)

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
  entra: {
    issuer: {
      doc: 'Exact expected Entra External ID access-token issuer (the `iss` claim). Wildcards are rejected.',
      format: String,
      nullable: true,
      default: testValue('https://login.entra.test.invalid/test-tenant/v2.0'),
      env: 'ENTRA_ISSUER'
    },
    audience: {
      doc: 'Exact expected access-token audience (the `aud` claim) identifying the Catch Recording API. Wildcards are rejected.',
      format: String,
      nullable: true,
      default: testValue('api://catch-recording-test'),
      env: 'ENTRA_AUDIENCE'
    },
    oidcMetadataUrl: {
      doc: 'OpenID Connect metadata (discovery) document URL, the only source of the `jwks_uri`',
      format: String,
      nullable: true,
      default: testValue(
        'https://login.entra.test.invalid/test-tenant/v2.0/.well-known/openid-configuration'
      ),
      env: 'ENTRA_OIDC_METADATA_URL'
    },
    allowedAlgorithms: {
      doc: 'Allow-list of accepted JWT signing algorithms (comma-separated in the environment). Only RS256 is supported.',
      format: Array,
      default: ['RS256'],
      env: 'ENTRA_ALLOWED_ALGORITHMS'
    },
    userIdClaim: {
      doc: 'Name of the approved stable user-identifier claim (for example `oid` or `sub`) used for User Profile Service lookup. Read only after full token validation.',
      format: String,
      nullable: true,
      default: testValue('oid'),
      env: 'ENTRA_USER_ID_CLAIM'
    },
    metadataRefreshIntervalSeconds: {
      doc: 'Seconds after which cached OIDC metadata and signing keys are refreshed on the normal refresh policy',
      format: 'nat',
      nullable: true,
      default: isTest ? 3600 : null,
      env: 'ENTRA_METADATA_REFRESH_INTERVAL_SECONDS'
    },
    minimumRefreshIntervalSeconds: {
      doc: 'Minimum seconds between OIDC metadata/JWKS refresh attempts, preventing refresh storms (including unknown-`kid` refreshes)',
      format: 'nat',
      nullable: true,
      default: isTest ? 60 : null,
      env: 'ENTRA_MINIMUM_REFRESH_INTERVAL_SECONDS'
    },
    requestTimeoutMs: {
      doc: 'Timeout in milliseconds for OIDC metadata and JWKS requests',
      format: 'nat',
      nullable: true,
      default: isTest ? 2000 : null,
      env: 'ENTRA_REQUEST_TIMEOUT_MS'
    }
  },
  authorization: {
    serviceId: {
      doc: 'User Profile Service identifier of this service, used to select its role-to-capability definitions',
      format: String,
      default: 'catch-recording',
      env: 'AUTHORIZATION_SERVICE_ID'
    },
    userRolesUrlTemplate: {
      doc: 'User Profile Service user-roles URL template; must contain the {entraObjectId} placeholder once, in the path',
      format: String,
      nullable: true,
      default: testValue(
        'https://user-profile.test.invalid/users/{entraObjectId}/roles'
      ),
      env: 'AUTHORIZATION_USER_ROLES_URL_TEMPLATE'
    },
    roleDefinitionsUrl: {
      doc: 'User Profile Service role-definitions URL for this service; must end with /roles-definitions/services/<serviceId>',
      format: String,
      nullable: true,
      default: testValue(
        'https://user-profile.test.invalid/roles-definitions/services/catch-recording'
      ),
      env: 'AUTHORIZATION_ROLE_DEFINITIONS_URL'
    },
    userRoleCacheTtlSeconds: {
      doc: 'Seconds a validated user-role assignment may be cached. Initial approved value is 300; an expired entry is never used.',
      format: 'nat',
      default: 300,
      env: 'AUTHORIZATION_USER_ROLE_CACHE_TTL_SECONDS'
    },
    userRoleCacheMaximumEntries: {
      doc: 'Maximum number of users held in the bounded user-role cache',
      format: 'nat',
      nullable: true,
      default: isTest ? 100 : null,
      env: 'AUTHORIZATION_USER_ROLE_CACHE_MAXIMUM_ENTRIES'
    },
    roleDefinitionsCacheTtlSeconds: {
      doc: 'Seconds a role-definitions snapshot is fresh; after this a refresh is required',
      format: 'nat',
      nullable: true,
      default: isTest ? 60 : null,
      env: 'AUTHORIZATION_ROLE_DEFINITIONS_CACHE_TTL_SECONDS'
    },
    roleDefinitionsCacheMaximumStaleSeconds: {
      doc: 'Additional seconds, after the snapshot stops being fresh, during which the last validated snapshot may still be used when a refresh fails (total usable age is TTL plus this value)',
      format: 'nat',
      nullable: true,
      default: isTest ? 300 : null,
      env: 'AUTHORIZATION_ROLE_DEFINITIONS_CACHE_MAXIMUM_STALE_SECONDS'
    },
    userProfileRequestTimeoutMs: {
      doc: 'Timeout in milliseconds for User Profile Service requests',
      format: 'nat',
      default: 2000,
      env: 'USER_PROFILE_SERVICE_TIMEOUT_MS'
    },
    userProfileRetryCount: {
      doc: 'Number of bounded retries for approved transient (502/503/504) User Profile Service failures',
      format: 'nat',
      default: 1,
      env: 'USER_PROFILE_SERVICE_RETRY_COUNT'
    },
    userProfileRetryDelayMs: {
      doc: 'Delay in milliseconds between bounded User Profile Service retries',
      format: 'nat',
      default: 100,
      env: 'USER_PROFILE_SERVICE_RETRY_DELAY_MS'
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
  }
})

config.validate({ allowed: 'strict' })

// Local development is the only runtime allowed to run without, or with http, Entra/authorization URLs
export const isLocalRuntime =
  config.get('cdpEnvironment') === 'local' && !isProduction

validateEntraAuthorizationConfig(config.get(), { isLocalRuntime })
