/**
 * Pure, explicit per-type mappers from a strictly-validated Step 15 result to its exact canonical
 * `Snapshot` fields (`canonical-catch-record-object.md`). No generic field copier - each function names
 * its own output fields, excludes every transport/active-state/unknown field, and never mutates its
 * input or shares a mutable reference with it.
 */

/**
 * @param {{ identifiers: { registrationNumber: string|null, externalMark: string|null }, name: string,
 *   lengthOverallMetres: number }} vessel
 * @returns {Readonly<{ rssSnapshot: string|null, nameSnapshot: string, externalMarkSnapshot: string|null,
 *   lengthOverallMetresSnapshot: number }>}
 */
export function mapVesselSnapshot(vessel) {
  return Object.freeze({
    rssSnapshot: vessel.identifiers.registrationNumber,
    nameSnapshot: vessel.name,
    externalMarkSnapshot: vessel.identifiers.externalMark,
    lengthOverallMetresSnapshot: vessel.lengthOverallMetres
  })
}

/**
 * @param {{ code: string, name: string }} port
 * @returns {Readonly<{ codeSnapshot: string, nameSnapshot: string }>}
 */
export function mapPortSnapshot(port) {
  return Object.freeze({
    codeSnapshot: port.code,
    nameSnapshot: port.name
  })
}

/**
 * @param {{ code: string, name: string }} gear
 * @returns {Readonly<{ codeSnapshot: string, nameSnapshot: string }>}
 */
export function mapGearSnapshot(gear) {
  return Object.freeze({
    codeSnapshot: gear.code,
    nameSnapshot: gear.name
  })
}

/**
 * @param {{ code: string, name: string }} statisticalArea
 * @returns {Readonly<{ codeSnapshot: string, nameSnapshot: string }>}
 */
export function mapStatisticalAreaSnapshot(statisticalArea) {
  return Object.freeze({
    codeSnapshot: statisticalArea.code,
    nameSnapshot: statisticalArea.name
  })
}

/**
 * Species `nameSnapshot` resolution (confirmed in `docs/configuration-decisions.md`, no mobile-view
 * resolver is used): the first `commonNames[]` entry, falling back to `scientificName` when no common
 * name is present.
 *
 * @param {{ faoCode: string, scientificName: string, commonNames: Array<{ name: string }> }} species
 * @returns {Readonly<{ faoCodeSnapshot: string, nameSnapshot: string }>}
 */
export function mapSpeciesSnapshot(species) {
  const displayName = species.commonNames[0]?.name ?? species.scientificName

  return Object.freeze({
    faoCodeSnapshot: species.faoCode,
    nameSnapshot: displayName
  })
}

/**
 * @param {{ name: string, unit: string|null }} characteristic
 * @returns {Readonly<{ nameSnapshot: string, unitSnapshot: string|null }>}
 */
export function mapGearCharacteristicSnapshot(characteristic) {
  return Object.freeze({
    nameSnapshot: characteristic.name,
    unitSnapshot: characteristic.unit
  })
}
