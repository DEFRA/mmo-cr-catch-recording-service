import Joi from 'joi'
import Boom from '@hapi/boom'
import { findAllExampleData, findExampleData } from '#/services/ExampleFind.js'

const exampleEntitySchema = Joi.object({
  exampleId: Joi.string()
})
  .unknown(true)
  .label('ExampleEntity')

export const example = [
  {
    method: 'GET',
    path: '/example',
    options: {
      tags: ['api', 'Example'],
      response: {
        failAction: 'log',
        schema: Joi.array().items(exampleEntitySchema)
      }
    },
    handler: async (request, h) => {
      const entities = await findAllExampleData(request.db)
      return h.response(entities)
    }
  },
  {
    method: 'GET',
    path: '/example/{exampleId}',
    options: {
      tags: ['api', 'Example'],
      response: {
        failAction: 'log',
        schema: exampleEntitySchema
      }
    },
    handler: async (request, h) => {
      const entity = await findExampleData(request.db, request.params.exampleId)

      if (!entity) {
        return Boom.notFound()
      }

      return h.response(entity)
    }
  }
]
