/**
 * The one trusted business-date source shared by every Catch Recording operation that needs "today" in
 * the approved business timezone (`config.get('businessTimezone')`, default `Europe/London`) - never the
 * host machine's local date, never a client-supplied date, and never UTC-naive. Uses full DST-aware
 * `Intl.DateTimeFormat` conversion (the same approach Step 17's friendly-reference generation already
 * uses), not a fixed UTC offset.
 */

/**
 * Returns the server-controlled trusted business date in canonical ISO `YYYY-MM-DD` form.
 *
 * @param {Object} input
 * @param {string} input.timezone an IANA timezone identifier
 * @param {() => Date} [input.now] server-controlled clock; never a client-supplied value
 * @returns {string} `YYYY-MM-DD` in the approved business timezone
 */
export function getTrustedBusinessDate({ timezone, now = () => new Date() }) {
  // The `en-CA` locale's short date format is the one built-in `Intl.DateTimeFormat` output that is
  // already `YYYY-MM-DD` - deliberately chosen over manually reassembling `formatToParts` output.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now())
}
