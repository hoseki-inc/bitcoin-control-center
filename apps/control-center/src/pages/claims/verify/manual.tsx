import { Box, Button, Flex, FormControl, FormLabel, Input, Stack } from '@chakra-ui/react'
import { DateStringInput } from '@hoseki/packages/ui/design-system/forms/date-string-input'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { trpc } from '../../../trpc'

export function ClaimsVerifyManualPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/accounts'

  const [displayName, setDisplayName] = useState('')
  const [btcAmount, setBtcAmount] = useState('')
  const [balanceDate, setBalanceDate] = useState(() => new Date().toISOString().slice(0, 10))

  const createMutation = trpc.portalProve.manual.create.useMutation()
  const utils = trpc.useUtils()

  const isValid = displayName.trim().length > 0 && btcAmount.trim().length > 0 && Number(btcAmount) >= 0

  async function handleSubmit(): Promise<void> {
    if (!isValid) return

    const balanceSats = Math.round(Number(btcAmount) * 1e8).toString()
    const balanceAsOf = new Date(balanceDate).toISOString()

    try {
      const result = await createMutation.mutateAsync({
        displayName: displayName.trim(),
        balanceSats,
        balanceAsOf,
      })

      await utils.portalProve.manual.list.invalidate()
      await utils.portalProve.controlCenter.invalidate()
      toast.success('Manual account created')
      navigate(`/accounts/manual/${result.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create manual account'
      toast.error(message)
    }
  }

  return (
    <Box py={{ base: 6, md: 8 }} maxW="640px" mx="auto" w="full">
      <TopBar mb={8}>
        <TopBar.Back as={Link} to={returnTo}>
          Back
        </TopBar.Back>
      </TopBar>

      <Stack spacing={6}>
        <PageHeading
          title="Add Manual Holding"
          description="Track Bitcoin holdings that aren't connected to a wallet or exchange."
        />

        <FormControl>
          <FormLabel textStyle="text/sm" color="text.secondary" fontWeight="medium">
            Display name
          </FormLabel>
          <Input
            fontFamily="body"
            placeholder="e.g. Cold Storage, Paper Wallet"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormControl>

        <FormControl>
          <FormLabel textStyle="text/sm" color="text.secondary" fontWeight="medium">
            Balance (BTC)
          </FormLabel>
          <Input
            fontFamily="body"
            type="number"
            step="any"
            min="0"
            placeholder="0.00000000"
            value={btcAmount}
            onChange={(e) => setBtcAmount(e.target.value)}
          />
        </FormControl>

        <FormControl>
          <FormLabel textStyle="text/sm" color="text.secondary" fontWeight="medium">
            As of date
          </FormLabel>
          <DateStringInput isRequired fontFamily="body" value={balanceDate} onChange={(date) => setBalanceDate(date)} />
        </FormControl>

        <Flex justify="flex-end" pt={2}>
          <Button onClick={handleSubmit} isLoading={createMutation.isLoading} isDisabled={!isValid}>
            Add Holding
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
