import { Link, Text } from '@chakra-ui/react'
import { createContext, useContext, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { toast } from 'sonner'
import { trpc } from '../trpc'
import type { StatementDto } from '../trpc/server-types'

const StatementPollingContext = createContext<{
  startPolling: (statementId: StatementDto['id']) => void
  isPolling: boolean
  statement: StatementDto | null
} | null>(null)

export function StatementPollingProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const trpcUtils = trpc.useUtils()
  const [idToPoll, setIdToPoll] = useState<StatementDto['id'] | null>(null)
  const [shouldPoll, setShouldPoll] = useState<boolean>(false)

  const { data: retrievedStatement, isSuccess } = trpc.portalProve.statement.retrieve.useQuery(idToPoll ?? '', {
    enabled: shouldPoll,
    refetchInterval: 500,
  })

  useEffect(() => {
    if (isSuccess && shouldPoll && retrievedStatement.status !== 'pending') {
      // Invalidate the statements list to show the new statement
      trpcUtils.portalProve.statement.list.invalidate(undefined, undefined, { throwOnError: true }).catch(() => {
        toast.error('Unable to refresh the statements list. Please reload the page.')
      })

      if (retrievedStatement.status === 'completed') {
        toast.success('Your statement is ready!', {
          duration: 7000,
          description: (
            <>
              <Text>
                Check your{' '}
                <Link as={RouterLink} to="/statements" textDecoration="underline">
                  list of statements
                </Link>{' '}
                on the statements page.
              </Text>
            </>
          ),
        })
      }

      if (retrievedStatement.status === 'failed') {
        toast.error('Failed to generate statement', {
          description: retrievedStatement.errorMessage ?? 'We are working to resolve this issue.',
        })
      }

      setShouldPoll(false)
    }
  }, [isSuccess, retrievedStatement, shouldPoll, setShouldPoll, trpcUtils.portalProve.statement.list])

  return (
    <StatementPollingContext.Provider
      value={{
        startPolling: (statementId) => {
          setIdToPoll(statementId)
          setShouldPoll(true)
        },
        isPolling: shouldPoll,
        statement: retrievedStatement ?? null,
      }}
    >
      {children}
    </StatementPollingContext.Provider>
  )
}

interface UseStatementPollingReturn {
  startPolling: (statementId: StatementDto['id']) => void
  isPolling: boolean
  statement: StatementDto | null
}

export function useStatementPolling(): UseStatementPollingReturn {
  const context = useContext(StatementPollingContext)
  if (!context) {
    throw new Error('useStatementPolling must be used within a StatementPollingProvider')
  }
  return context
}
