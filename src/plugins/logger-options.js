import { ecsFormat } from '@elastic/ecs-pino-format'
import { config } from '#/config.js'
import { getTraceId } from '@defra/hapi-tracing'

const logConfig = config.get('log')
const serviceName = config.get('serviceName')
const serviceVersion = config.get('serviceVersion')

const ECS_ROOT_FIELDS = new Set([
  'req',
  'res',
  'err',
  'error',
  'http',
  'url',
  'user_agent',
  'trace',
  'transaction',
  'span',
  'labels',
  'responseTime'
])

const isEcsKey = (key) =>
  ECS_ROOT_FIELDS.has(key) ||
  key.includes('.') ||
  key.startsWith('@') ||
  key === 'message'

/**
 * `event` is an ECS object (event.dataset is always set), so a string `event` clashes with the
 * CDP index mapping and non-ECS top-level fields are dropped. Move the event name to
 * `event.action` and nest every other custom field under the ECS `labels` object.
 */
export function toCdpFields(obj) {
  const { event, labels, ...rest } = obj
  const out = {}
  const custom = { ...labels }

  for (const [key, value] of Object.entries(rest)) {
    if (isEcsKey(key) || value === undefined) {
      out[key] = value
    } else {
      custom[key] = value
    }
  }

  if (typeof event === 'string') {
    out['event.action'] = event
  } else if (event !== undefined) {
    out.event = event
  }
  if (Object.keys(custom).length > 0) {
    out.labels = custom
  }
  return out
}

const ecsOptions = ecsFormat({ serviceVersion, serviceName })

const formatters = {
  ecs: {
    ...ecsOptions,
    formatters: {
      ...ecsOptions.formatters,
      log: (obj) => ecsOptions.formatters.log(toCdpFields(obj))
    }
  },
  'pino-pretty': { transport: { target: 'pino-pretty' } }
}

export const loggerOptions = {
  enabled: logConfig.isEnabled,
  ignorePaths: ['/health'],
  redact: {
    paths: logConfig.redact,
    remove: true
  },
  level: logConfig.level,
  ...formatters[logConfig.format],
  nesting: true,
  mixin() {
    const mixinValues = {}
    const traceId = getTraceId()
    if (traceId) {
      mixinValues.trace = { id: traceId }
    }
    return mixinValues
  }
}
