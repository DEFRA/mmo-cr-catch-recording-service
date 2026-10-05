/**
 * Deterministic, allow-list detail sanitiser for public error responses.
 *
 * Only these fields are ever permitted into a public response, per
 * `design/architecture/catch-recording-error-handling.md` §5. Anything else — including raw Joi
 * context, submitted values, or arbitrary caller-added properties — is silently omitted rather than
 * copied. The input is never mutated; a fresh array of fresh plain objects is always returned.
 */

const ALLOWED_STRING_FIELDS = ['code', 'message', 'format']
const ALLOWED_NUMBER_FIELDS = ['min', 'max']

function toSafePath(path) {
  if (typeof path === 'string') {
    return path
  }

  if (Array.isArray(path)) {
    const safeSegments = path.filter(
      (segment) => typeof segment === 'string' || typeof segment === 'number'
    )

    return safeSegments.length > 0 ? safeSegments.join('.') : undefined
  }

  return undefined
}

function toSafeAllowedValues(allowedValues) {
  if (!Array.isArray(allowedValues)) {
    return undefined
  }

  const safeValues = allowedValues.filter(
    (value) =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
  )

  return safeValues.length > 0 ? safeValues : undefined
}

function sanitiseDetail(rawDetail) {
  if (
    typeof rawDetail !== 'object' ||
    rawDetail === null ||
    Array.isArray(rawDetail)
  ) {
    return undefined
  }

  const safeDetail = {}

  if (Object.hasOwn(rawDetail, 'path')) {
    const safePath = toSafePath(rawDetail.path)
    if (safePath !== undefined) {
      safeDetail.path = safePath
    }
  }

  for (const field of ALLOWED_STRING_FIELDS) {
    if (
      Object.hasOwn(rawDetail, field) &&
      typeof rawDetail[field] === 'string'
    ) {
      safeDetail[field] = rawDetail[field]
    }
  }

  for (const field of ALLOWED_NUMBER_FIELDS) {
    if (
      Object.hasOwn(rawDetail, field) &&
      typeof rawDetail[field] === 'number'
    ) {
      safeDetail[field] = rawDetail[field]
    }
  }

  if (Object.hasOwn(rawDetail, 'allowedValues')) {
    const safeAllowedValues = toSafeAllowedValues(rawDetail.allowedValues)
    if (safeAllowedValues !== undefined) {
      safeDetail.allowedValues = safeAllowedValues
    }
  }

  return Object.keys(safeDetail).length > 0
    ? Object.freeze(safeDetail)
    : undefined
}

export function sanitiseDetails(details) {
  if (!Array.isArray(details)) {
    return undefined
  }

  const safeDetails = details
    .map((rawDetail) => sanitiseDetail(rawDetail))
    .filter((safeDetail) => safeDetail !== undefined)

  return safeDetails.length > 0 ? Object.freeze(safeDetails) : undefined
}
