import {
  readBoundedText,
  ResponseBodyTooLargeError
} from './read-bounded-text.js'

describe('#readBoundedText', () => {
  test('Should return a streamed body within the limit', async () => {
    await expect(readBoundedText(new Response('hello'), 10)).resolves.toBe(
      'hello'
    )
  })

  test('Should reject a streamed body larger than the limit', async () => {
    await expect(
      readBoundedText(new Response('x'.repeat(50)), 10)
    ).rejects.toBeInstanceOf(ResponseBodyTooLargeError)
  })

  test('Should reject a declared content-length larger than the limit before reading', async () => {
    const response = new Response('ok', {
      headers: { 'content-length': '5000' }
    })

    await expect(readBoundedText(response, 10)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError
    )
  })

  test('Should bound a response whose body cannot be streamed', async () => {
    const unstreamable = (text) => ({
      headers: new Headers(),
      text: async () => text
    })

    await expect(readBoundedText(unstreamable('abc'), 10)).resolves.toBe('abc')
    await expect(
      readBoundedText(unstreamable('x'.repeat(50)), 10)
    ).rejects.toBeInstanceOf(ResponseBodyTooLargeError)
  })
})
