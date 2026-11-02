import { Box, Button, Flex, FormControl, FormLabel, Input, Stack } from '@chakra-ui/react'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { HoldingsAdded, HoldingsAdding, afterAtLeastASecond } from '../../../components/claims/holdings-added'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'
import { localDateToIso, todayLocalDate } from '../../../utils/local-date'

export function ClaimsVerifyManualPage(): JSX.Element {
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'

  const [displayName, setDisplayName] = useState('')
  const [btcAmount, setBtcAmount] = useState('')
  const [balanceDate, setBalanceDate] = useState(todayLocalDate)

  const [isSaving, setIsSaving] = useState(false)
  const [added, setAdded] = useState<{ id: string; balance: string | null } | null>(null)

  const createMutation = trpc.portalProve.manual.create.useMutation()
  const utils = trpc.useUtils()

  const isValid = displayName.trim().length > 0 && btcAmount.trim().length > 0 && Number(btcAmount) >= 0

  async function handleSubmit(): Promise<void> {
    if (!isValid) {
      return
    }

    setIsSaving(true)
    try {
      const balanceSats = Math.round(Number(btcAmount) * 1e8).toString()
      const balanceAsOf = localDateToIso(balanceDate)
      const result = await afterAtLeastASecond(
        createMutation.mutateAsync({
          displayName: displayName.trim(),
          balanceSats,
          balanceAsOf,
        }),
      )

      await utils.portalProve.manual.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      setAdded(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create manual account'
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  if (isSaving) {
    return <HoldingsAdding kind="manual" />
  }

  if (added) {
    return <HoldingsAdded kind="manual" account={added} />
  }

  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to={returnTo}>
          Back
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6} maxW="480px" mx="auto">
        <PageHeading
          title="Add Manual Holding"
          description="Track Bitcoin holdings that aren't connected to a wallet or exchange."
        />

        <FormControl>
          <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
            Display Name
          </FormLabel>
          <Input
            placeholder="e.g. Cold Storage, Paper Wallet"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
            }}
          />
        </FormControl>

        <FormControl>
          <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
            Balance (BTC)
          </FormLabel>
          <Input
            type="number"
            step="any"
            min="0"
            placeholder="0.00000000"
            value={btcAmount}
            onChange={(e) => {
              setBtcAmount(e.target.value)
            }}
          />
        </FormControl>

        <FormControl>
          <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
            As of Date
          </FormLabel>
          <Input
            type="date"
            value={balanceDate}
            onChange={(e) => {
              setBalanceDate(e.target.value)
            }}
          />
        </FormControl>

        <Flex justify="flex-end">
          <Button
            colorScheme="blue"
            onClick={() => {
              void handleSubmit()
            }}
            isLoading={createMutation.isLoading}
            isDisabled={!isValid}
          >
            Add Holding
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
