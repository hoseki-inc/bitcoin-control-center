import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ExchangeAccountDetails } from '../../../components/claims/exchange-account-details'
import { AccountDetailsSkeleton } from '../../../components/loading/page-skeletons'
import { trpc } from '../../../trpc'
import { needsExchangeReconnect } from '../../../utils/exchange-connection-status'

export function KrakenAccountDetailsPage(): JSX.Element {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const listQuery = trpc.portalProve.exchanges.kraken.list.useQuery()
  const refreshMutation = trpc.portalProve.exchanges.refreshBalance.useMutation()
  const deleteMutation = trpc.portalProve.exchanges.delete.useMutation()

  if (listQuery.isLoading) {
    return <AccountDetailsSkeleton />
  }

  const account = listQuery.data?.find((a) => a.id === accountId)

  if (!account) {
    return <ErrorBanner mt={8} mb={4} message="Kraken account not found." />
  }

  const needsReconnect = needsExchangeReconnect(account)

  function handleReconnect(): void {
    if (accountId == null || accountId === '') {
      return
    }
    void navigate('/accounts/verify/kraken', {
      state: { returnTo: `/accounts/kraken/${accountId}`, replaceAccountId: accountId },
    })
  }

  async function handleRefresh(): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    setIsRefreshing(true)
    try {
      await refreshMutation.mutateAsync({ accountId })
      await utils.portalProve.exchanges.kraken.list.invalidate()
      await utils.portalProve.exchanges.list.invalidate()
      await utils.portalProve.portfolio.invalidate()
      toast.success('Balance refreshed')
    } catch (err) {
      await utils.portalProve.exchanges.kraken.list.invalidate()
      await utils.portalProve.exchanges.list.invalidate()
      await utils.portalProve.portfolio.invalidate()
      const message = err instanceof Error ? err.message : 'Failed to refresh balance'
      toast.error(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (accountId == null || accountId === '') {
      return
    }
    setIsDeleting(true)
    try {
      await deleteMutation.mutateAsync({ accountId })
      await utils.portalProve.exchanges.kraken.list.invalidate()
      await utils.portalProve.exchanges.list.invalidate()
      await utils.portalProve.portfolio.invalidate()
      void navigate('/accounts')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove account'
      toast.error(message)
      setIsDeleting(false)
    }
  }

  return (
    <ExchangeAccountDetails
      exchangeName="Kraken"
      logoSrc="/images/exchanges/kraken.svg"
      displayName={account.displayName}
      balance={account.balance}
      createdAt={account.createdAt}
      needsReconnect={needsReconnect}
      isRefreshing={isRefreshing}
      isDeleting={isDeleting}
      onReconnect={handleReconnect}
      onRefresh={() => {
        void handleRefresh()
      }}
      onDelete={() => {
        void handleDelete()
      }}
    />
  )
}
