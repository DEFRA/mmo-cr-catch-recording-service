export const HTTP_STATUS_OK = 200
export const HTTP_STATUS_MULTIPLE_CHOICES = 300
export const HTTP_STATUS_NOT_FOUND = 404

/**
 * @param {number} status
 * @returns {boolean}
 */
export function isSuccessStatus(status) {
  return status >= HTTP_STATUS_OK && status < HTTP_STATUS_MULTIPLE_CHOICES
}
