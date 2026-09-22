import type { FastifyBaseLogger, FastifyRequest, FastifyServerOptions } from 'fastify'
import pino from 'pino'

function requestPath(url: string): string {
  // Omit every query parameter, including encoded/batched tRPC input. Do not
  // decode or parse wallet data just to decide whether it is safe to log.
  return url.split(/[?#]/, 1)[0] ?? ''
}

export const requestLoggerFactory: NonNullable<FastifyServerOptions['childLoggerFactory']> = (
  logger,
  bindings,
  options,
  rawRequest,
): FastifyBaseLogger => {
  const url = rawRequest.url ?? ''
  const path = requestPath(url)
  const redactUrl = (value: string): string => (url !== path ? value.replaceAll(url, () => path) : value)

  return logger.child(bindings, {
    ...options,
    serializers: {
      ...options.serializers,
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: requestPath(request.url),
        remoteAddress: request.ip,
        remotePort: request.socket.remotePort,
      }),
      // Fastify also embeds the raw URL in 404 and duplicate-reply messages.
      msg: redactUrl,
      err: (error: Error) => {
        const serialized = pino.stdSerializers.err(error)
        // Keep diagnostic fields only; arbitrary error properties can contain
        // request bodies, headers, or URLs that bypass the request serializer.
        return {
          type: serialized.type,
          message: redactUrl(serialized.message),
          stack: serialized.stack ? redactUrl(serialized.stack) : undefined,
          code: serialized['code'],
          statusCode: serialized['statusCode'],
        }
      },
    },
  })
}
