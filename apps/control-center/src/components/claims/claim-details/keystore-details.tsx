import { Box, Button, Flex, HStack, SimpleGrid, Spinner, Stack, Text, chakra } from '@chakra-ui/react'
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
import { DecodeText, IconSwap } from '../../reveal'
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
    <Stack align="center" justify="center" w="full" maxW="640px" minW={0} mx="auto" mt={-4}>
      <WalletImageFromKnownModel wallet={keystore.wallet} model={keystore.model ?? ''} />

      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4} mb={8} w="full" mt={keystore.wallet ? 0 : 8}>
        <Box minW={0}>
          <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
            Amount
          </Text>
          {isBalanceLoading ? (
            <Spinner size="xs" />
          ) : (
            <>
              <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
                <SensitiveValue>
                  {balance?.current ? <BitcoinAmount btc={balance.current.div(100_000_000)} /> : 'n/a'}
                </SensitiveValue>
              </Text>
              {balance?.usd && (
                <Text textStyle="label/sm" color="status.success.fg" fontWeight="medium">
                  <SensitiveValue>{formatUsd(balance.usd.toFixed(2))}</SensitiveValue>
                </Text>
              )}
            </>
          )}
        </Box>
        <Box minW={0}>
          <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
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
        <Box minW={0}>
          <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
            Script Type
          </Text>
          <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
            {encodingsToLabels[account.scriptType]}
          </Text>
        </Box>
        <Box minW={0} textAlign={{ base: 'left', md: 'right' }}>
          <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
            Date Added
          </Text>
          <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
            {format(keystore.createdAt, 'MMMM do, yyyy')}
          </Text>
        </Box>
      </SimpleGrid>

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
    <Stack w="full" maxW="640px" minW={0} mx="auto" mt={-4}>
      <WalletImageFromKnownModel wallet={keystore.wallet} model={keystore.model ?? ''} />

      <Text as="h2" textStyle="text/md" fontWeight="medium" alignSelf="flex-start">
        Key Details
      </Text>

      {isRenaming ? (
        <RenameKeystore
          keystoreId={keystore.id}
          defaultName={keystore.label}
          onCancel={() => {
            setIsRenaming(false)
          }}
        />
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
            <Button
              variant="outline"
              onClick={() => {
                setIsRenaming(true)
              }}
            >
              Rename
            </Button>
          </Box>
        </HStack>
      )}

      <Flex direction={['column', 'row', 'row']} gap={4} mb={8} w="100%">
        <Box w={{ base: 'full', sm: '37.5%' }}>
          <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
            Status
          </Text>
          <StatusBadge {...getBadgeConfigForKeystore(keystoreStatus)} w="fit-content" />
        </Box>
        <Box w={{ base: 'full', sm: '37.5%' }}>
          <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
            Script Type
          </Text>
          <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
            {encodingsToLabels[account.scriptType]}
          </Text>
        </Box>
        <Box w={{ base: 'full', sm: '25%' }} textAlign={['left', 'right', 'right']}>
          <Text textStyle="text/sm" color="text.secondary" fontWeight="medium" mb={1}>
            Date Added
          </Text>
          <Text textStyle="label/sm" color="text.primary" fontWeight="medium">
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
    <HStack w="full" minW={0} border="1px solid" borderColor="border.subtle" borderRadius="control" p={3} mb={8}>
      <chakra.code
        color="text.secondary"
        textStyle="text/sm"
        fontFamily="mono"
        minW={0}
        flex={1}
        overflowWrap="anywhere"
      >
        <DecodeText text={toXpubDisplayValue(xpub.toString(), isMasked)} revealKey={isMasked ? 'masked' : 'shown'} />
      </chakra.code>
      <Button
        variant="ghost"
        aria-label={isMasked ? 'Show extended public key' : 'Hide extended public key'}
        aria-pressed={!isMasked}
        onClick={() => {
          setIsMasked((prev) => !prev)
        }}
        p={2}
        flexShrink={0}
      >
        <IconSwap swapKey={isMasked ? 'masked' : 'shown'}>
          {isMasked ? (
            <EyeOffIcon color="var(--hoseki-colors-text-secondary)" />
          ) : (
            <EyeIcon color="var(--hoseki-colors-text-secondary)" />
          )}
        </IconSwap>
      </Button>
    </HStack>
  )
}
