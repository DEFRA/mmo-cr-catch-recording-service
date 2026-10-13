import Joi from 'joi'

const healthResponseSchema = Joi.object({
  message: Joi.string().valid('success').required()
}).label('HealthResponse')

export const health = {
  method: 'GET',
  path: '/health',
  options: {
    tags: ['api', 'Platform'],
    response: {
      failAction: 'log',
      schema: healthResponseSchema
    }
  },
  handler: (_request, h) => h.response({ message: 'success' })
}
