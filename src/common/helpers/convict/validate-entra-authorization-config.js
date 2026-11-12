export const USER_ID_PLACEHOLDER = '{entraObjectId}'
export const SUPPORTED_SIGNING_ALGORITHMS = Object.freeze(['RS256'])

const SERVICE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const CLAIM_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/
const ROLE_DEFINITIONS_PATH_PREFIX = '/roles-definitions/services/'
const MILLISECONDS_PER_SECOND = 1000

const ENTRA_TRUST_BOUNDARY_FIELDS = [
  'issuer',
  'audience',
  'oidcMetadataUrl',
  'userIdClaim',
  'metadataRefreshIntervalSeconds',
  'minimumRefreshIntervalSeconds',
  'requestTimeoutMs'
]
const AUTHORIZATION_REQUIRED_FIELDS = [
  'userRolesUrlTemplate',
  'roleDefinitionsUrl',
  'userRoleCacheMaximumEntries',
  'roleDefinitionsCacheTtlSeconds',
  'roleDefinitionsCacheMaximumStaleSeconds'
]

const isPresent = (value) => value !== null && value !== undefined
const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0

function parseAbsoluteUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function checkUrl(errors, path, value, { allowHttp }) {
  if (!isNonEmptyString(value) || value !== value.trim()) {
    errors.push(`${path} must be a non-empty absolute URL`)
    return null
  }

  const url = parseAbsoluteUrl(value)
  const allowedProtocols = allowHttp ? ['https:', 'http:'] : ['https:']

  if (!url || !allowedProtocols.includes(url.protocol)) {
    errors.push(
      `${path} must be an absolute ${allowHttp ? 'http(s)' : 'https'} URL`
    )
    return null
  }

  if (url.username || url.password || url.hash) {
    errors.push(`${path} must not contain credentials or a fragment`)
    return null
  }

  return url
}

function checkTrimmedText(errors, path, value) {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} must be a non-empty string`)
    return false
  }

  if (value !== value.trim() || value.includes('*')) {
    errors.push(
      `${path} must not contain surrounding whitespace or wildcard characters`
    )
    return false
  }

  return true
}

function checkPositiveInteger(errors, path, value, unit) {
  if (!isPositiveInteger(value)) {
    errors.push(`${path} must be a positive integer number of ${unit}`)
    return false
  }

  return true
}

function checkAllowedAlgorithms(errors, value) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('entra.allowedAlgorithms must be a non-empty list')
    return
  }

  const unsupported = value.some(
    (algorithm) => !SUPPORTED_SIGNING_ALGORITHMS.includes(algorithm)
  )
  if (unsupported) {
    errors.push(
      `entra.allowedAlgorithms may only contain: ${SUPPORTED_SIGNING_ALGORITHMS.join(', ')}`
    )
  }

  if (new Set(value).size !== value.length) {
    errors.push('entra.allowedAlgorithms must not contain duplicates')
  }
}

function checkEntra(errors, entra, { allowHttp }) {
  if (checkTrimmedText(errors, 'entra.issuer', entra.issuer)) {
    checkUrl(errors, 'entra.issuer', entra.issuer, { allowHttp })
  }
  checkTrimmedText(errors, 'entra.audience', entra.audience)
  checkUrl(errors, 'entra.oidcMetadataUrl', entra.oidcMetadataUrl, {
    allowHttp
  })

  if (
    !isNonEmptyString(entra.userIdClaim) ||
    !CLAIM_NAME_PATTERN.test(entra.userIdClaim)
  ) {
    errors.push(
      'entra.userIdClaim must be a single claim name without whitespace or wildcard characters'
    )
  }

  checkAllowedAlgorithms(errors, entra.allowedAlgorithms)

  const refreshValid = checkPositiveInteger(
    errors,
    'entra.metadataRefreshIntervalSeconds',
    entra.metadataRefreshIntervalSeconds,
    'seconds'
  )
  const minimumValid = checkPositiveInteger(
    errors,
    'entra.minimumRefreshIntervalSeconds',
    entra.minimumRefreshIntervalSeconds,
    'seconds'
  )
  if (
    refreshValid &&
    minimumValid &&
    entra.minimumRefreshIntervalSeconds > entra.metadataRefreshIntervalSeconds
  ) {
    errors.push(
      'entra.minimumRefreshIntervalSeconds must not exceed entra.metadataRefreshIntervalSeconds'
    )
  }

  checkPositiveInteger(
    errors,
    'entra.requestTimeoutMs',
    entra.requestTimeoutMs,
    'milliseconds'
  )
}

function checkUserRolesTemplate(errors, template, { allowHttp }) {
  const placeholderCount = isNonEmptyString(template)
    ? template.split(USER_ID_PLACEHOLDER).length - 1
    : 0

  if (placeholderCount !== 1) {
    errors.push(
      `authorization.userRolesUrlTemplate must contain the ${USER_ID_PLACEHOLDER} placeholder exactly once`
    )
    return
  }

  const sample = 'placeholder-check'
  const url = checkUrl(
    errors,
    'authorization.userRolesUrlTemplate',
    template.replace(USER_ID_PLACEHOLDER, sample),
    { allowHttp }
  )

  const placeholderIsInPath =
    url &&
    url.pathname.includes(sample) &&
    !url.origin.includes(sample) &&
    !url.search.includes(sample)
  if (url && !placeholderIsInPath) {
    errors.push(
      `authorization.userRolesUrlTemplate must place ${USER_ID_PLACEHOLDER} in the URL path`
    )
  }
}

function checkRoleDefinitionsUrl(errors, value, serviceId, { allowHttp }) {
  const url = checkUrl(errors, 'authorization.roleDefinitionsUrl', value, {
    allowHttp
  })
  if (!url || !SERVICE_ID_PATTERN.test(serviceId ?? '')) {
    return
  }

  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith(`${ROLE_DEFINITIONS_PATH_PREFIX}${serviceId}`)) {
    errors.push(
      `authorization.roleDefinitionsUrl must end with ${ROLE_DEFINITIONS_PATH_PREFIX}<authorization.serviceId>`
    )
  }
}

function checkRoleDefinitionsCachePolicy(errors, authorization) {
  const ttlValid = checkPositiveInteger(
    errors,
    'authorization.roleDefinitionsCacheTtlSeconds',
    authorization.roleDefinitionsCacheTtlSeconds,
    'seconds'
  )
  const staleValid = checkPositiveInteger(
    errors,
    'authorization.roleDefinitionsCacheMaximumStaleSeconds',
    authorization.roleDefinitionsCacheMaximumStaleSeconds,
    'seconds'
  )

  // The maximum-stale period is the additional time a validated snapshot may be used after it stops being fresh
  const totalMilliseconds =
    (authorization.roleDefinitionsCacheTtlSeconds +
      authorization.roleDefinitionsCacheMaximumStaleSeconds) *
    MILLISECONDS_PER_SECOND
  if (ttlValid && staleValid && !Number.isSafeInteger(totalMilliseconds)) {
    errors.push(
      'authorization.roleDefinitionsCacheTtlSeconds plus authorization.roleDefinitionsCacheMaximumStaleSeconds is too large'
    )
  }
}

function checkAuthorization(errors, authorization, { allowHttp }) {
  if (!SERVICE_ID_PATTERN.test(authorization.serviceId ?? '')) {
    errors.push(
      'authorization.serviceId must be a lower-case kebab-case service identifier'
    )
  }

  checkUserRolesTemplate(errors, authorization.userRolesUrlTemplate, {
    allowHttp
  })
  checkRoleDefinitionsUrl(
    errors,
    authorization.roleDefinitionsUrl,
    authorization.serviceId,
    { allowHttp }
  )

  checkPositiveInteger(
    errors,
    'authorization.userRoleCacheTtlSeconds',
    authorization.userRoleCacheTtlSeconds,
    'seconds'
  )
  checkPositiveInteger(
    errors,
    'authorization.userRoleCacheMaximumEntries',
    authorization.userRoleCacheMaximumEntries,
    'entries'
  )
  checkRoleDefinitionsCachePolicy(errors, authorization)
  checkPositiveInteger(
    errors,
    'authorization.userProfileRequestTimeoutMs',
    authorization.userProfileRequestTimeoutMs,
    'milliseconds'
  )

  for (const field of ['userProfileRetryCount', 'userProfileRetryDelayMs']) {
    if (
      !Number.isSafeInteger(authorization[field]) ||
      authorization[field] < 0
    ) {
      errors.push(`authorization.${field} must be a non-negative integer`)
    }
  }
}

function isUnconfigured({ entra, authorization }) {
  return (
    ENTRA_TRUST_BOUNDARY_FIELDS.every((field) => !isPresent(entra[field])) &&
    AUTHORIZATION_REQUIRED_FIELDS.every(
      (field) => !isPresent(authorization[field])
    )
  )
}

/**
 * Validates the Entra and authorization configuration. Throws one Error naming every invalid field
 * (never the configured values) so a misconfigured deployment fails at startup.
 *
 * A fully unset configuration is tolerated only for local development, where the runtime does not yet
 * depend on it; any partial configuration, and any non-local environment, must be complete and valid.
 */
export function validateEntraAuthorizationConfig(
  { entra, authorization },
  { isLocalRuntime }
) {
  if (isLocalRuntime && isUnconfigured({ entra, authorization })) {
    return
  }

  const errors = []
  const options = { allowHttp: isLocalRuntime }

  checkEntra(errors, entra, options)
  checkAuthorization(errors, authorization, options)

  if (errors.length > 0) {
    throw new Error(
      `Invalid Entra/authorization configuration: ${errors.join('; ')}`
    )
  }
}
