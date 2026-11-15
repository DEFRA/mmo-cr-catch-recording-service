import { safeLog } from './safe-log.js'

describe('#safeLog', () => {
  test('Should pass the fields and message to the requested level', () => {
    const logger = { warn: vi.fn() }

    safeLog(logger, 'warn', { a: 1 }, 'msg')

    expect(logger.warn).toHaveBeenCalledWith({ a: 1 }, 'msg')
  })

  test.each([
    ['no logger', undefined],
    ['a logger without the level', {}],
    [
      'a logger that throws',
      {
        warn: () => {
          throw new Error('sink down')
        }
      }
    ]
  ])('Should never throw for %s', (_name, logger) => {
    expect(() => safeLog(logger, 'warn', {}, 'msg')).not.toThrow()
  })
})
