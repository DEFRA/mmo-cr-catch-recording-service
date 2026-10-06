/**
 * Small, reusable primitive checks shared by every resource-specific response validator in this
 * directory. Deliberately not a generic schema engine - each resource module still writes its own
 * explicit, field-by-field validation composed from these primitives.
 */

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

export function isNullableString(value) {
  return value === null || isNonEmptyString(value)
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isNullableFiniteNumber(value) {
  return value === null || isFiniteNumber(value)
}

export function isBoolean(value) {
  return typeof value === 'boolean'
}

export function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry))
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
