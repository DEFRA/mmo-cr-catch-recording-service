import {
  assertAllowedKeys,
  assertNoServerOwnedFields
} from './catch-record-normalization-support.js'
import {
  normalizeGearEntry,
  normalizePairFishing,
  normalizeRetainedCatch,
  normalizeTrip,
  normalizeVesselSnapshot
} from './catch-record-nested-normalizers.js'
import { normalizeCatchRecordSection } from './catch-record-sections.js'

// CatchNormalization boundary (Step 02 — Catch Recording module boundaries; Step 06 — input
// normalisation).
//
// Represents the canonical input-conversion responsibility described in
// design/design/catch-recording-service-design.md §6.2. Step 06 adds the two approved entry points
// (`normalizeCatchRecord`, `normalizeSection`) that transform supported new-application input into
// Canonical Catch Record Object v1 values — see design/architecture/catch-record-input-normalisation.md
// for the full specification. Neither entry point generates, assigns, or accepts any server-owned field
// (identity, lifecycle, audit, artifact, or timestamp metadata); both are pure, deterministic, and never
// mutate their input.
const CATCH_RECORD_ROOT_FIELDS = Object.freeze([
  'vessel',
  'trip',
  'pairFishing',
  'gear',
  'retainedCatch'
])

function normalizeCatchRecord(input) {
  assertNoServerOwnedFields(input)
  assertAllowedKeys(input, CATCH_RECORD_ROOT_FIELDS)

  return {
    vessel: normalizeVesselSnapshot(input?.vessel),
    trip: normalizeTrip(input?.trip),
    pairFishing: normalizePairFishing(input?.pairFishing),
    gear: Array.isArray(input?.gear)
      ? input.gear.map((gear) => normalizeGearEntry(gear))
      : [],
    retainedCatch: normalizeRetainedCatch(input?.retainedCatch)
  }
}

function normalizeSection(sectionName, input, context = {}) {
  // The Step 05 server-owned-field catalogue is defined only at the catch-record root (there are no
  // nested server-owned paths). Each section's own strict allow-list (enforced inside its nested
  // normaliser) already structurally excludes every root-level server-owned field name, so no separate
  // `assertNoServerOwnedFields` call is applied here — a client attempting to smuggle, for example,
  // `status` into a `vessel` section payload is rejected as an unknown property by the vessel allow-list
  // itself, achieving the same protection. (A section's own `id`-type fields, such as `vessel.id` or
  // `statisticalArea.id`, are unrelated, client-selectable reference identifiers, not the catch-record's
  // own server-owned `id`.)
  return normalizeCatchRecordSection(sectionName, input, context)
}

export function createCatchNormalization() {
  return Object.freeze({
    name: 'CatchNormalization',
    dependencies: Object.freeze({}),
    normalizeCatchRecord,
    normalizeSection
  })
}
