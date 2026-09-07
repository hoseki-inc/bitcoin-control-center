import { Box, Button, Flex, HStack, Spinner, Stack, Text, chakra } from '@chakra-ui/react'
import { Account, type Xpub } from '@hoseki/packages/bitcoin'
import { ErrorBanner } from '@hoseki/packages/ui/design-system'
import {
  CheckCircleFilledIcon,
  StatusBadge,
  TimerCircleFilledIcon,
  XCircleFilledIcon,
  getBadgeConfigForKeystore,
} from '@hoseki/packages/ui/prove-verify-ui'
import { encodingsToLabels, formatUsd, toXpubDisplayValue } from '@hoseki/packages/ui/utils'
import { format } from 'date-fns'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useState } from 'react'
import { useGetClaimBalance } from '../../../lib/balances'
import { getKeystoreStatus } from '../../../lib/multisig/keystore'
import type { ClaimDto } from '../../../trpc/server-types'
import { ensureClaimStatusNotExpired } from '../../../utils/claim-utils'
import { BitcoinAmount } from '../../bitcoin-amount'
import { SensitiveValue } from '../../sensitive-value'
import { WalletImageFromKnownModel } from '../wallet-image-from-known-model'
import { RenameKeystore } from './rename-keystore'

export function KeystoreDetailsSingleSig({
  claim,
  keystore,
}: {
  claim: ClaimDto
  keystore?: ClaimDto['keystores'][number]
}): JSX.Element {
  const { data: balance, isLoading: isBalanceLoading } = useGetClaimBalance(claim.id)

  const account = Account.fromCheckedDescriptor(claim.account)

  if (!keystore) {
    return <ErrorBanner mb={4} message="No keystore found" />
  }

  const claimStatus = ensureClaimStatusNotExpired(claim)

  return (
    <Stack align="center" justify="center" w="640px" mx="auto" mt={-4}>
      <WalletImageFromKnownModel wallet={keystore.wallet} model={keystore.model ?? ''} />

      <HStack spacing={4} mb={8} w="100%" mt={keystore.wallet ? 0 : 8} alignItems="flex-start">
        <Box w={['100%', '50%', '25%']}>
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Amount
          </Text>
          {isBalanceLoading ? (
            <Spinner size="xs" />
          ) : (
            <>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                <SensitiveValue>
                  {balance?.current ? <BitcoinAmount btc={balance.current.div(100_000_000)} /> : 'n/a'}
                </SensitiveValue>
              </Text>
              {balance?.usd && (
                <Text textStyle="label/sm" color="success.600" fontWeight="medium">
                  <SensitiveValue>{formatUsd(balance.usd.toFixed(2))}</SensitiveValue>
                </Text>
              )}
            </>
          )}
        </Box>
        <Box w={['100%', '50%', '25%']}>
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Status
          </Text>
          {claimStatus === 'pending' ? (
            <StatusBadge status="neutral" label={claimStatus} icon={TimerCircleFilledIcon} w="fit-content" />
          ) : claimStatus === 'verified' ? (
            <StatusBadge status="success" label={claimStatus} icon={CheckCircleFilledIcon} w="fit-content" />
          ) : (
            <StatusBadge status="error" label={claimStatus} icon={XCircleFilledIcon} w="fit-content" />
          )}
        </Box>
        <Box w={['100%', '50%', '25%']}>
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Script Type
          </Text>
          <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
            {encodingsToLabels[account.scriptType]}
          </Text>
        </Box>
        <Box w={['100%', '50%', '25%']} textAlign="right">
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Date Added
          </Text>
          <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
            {format(keystore.createdAt, 'MMMM do, yyyy')}
          </Text>
        </Box>
      </HStack>

      <KeystoreXpub xpub={keystore.xpub} />
    </Stack>
  )
}

export function KeystoreDetailsMultiSig({
  claim,
  keystore,
}: {
  claim: ClaimDto
  keystore?: ClaimDto['keystores'][number]
}): JSX.Element {
  const [isRenaming, setIsRenaming] = useState(false)

  const account = Account.fromCheckedDescriptor(claim.account)

  if (!keystore) {
    return <ErrorBanner mb={4} message="No keystore found" />
  }

  const keystoreStatus = getKeystoreStatus(keystore, claim)

  return (
    <Stack w="640px" mx="auto" mt={-4}>
      <WalletImageFromKnownModel wallet={keystore.wallet} model={keystore.model ?? ''} />

      <Text as="h2" textStyle="text/md" fontWeight="medium" alignSelf="flex-start">
        Key Details
      </Text>

      {isRenaming ? (
        <RenameKeystore keystoreId={keystore.id} defaultName={keystore.label} onCancel={() => setIsRenaming(false)} />
      ) : (
        <HStack spacing={8} py={2} justifyContent="space-between">
          <Stack spacing={1} maxWidth="50%">
            <Text textStyle="text/sm" fontWeight="medium">
              Name
            </Text>
            <Text textStyle="label/sm" fontWeight="medium" noOfLines={1} isTruncated>
              {keystore.label}
            </Text>
          </Stack>
          <Box alignSelf="flex-end">
            <Button variant="outline" onClick={() => setIsRenaming(true)}>
              Rename
            </Button>
          </Box>
        </HStack>
      )}

      <Flex direction={['column', 'row', 'row']} gap={4} mb={8} w="100%">
        <Box w="37.5%">
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Status
          </Text>
          <StatusBadge {...getBadgeConfigForKeystore(keystoreStatus)} w="fit-content" />
        </Box>
        <Box w="37.5%">
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Script Type
          </Text>
          <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
            {encodingsToLabels[account.scriptType]}
          </Text>
        </Box>
        <Box w="25%" textAlign={['left', 'right', 'right']}>
          <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
            Date Added
          </Text>
          <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
            {format(keystore.createdAt, 'MMMM do, yyyy')}
          </Text>
        </Box>
      </Flex>

      <KeystoreXpub xpub={keystore.xpub} />
    </Stack>
  )
}

function KeystoreXpub({ xpub }: { xpub: Xpub }) {
  const [isMasked, setIsMasked] = useState(true)

  return (
    <HStack border="1px solid" borderColor="neutral.200" borderRadius="md" p={4} mb={8}>
      <chakra.code color="neutral.600">{toXpubDisplayValue(xpub.toString(), isMasked)}</chakra.code>
      <Button variant="plain" onClick={() => setIsMasked((prev) => !prev)} p={2} pr={0}>
        {isMasked ? <EyeOffIcon color="#475569" /> : <EyeIcon color="#475569" />}
      </Button>
    </HStack>
  )
}
