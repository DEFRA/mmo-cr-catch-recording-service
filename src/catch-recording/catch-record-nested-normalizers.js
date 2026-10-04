import { assertAllowedKeys } from './catch-record-normalization-support.js'
import {
  normalizeBoolean,
  normalizeCalendarDate,
  normalizeIdentifier,
  normalizePositiveNumber,
  normalizeText,
  normalizeYesNo
} from './catch-record-primitive-normalizers.js'

// CatchNormalization nested normalisers (Step 06).
//
// Every function here builds and returns a brand-new object/array — none ever returns or shares a nested
// reference from its input, and none mutates its input. Every object applies `assertAllowedKeys` first,
// so an invented field is rejected before any value is read from it.
const VESSEL_FIELDS = Object.freeze([
  'id',
  'nameSnapshot',
  'registrationSnapshot',
  'externalMarkSnapshot',
  'lengthOverallMetres'
])

const PORT_FIELDS = Object.freeze(['id', 'codeSnapshot', 'nameSnapshot'])

const TRIP_FIELDS = Object.freeze([
  'startedAndFinishedToday',
  'dateStarted',
  'dateEnded',
  'departurePort',
  'returnPort'
])

const PAIR_FISHING_FIELDS = Object.freeze([
  'enabled',
  'pairSkipperFullName',
  'pairVesselRssNumber'
])

const GEAR_CHARACTERISTIC_FIELDS = Object.freeze([
  'characteristicId',
  'nameSnapshot',
  'value'
])

const STATISTICAL_AREA_FIELDS = Object.freeze(['id', 'code', 'nameSnapshot'])

const SPECIES_ATTRIBUTE_FIELDS = Object.freeze([
  'attributeId',
  'nameSnapshot',
  'value'
])

const SPECIES_CAUGHT_FIELDS = Object.freeze([
  'speciesId',
  'faoCodeSnapshot',
  'nameSnapshot',
  'attributes'
])

const GEAR_FIELDS = Object.freeze([
  'gearId',
  'associationId',
  'codeSnapshot',
  'nameSnapshot',
  'characteristics',
  'statisticalArea',
  'speciesCaught'
])

const RETAINED_CATCH_FIELDS = Object.freeze(['answer', 'species'])

function normalizeOrNull(candidate, fields, build) {
  if (candidate === null || candidate === undefined) {
    return null
  }

  assertAllowedKeys(candidate, fields)

  return build(candidate)
}

export function normalizePortSnapshot(candidate) {
  return normalizeOrNull(candidate, PORT_FIELDS, (port) => ({
    id: normalizeIdentifier(port.id),
    codeSnapshot: normalizeText(port.codeSnapshot),
    nameSnapshot: normalizeText(port.nameSnapshot)
  }))
}

export function normalizeVesselSnapshot(candidate) {
  return normalizeOrNull(candidate, VESSEL_FIELDS, (vessel) => ({
    id: normalizeIdentifier(vessel.id),
    nameSnapshot: normalizeText(vessel.nameSnapshot),
    registrationSnapshot: normalizeText(vessel.registrationSnapshot),
    externalMarkSnapshot: normalizeText(vessel.externalMarkSnapshot),
    lengthOverallMetres: normalizePositiveNumber(vessel.lengthOverallMetres)
  }))
}

export function normalizeTrip(candidate) {
  return normalizeOrNull(candidate, TRIP_FIELDS, (trip) => ({
    startedAndFinishedToday: normalizeBoolean(trip.startedAndFinishedToday),
    dateStarted: normalizeCalendarDate(trip.dateStarted),
    dateEnded: normalizeCalendarDate(trip.dateEnded),
    departurePort: normalizePortSnapshot(trip.departurePort),
    returnPort: normalizePortSnapshot(trip.returnPort)
  }))
}

export function normalizePairFishing(candidate) {
  return normalizeOrNull(candidate, PAIR_FISHING_FIELDS, (pairFishing) => ({
    enabled: normalizeBoolean(pairFishing.enabled),
    pairSkipperFullName: normalizeText(pairFishing.pairSkipperFullName),
    pairVesselRssNumber: normalizeIdentifier(pairFishing.pairVesselRssNumber)
  }))
}

export function normalizeGearCharacteristic(candidate) {
  assertAllowedKeys(candidate, GEAR_CHARACTERISTIC_FIELDS)

  return {
    characteristicId: normalizeIdentifier(candidate.characteristicId),
    nameSnapshot: normalizeText(candidate.nameSnapshot),
    value: normalizeText(candidate.value)
  }
}

export function normalizeStatisticalArea(candidate) {
  return normalizeOrNull(candidate, STATISTICAL_AREA_FIELDS, (area) => ({
    id: normalizeIdentifier(area.id),
    code: normalizeText(area.code),
    nameSnapshot: normalizeText(area.nameSnapshot)
  }))
}

export function normalizeSpeciesAttribute(candidate) {
  assertAllowedKeys(candidate, SPECIES_ATTRIBUTE_FIELDS)

  return {
    attributeId: normalizeIdentifier(candidate.attributeId),
    nameSnapshot: normalizeText(candidate.nameSnapshot),
    value: normalizeText(candidate.value)
  }
}

export function normalizeSpeciesCaughtEntry(candidate) {
  assertAllowedKeys(candidate, SPECIES_CAUGHT_FIELDS)

  const attributes = Array.isArray(candidate.attributes)
    ? candidate.attributes.map((attribute) =>
        normalizeSpeciesAttribute(attribute)
      )
    : []

  return {
    speciesId: normalizeIdentifier(candidate.speciesId),
    faoCodeSnapshot: normalizeText(candidate.faoCodeSnapshot),
    nameSnapshot: normalizeText(candidate.nameSnapshot),
    attributes
  }
}

export function normalizeGearEntry(candidate) {
  assertAllowedKeys(candidate, GEAR_FIELDS)

  const characteristics = Array.isArray(candidate.characteristics)
    ? candidate.characteristics.map((characteristic) =>
        normalizeGearCharacteristic(characteristic)
      )
    : []

  const speciesCaught = Array.isArray(candidate.speciesCaught)
    ? candidate.speciesCaught.map((species) =>
        normalizeSpeciesCaughtEntry(species)
      )
    : []

  return {
    gearId: normalizeIdentifier(candidate.gearId),
    associationId: normalizeIdentifier(candidate.associationId),
    codeSnapshot: normalizeText(candidate.codeSnapshot),
    nameSnapshot: normalizeText(candidate.nameSnapshot),
    characteristics,
    statisticalArea: normalizeStatisticalArea(candidate.statisticalArea),
    speciesCaught
  }
}

// retainedCatch.species intentionally has no per-entry field contract: see the Step 05 user-approved
// deferral (resolved via Clarification Resolver escalation; recorded in
// design/architecture/canonical-catch-record-object-v1.md §10). Each entry is shallow-copied only — no
// field is read, renamed, or invented — so this normaliser remains compatible with whatever shape Phase 8
// later approves.
export function normalizeRetainedCatch(candidate) {
  return normalizeOrNull(candidate, RETAINED_CATCH_FIELDS, (retainedCatch) => ({
    answer: normalizeYesNo(retainedCatch.answer),
    species: Array.isArray(retainedCatch.species)
      ? retainedCatch.species.map((entry) =>
          entry !== null && typeof entry === 'object' ? { ...entry } : entry
        )
      : []
  }))
}

// Exported for Step 06 tests and the section registry (Phase D) that needs the exact allow-lists.
export const CATCH_RECORD_NESTED_FIELD_ALLOW_LISTS = Object.freeze({
  vessel: VESSEL_FIELDS,
  port: PORT_FIELDS,
  trip: TRIP_FIELDS,
  pairFishing: PAIR_FISHING_FIELDS,
  gearCharacteristic: GEAR_CHARACTERISTIC_FIELDS,
  statisticalArea: STATISTICAL_AREA_FIELDS,
  speciesAttribute: SPECIES_ATTRIBUTE_FIELDS,
  speciesCaught: SPECIES_CAUGHT_FIELDS,
  gear: GEAR_FIELDS,
  retainedCatch: RETAINED_CATCH_FIELDS
})

// Re-exported so section normalisers (Phase D) can reuse the same server-owned-field guard without a
// second import path.
export { assertNoServerOwnedFields } from './catch-record-normalization-support.js'
