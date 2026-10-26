/**
 * Approved active-selection rules, confirmed per type in `docs/configuration-decisions.md`. Deliberately
 * explicit and type-specific - no generic status interpreter accepts an arbitrary value.
 */

/**
 * Vessels use a free-form `status` string; only the literal `"active"` counts as selectable.
 *
 * @param {{ status?: unknown }} vessel
 * @returns {boolean}
 */
export function isVesselSelectable(vessel) {
  return vessel?.status === 'active'
}

/**
 * Ports and species both use a strict boolean `active` field - reused across both.
 *
 * @param {{ active?: unknown }} item
 * @returns {boolean}
 */
export function isSelectable(item) {
  return item?.active === true
}

/**
 * Statistical areas have no active/inactive field anywhere in the confirmed Reference Data Service
 * schema - every resolved statistical area is treated as selectable. A function (not a bare constant)
 * so every resource type has the same call shape at the resolver call site.
 *
 * @returns {true}
 */
export function isStatisticalAreaSelectable() {
  return true
}

/**
 * Gears are now resolved via the Reference Data Service's mobile view (Step 43 — the canonical view's
 * collection envelope stopped reliably returning the top-level `characteristics[]` catalog needed to
 * resolve a gear's characteristics, so `getGearById` switched to `view=mobile`, whose `GearMobileItem`
 * schema carries no `active` field at all). Confirmed product decision: gear active-selection is no
 * longer checked - a gear resolves successfully regardless of any upstream active/inactive state. A
 * function (not a bare constant) so every resource type has the same call shape at the resolver call
 * site.
 *
 * @returns {true}
 */
export function isGearSelectable() {
  return true
}
