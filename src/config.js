import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#/common/helpers/convict/validate-mongo-uri.js'
import { convictValidateMongoCollectionName } from '#/common/helpers/convict/validate-mongo-collection-name.js'
import { assertUniqueCollectionNames } from '#/common/helpers/convict/assert-unique-collection-names.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormat(convictValidateMongoCollectionName)
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
  catchRecording: {
    persistence: {
      collections: {
        catchRecords: {
          doc: 'MongoDB collection name for persisted catch records (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'catchRecords',
          env: 'CATCH_RECORDING_COLLECTION_CATCH_RECORDS'
        },
        catchRecordHistory: {
          doc: 'MongoDB collection name for catch-record history/audit events (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'catchRecordHistory',
          env: 'CATCH_RECORDING_COLLECTION_CATCH_RECORD_HISTORY'
        },
        idempotencyRecords: {
          doc: 'MongoDB collection name for idempotency records (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'idempotencyRecords',
          env: 'CATCH_RECORDING_COLLECTION_IDEMPOTENCY_RECORDS'
        },
        submissionOperations: {
          doc: 'MongoDB collection name for submission-operation state (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'submissionOperations',
          env: 'CATCH_RECORDING_COLLECTION_SUBMISSION_OPERATIONS'
        },
        vesselGearFavourites: {
          doc: 'MongoDB collection name for vessel gear favourites (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'vesselGearFavourites',
          env: 'CATCH_RECORDING_COLLECTION_VESSEL_GEAR_FAVOURITES'
        },
        vesselSpeciesFavourites: {
          doc: 'MongoDB collection name for vessel species favourites (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'vesselSpeciesFavourites',
          env: 'CATCH_RECORDING_COLLECTION_VESSEL_SPECIES_FAVOURITES'
        },
        vesselPortFavourites: {
          doc: 'MongoDB collection name for vessel port favourites (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'vesselPortFavourites',
          env: 'CATCH_RECORDING_COLLECTION_VESSEL_PORT_FAVOURITES'
        },
        skippers: {
          doc: 'MongoDB collection name for skippers (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'skippers',
          env: 'CATCH_RECORDING_COLLECTION_SKIPPERS'
        },
        skipperVesselAssociations: {
          doc: 'MongoDB collection name for skipper-to-vessel associations (future persistence-adapter step)',
          format: 'mongo-collection-name',
          default: 'skipperVesselAssociations',
          env: 'CATCH_RECORDING_COLLECTION_SKIPPER_VESSEL_ASSOCIATIONS'
        }
      }
    }
  }
})

config.validate({ allowed: 'strict' })

// Convict's per-field format validation cannot see sibling values, so collection-name uniqueness is
// enforced explicitly here, immediately after strict validation. This remains a deterministic startup
// failure (a plain Error) — never an ApplicationError, Boom error, or HTTP response (see
// design/architecture/catch-recording-configuration-contracts.md §14).
assertUniqueCollectionNames(
  config.get('catchRecording.persistence.collections')
)
