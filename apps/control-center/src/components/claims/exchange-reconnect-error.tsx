import { Button } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result'
import { ErrorInline } from '@hoseki/packages/ui/design-system'
import { TRPCClientError } from '@trpc/client'
import { z } from 'zod'

export interface ExchangeConnectErrorState {
  message: string
  isMismatch: boolean
}

const TrpcErrorDataSchema = z.object({
  code: z.string().optional(),
})

export function parseExchangeConnectError(error: Error, fallbackMessage: string): ExchangeConnectErrorState {
  const message = error.message !== '' ? error.message : fallbackMessage
  if (error instanceof TRPCClientError) {
    const parsed = parseUnknown(TrpcErrorDataSchema, error.data)
    if (parsed.isOk() && parsed.unwrap().code === 'CONFLICT') {
      return { message, isMismatch: true }
    }
  }
  return { message, isMismatch: false }
}

export function ExchangeReconnectError({
  exchangeName,
  error,
  onConnectAsNew,
}: {
  exchangeName: string
  error: ExchangeConnectErrorState
  onConnectAsNew: () => void
}): JSX.Element {
  return (
    <ErrorInline
      variant="error"
      title={error.isMismatch ? `Different ${exchangeName} account` : `Couldn't connect ${exchangeName}`}
      message={error.message}
      otherContent={
        error.isMismatch ? (
          <Button type="button" variant="outline" size="sm" mt={1} onClick={onConnectAsNew}>
            Connect as a new account instead
          </Button>
        ) : undefined
      }
    />
  )
}
