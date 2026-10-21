import type { FastifyBaseLogger, FastifyRequest, FastifyServerOptions } from 'fastify'
import pino from 'pino'
import { hideWalletDetailsInText, hidesWalletDetails } from './log_redaction'

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
  // This replaces the logger's error serializer, so it hides wallet details the same way.
  const hideDetails = hidesWalletDetails(logger.level)
  const redactText = (value: string): string =>
    hideDetails ? hideWalletDetailsInText(redactUrl(value)) : redactUrl(value)

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
        const code: unknown = serialized['code']
        const statusCode: unknown = serialized['statusCode']
        // Keep diagnostic fields only; arbitrary error properties can contain
        // request bodies, headers, or URLs that bypass the request serializer.
        return {
          type: serialized.type,
          message: redactText(serialized.message),
          stack: serialized.stack ? redactText(serialized.stack) : undefined,
          code,
          statusCode,
        }
      },
    },
  })
}
