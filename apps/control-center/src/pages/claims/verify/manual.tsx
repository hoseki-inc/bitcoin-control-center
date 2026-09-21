import { Box, Button, Flex, FormControl, FormLabel, Heading, Input, Stack, Text } from '@chakra-ui/react'
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
    if (!isValid) {
      return
    }

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
      void navigate(`/accounts/manual/${result.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create manual account'
      toast.error(message)
    }
  }

  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to={returnTo}>
          Back
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6} maxW="480px" mx="auto">
        <Box>
          <Heading textStyle="text/2xl" fontWeight="bold" color="neutral.900" mb={2}>
            Add Manual Holding
          </Heading>
          <Text textStyle="text/md" color="neutral.400">
            Track Bitcoin holdings that aren&apos;t connected to a wallet or exchange.
          </Text>
        </Box>

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
          <Button colorScheme="blue" onClick={handleSubmit} isLoading={createMutation.isLoading} isDisabled={!isValid}>
            Add Holding
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
