import { Box, Button, Flex, HStack, Stack, Text } from '@chakra-ui/react'
import { Account, MultiSigAccount } from '@hoseki/packages/bitcoin'
import { Alert } from '@hoseki/packages/ui/design-system'
import { type Keystore as IndicatorKeystore, KeystoresStatusIndicator } from '@hoseki/packages/ui/prove-verify-ui'
import { WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { format } from 'date-fns'
import { useState } from 'react'
import { Link, Navigate, createSearchParams, useNavigate, useSearchParams } from 'react-router'
import type { ClaimDto } from '../../../trpc/server-types'
import { ensureClaimStatusNotExpired, isBitkeyClaim } from '../../../utils/claim-utils'
import { getThreshold } from '../../../utils/multisig-utils'
import { getIndicatorKeystores } from '../../multisig/multisig-page-wrapper'
import { BitkeyClaimProperties } from '../bitkey/bitkey-claim-properties'
import { ClaimTopBar } from '../claim-top-bar'
import { ResumeSinglesigFlow } from '../resume-flow'
import { AbandonClaimButton } from './delete-claim-modal'
import { KeystoreDetailsMultiSig, KeystoreDetailsSingleSig } from './keystore-details'
import { MultisigClaimProperties } from './multisig-claim-properties'
import { RenameClaim } from './rename-claim'

export function ClaimDetails({ claim }: { claim: ClaimDto }): JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isRenaming, setIsRenaming] = useState(false)

  const selectedKeystoreId = searchParams.get('keystoreId')

  const account = Account.fromCheckedDescriptor(claim.account)
  const isMultisig = account instanceof MultiSigAccount

  const claimStatus = ensureClaimStatusNotExpired(claim)

  if (claim.isArchived) {
    return <Navigate to="/accounts#archived" replace />
  }

  return (
    <Box py={6}>
      <ClaimTopBar claim={claim} mb={6} />
      <Stack spacing={4}>
        {isRenaming ? (
          <RenameClaim
            claimId={claim.id}
            defaultName={claim.displayName}
            onCancel={() => {
              setIsRenaming(false)
            }}
          />
        ) : (
          <Flex direction={['column', 'column', 'row']} gap={8} py={2}>
            <Box maxWidth={['100%', '100%', '30%']}>
              <Text
                as={Link}
                to={`/accounts/${claim.id}`}
                textStyle="text/md"
                fontWeight="medium"
                noOfLines={1}
                isTruncated
                _hover={{ textDecoration: 'underline' }}
              >
                {claim.displayName}
              </Text>
              <HStack spacing={1}>
                <StatusDot status={claimStatus} />
                <Text textStyle="text/xs" color="neutral.600">
                  First Connected
                </Text>
                <Text textStyle="text/xs" color="neutral.900" fontWeight="medium">
                  {format(claim.createdAt, 'MMMM do, yyyy')}
                </Text>
              </HStack>
            </Box>
            {/* Bitkey's keys are listed below; they can't be verified one by one. */}
            {isBitkeyClaim(claim) ? (
              <Box flexGrow={1} />
            ) : (
              <HStack spacing={1} overflowX="auto" overflowY="hidden" flexGrow={1}>
                <KeystoresStatusIndicator
                  keystores={getIndicatorKeystores(claim)}
                  expandedKeystoreId={selectedKeystoreId ?? null}
                  expandedRingColor="green"
                  threshold={getThreshold(claim.account)}
                  tooltipVariant="none"
                  getKeystoreClickHandler={(keystore) => {
                    // SingleSig are not clickable
                    if (!isMultisig || keystore.status === 'pending') {
                      return null
                    }

                    return (selectedKeystore: IndicatorKeystore) => {
                      void navigate({
                        pathname: `/accounts/${claim.id}`,
                        search: `?${createSearchParams({ keystoreId: selectedKeystore.id })}`,
                      })
                    }
                  }}
                />
              </HStack>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setIsRenaming(true)
              }}
              w="fit-content"
            >
              Rename
            </Button>
          </Flex>
        )}
        <hr />
        <ClaimDetailsBody claim={claim} isMultisig={isMultisig} selectedKeystoreId={selectedKeystoreId} />
      </Stack>
    </Box>
  )
}

function ClaimDetailsBody({
  claim,
  isMultisig,
  selectedKeystoreId,
}: {
  claim: ClaimDto
  isMultisig: boolean
  selectedKeystoreId: string | null
}) {
  const navigate = useNavigate()
  const singleKeystore = claim.keystores[0]
  const canAbandon = claim.status === 'pending'
  if (!singleKeystore) {
    return <Alert status="error">No keystore found</Alert>
  }

  if (!isMultisig && !claim.isVerified) {
    return (
      <>
        <ResumeSinglesigFlow wallet={singleKeystore.wallet} model={singleKeystore.model} />
        <WizardFooter
          rightButton={
            <HStack>
              {canAbandon && <AbandonClaimButton claim={claim} />}
              <Button
                onClick={() => {
                  void navigate(`./signing`, { relative: 'path' })
                }}
              >
                Continue
              </Button>
            </HStack>
          }
        />
      </>
    )
  }

  return (
    <>
      {isBitkeyClaim(claim) ? (
        <BitkeyClaimProperties claim={claim} />
      ) : !isMultisig ? (
        <KeystoreDetailsSingleSig claim={claim} keystore={claim.keystores[0]} />
      ) : selectedKeystoreId != null && selectedKeystoreId !== '' ? (
        <KeystoreDetailsMultiSig claim={claim} keystore={claim.keystores.find((k) => k.id === selectedKeystoreId)} />
      ) : (
        <MultisigClaimProperties claim={claim} />
      )}
    </>
  )
}

function StatusDot({ status }: { status: ClaimDto['status'] }) {
  let color = ''
  switch (status) {
    case 'pending':
      color = 'warning.600'
      break
    case 'expired':
      color = 'error.600'
      break
    case 'verified':
      color = 'success.600'
      break
    case 'unverified':
      color = 'neutral.400'
      break
  }
  return <Box w={2} h={2} bg={color} borderRadius="full" />
}
