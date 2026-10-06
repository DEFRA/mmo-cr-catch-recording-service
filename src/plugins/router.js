import { health } from '#/routes/health.js'
import { example } from '#/routes/example.js'
import { catchRecords } from '#/routes/catch-records.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health].concat(example).concat(catchRecords))
    }
  }
}
