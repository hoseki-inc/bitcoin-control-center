import { Box, HStack, type StackProps, Text } from '@chakra-ui/react'
import {
  type Keystore as IndicatorKeystore,
  KeystoresStatusIndicator,
} from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import { createSearchParams, matchPath, useLocation, useNavigate } from 'react-router'
import { LinkIfNotCurrent } from '../../lib/routing'
import type { ClaimDto } from '../../trpc/server-types'
import { getThreshold } from '../../utils/multisig-utils'

export function MultisigHeader({
  claim,
  indicatorKeystores,
  expandedKeystoreId,
  ...props
}: {
  claim: ClaimDto
  indicatorKeystores: IndicatorKeystore[]
  expandedKeystoreId: string | null
} & StackProps): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const threshold = getThreshold(claim.account)

  /**
   * Returns `null` or the handler function for the keystore click.
   */
  function getKeystoreClickHandler(
    keystore: IndicatorKeystore,
    index: number,
    allKeystores: IndicatorKeystore[],
  ): null | ((keystore: IndicatorKeystore) => void) {
    function navigateToHubWithKeystoreIdSearch(selectedKeystore: IndicatorKeystore) {
      return navigate({
        pathname: `/multisig/${claim.id}`,
        search: `?${createSearchParams({
          keystoreId: selectedKeystore.id,
        })}`,
      })
    }

    function navigateToKeystoreSigning(selectedKeystore: IndicatorKeystore) {
      void navigate(`/multisig/${claim.id}/signing/${selectedKeystore.wallet}/${selectedKeystore.id}`)
    }

    // We currently don't have a screen for verified keystores, so we don't allow the user to click on them.
    if (keystore.status === 'verified') {
      return null
    }
    // Prevents the user from losing work in progress by unintentionally leaving a wallet flow
    if (!isUserOnMultisigDetailsPage(location.pathname)) {
      return null
    }

    if (keystore.status === 'pending') {
      // There is no point on letting the user click on the current pending keystore if there is a pending keystore before it.
      const isThereAPendingKeystoreBeforeMe = allKeystores.slice(0, index).some((k) => k.status === 'pending')
      return isThereAPendingKeystoreBeforeMe ? null : navigateToHubWithKeystoreIdSearch
    }

    if (allKeystores.every((k) => k.status !== 'pending')) {
      return navigateToHubWithKeystoreIdSearch
    }
    if (keystore.status === 'identified' && isUserOnMultisigDetailsPage(location.pathname)) {
      return navigateToHubWithKeystoreIdSearch
    }

    return navigateToKeystoreSigning
  }

  const searchParams = expandedKeystoreId
    ? `?${createSearchParams({
        keystoreId: expandedKeystoreId,
      })}`
    : ''

  return (
    <HStack spacing={8} borderBottom="1px solid" borderColor="neutral.200" pb={2} {...props}>
      <Box
        as={LinkIfNotCurrent}
        to={`/multisig/${claim.id}${searchParams}`}
        maxWidth="40%"
        _hover={{ '&[href] .wallet-label': { textDecoration: 'underline' } }}
      >
        <Text
          as="h1"
          textStyle="text/md"
          color="neutral.900"
          fontWeight="medium"
          className="wallet-label"
          noOfLines={1}
          isTruncated
        >
          {claim.displayName}
        </Text>
        <Text textStyle="text/sm" color="neutral.600">
          {threshold} of {claim.keystores.length} multisig wallet
        </Text>
      </Box>

      <HStack spacing={1} overflowX="auto" overflowY="hidden" flexGrow={1}>
        <KeystoresStatusIndicator
          keystores={indicatorKeystores}
          expandedKeystoreId={expandedKeystoreId}
          getKeystoreClickHandler={getKeystoreClickHandler}
          threshold={threshold}
          tooltipVariant={isUserOnMultisigDetailsPage(location.pathname) ? 'pending' : 'none'}
        />
      </HStack>
    </HStack>
  )
}

export function isUserOnMultisigDetailsPage(pathname: string): boolean {
  return Boolean(matchPath({ path: '/multisig/:id', end: true }, pathname))
}
