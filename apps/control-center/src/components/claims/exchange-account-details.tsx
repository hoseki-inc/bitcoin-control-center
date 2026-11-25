import { Box, Button, HStack, SimpleGrid, Stack, Text, Tooltip, chakra, useDisclosure } from '@chakra-ui/react'
import { CheckCircleFilledIcon, StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { format } from 'date-fns'
import { InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { RemoveAccountModal } from './remove-account-modal'

export interface ExchangeAccountDetailsProps {
  exchangeName: 'Coinbase' | 'Kraken' | 'Robinhood' | 'Strike'
  logoSrc: string
  displayName: string
  balance: string | null
  createdAt: string
  needsReconnect: boolean
  isRefreshing: boolean
  isDeleting: boolean
  onReconnect: () => void
  onRefresh: () => void
  onDelete: () => void
  children?: ReactNode
}

const EXPIRED_BALANCE_TOOLTIP = 'Reconnect your account to view your balance.'

export function ExchangeAccountDetails({
  exchangeName,
  logoSrc,
  displayName,
  balance,
  createdAt,
  needsReconnect,
  isRefreshing,
  isDeleting,
  onReconnect,
  onRefresh,
  onDelete,
  children,
}: ExchangeAccountDetailsProps): JSX.Element {
  const removeConfirm = useDisclosure()
  const btcSats = balance != null && balance !== '' ? Number(balance) : 0
  const btcAmount = (btcSats / 100_000_000).toFixed(8)
  const createdDate = new Date(createdAt)
  const removeDescription =
    exchangeName === 'Strike'
      ? 'This Strike account will be removed from all your charts and totals, and its balance history and imported statements will be deleted.'
      : `This ${exchangeName} account will be removed from all your charts and totals, and its balance history will be deleted.`

  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Item>
        <TopBar.Item as="button" color="error.600" onClick={removeConfirm.onOpen}>
          Remove Account
        </TopBar.Item>
      </TopBar>

      <RemoveAccountModal
        isOpen={removeConfirm.isOpen}
        onClose={removeConfirm.onClose}
        accountName={displayName}
        description={removeDescription}
        isDeleting={isDeleting}
        onConfirm={onDelete}
      />

      <Stack spacing={4}>
        <Box>
          <Text textStyle="text/md" fontWeight="medium">
            {displayName}
          </Text>
          <HStack spacing={1}>
            <Box w={2} h={2} bg={needsReconnect ? 'warning.600' : 'success.600'} borderRadius="full" />
            <Text textStyle="text/xs" color="neutral.600">
              First Connected
            </Text>
            <Text textStyle="text/xs" color="neutral.900" fontWeight="medium">
              {format(createdDate, 'MMMM do, yyyy')}
            </Text>
          </HStack>
        </Box>

        <hr />

        <Stack align="center" justify="center" maxW="640px" w="100%" mx="auto" mt={-4} spacing={0}>
          <Box
            mx="auto"
            pt={10}
            pb={6}
            sx={{
              animation: 'float 4s ease-in-out infinite',
              '@keyframes float': {
                '0%': { transform: 'translateY(0)' },
                '50%': { transform: 'translateY(-6px)' },
                '100%': { transform: 'translateY(0)' },
              },
            }}
          >
            <chakra.img
              src={logoSrc}
              alt={exchangeName}
              h="100px"
              display="block"
              opacity={needsReconnect ? 0.55 : 1}
              filter={needsReconnect ? 'grayscale(1)' : 'drop-shadow(-4px 6px 10px rgba(0, 0, 0, 0.2))'}
            />
          </Box>

          {needsReconnect ? (
            <Stack align="center" spacing={4} mb={7}>
              <Text textStyle="text/md" fontWeight="semibold" color="neutral.900">
                {`${exchangeName} connection expired`}
              </Text>
              <Button size="sm" onClick={onReconnect}>
                Reconnect Account
              </Button>
            </Stack>
          ) : null}

          <SimpleGrid
            columns={[2, 4]}
            spacing={4}
            w="100%"
            textAlign="center"
            borderTop={needsReconnect ? '1px solid' : undefined}
            borderColor={needsReconnect ? 'neutral.200' : undefined}
            pt={needsReconnect ? 6 : 2}
          >
            <Box>
              <HStack spacing={1} justify="center" mb={1}>
                <Text textStyle="text/sm" color="neutral.600" fontWeight="medium">
                  Amount
                </Text>
                {needsReconnect ? (
                  <Tooltip label={EXPIRED_BALANCE_TOOLTIP} placement="bottom" hasArrow>
                    <Box
                      as="button"
                      type="button"
                      aria-label={EXPIRED_BALANCE_TOOLTIP}
                      display="inline-flex"
                      alignItems="center"
                      color="neutral.500"
                      cursor="help"
                      _hover={{ color: 'neutral.900' }}
                    >
                      <InfoIcon size={14} aria-hidden="true" />
                    </Box>
                  </Tooltip>
                ) : null}
              </HStack>
              {balance === null ? (
                <Text textStyle="label/sm" color="neutral.400" fontWeight="medium">
                  —
                </Text>
              ) : (
                <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                  {btcAmount} BTC
                </Text>
              )}
            </Box>

            <Box>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Status
              </Text>
              {needsReconnect ? (
                <StatusBadge status="warning" label="Expired" w="fit-content" mx="auto" />
              ) : (
                <StatusBadge
                  status="success"
                  label="Connected"
                  icon={CheckCircleFilledIcon}
                  w="fit-content"
                  mx="auto"
                />
              )}
            </Box>

            <Box>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Account Type
              </Text>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                Custodial
              </Text>
            </Box>

            <Box>
              <Text textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={1}>
                Date Added
              </Text>
              <Text textStyle="label/sm" color="neutral.900" fontWeight="medium">
                {format(createdDate, 'MMM d, yyyy')}
              </Text>
            </Box>
          </SimpleGrid>

          {!needsReconnect ? (
            <Box mt={6}>
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                isLoading={isRefreshing}
                loadingText="Refreshing..."
              >
                Refresh Balance
              </Button>
            </Box>
          ) : null}
        </Stack>
        {children}
      </Stack>
    </Box>
  )
}
