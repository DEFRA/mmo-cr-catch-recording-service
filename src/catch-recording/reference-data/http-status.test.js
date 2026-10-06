import {
  HTTP_STATUS_OK,
  HTTP_STATUS_MULTIPLE_CHOICES,
  HTTP_STATUS_NOT_FOUND,
  isSuccessStatus
} from './http-status.js'

describe('#isSuccessStatus', () => {
  test('Should be true for the 2xx range', () => {
    expect(isSuccessStatus(HTTP_STATUS_OK)).toBe(true)
    expect(isSuccessStatus(250)).toBe(true)
    expect(isSuccessStatus(299)).toBe(true)
  })

  test('Should be false below 200 and at/above 300', () => {
    expect(isSuccessStatus(199)).toBe(false)
    expect(isSuccessStatus(HTTP_STATUS_MULTIPLE_CHOICES)).toBe(false)
    expect(isSuccessStatus(HTTP_STATUS_NOT_FOUND)).toBe(false)
  })
})
