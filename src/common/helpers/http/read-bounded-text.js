export class ResponseBodyTooLargeError extends Error {
  constructor() {
    super('Response body exceeds the permitted size')
    this.name = 'ResponseBodyTooLargeError'
  }
}

/**
 * Reads a response body as text without ever holding more than `maxBytes` of it: a larger declared
 * `content-length`, or a larger streamed body, throws {@link ResponseBodyTooLargeError}.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
export async function readBoundedText(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ResponseBodyTooLargeError()
  }

  if (!response.body?.[Symbol.asyncIterator]) {
    const fullText = await response.text()
    if (Buffer.byteLength(fullText) > maxBytes) {
      throw new ResponseBodyTooLargeError()
    }
    return fullText
  }

  const decoder = new TextDecoder()
  let received = 0
  let text = ''

  // Leaving the iterator early (including by throwing) cancels the underlying stream
  for await (const value of response.body) {
    received += value.byteLength
    if (received > maxBytes) {
      throw new ResponseBodyTooLargeError()
    }
    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}
