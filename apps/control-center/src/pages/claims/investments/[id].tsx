import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Stack,
  Text,
  Tooltip,
} from '@chakra-ui/react'
import { ErrorBanner, SkeletonRegion, TextSkeleton } from '@hoseki/packages/ui/design-system'
import { StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { InvestmentIcon } from '../../../components/claims/account-type-media'
import { HistoryLineChart } from '../../../components/dashboard-charts/history-line-chart'
import { DashboardCardTitle } from '../../../components/dashboard/dashboard-typography'
import { FiatAmountText } from '../../../components/fiat-amount-text'
import { type ValuationFields, ValuationForm } from '../../../components/investments/valuation-form'
import { formatInvestmentValue, formatValuationDate } from '../../../components/investments/value'
import { trpc } from '../../../trpc'

type Editing = ValuationFields & { id: string }
type Deletion = { kind: 'account' } | { kind: 'valuation'; id: string; valuedAt: string }

/** A different account gets fresh form and confirmation state, even during client-side navigation. */
export function InvestmentDetailsPage(): JSX.Element {
  const { accountId = '' } = useParams()
  return <InvestmentAccountDetails key={accountId} accountId={accountId} />
}

function InvestmentAccountDetails({ accountId }: { accountId: string }): JSX.Element {
  const query = trpc.portalProve.investments.get.useQuery({ accountId })
  const saveMutation = trpc.portalProve.investments.saveValuation.useMutation()
  const deleteValuation = trpc.portalProve.investments.deleteValuation.useMutation()
  const deleteAccount = trpc.portalProve.investments.delete.useMutation()
  const rename = trpc.portalProve.investments.rename.useMutation()
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [newName, setNewName] = useState<string | null>(null)
  const [deletion, setDeletion] = useState<Deletion | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [query.data?.id])

  async function refresh(): Promise<void> {
    await Promise.all([
      utils.portalProve.investments.list.invalidate(),
      utils.portalProve.investments.get.invalidate({ accountId }),
    ])
  }
  async function perform(action: () => Promise<void>, failure: string): Promise<void> {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure)
    } finally {
      setBusy(false)
    }
  }
  async function save(fields: ValuationFields): Promise<void> {
    await perform(async () => {
      await saveMutation.mutateAsync({ ...fields, accountId, id: editing?.id })
      await refresh()
      setEditing(null)
      setFormKey((key) => key + 1)
      toast.success('Valuation saved')
    }, 'Could not save valuation')
  }
  async function remove(): Promise<void> {
    if (deletion === null) {
      return
    }
    const target = deletion
    await perform(async () => {
      if (target.kind === 'account') {
        await deleteAccount.mutateAsync({ accountId })
        void navigate('/accounts')
        await utils.portalProve.investments.list.invalidate()
        toast.success('Investment account removed')
      } else {
        await deleteValuation.mutateAsync({ accountId, id: target.id })
        await refresh()
        if (editing?.id === target.id) {
          setEditing(null)
        }
        toast.success('Valuation removed')
      }
      setDeletion(null)
    }, 'Could not remove investment data')
  }
  async function saveName(): Promise<void> {
    if (newName === null || newName.trim() === '') {
      return
    }
    await perform(async () => {
      await rename.mutateAsync({ accountId, displayName: newName.trim() })
      await refresh()
      setNewName(null)
    }, 'Could not rename account')
  }

  if (query.isLoading) {
    return (
      <SkeletonRegion label="Loading investment account" py={8}>
        <Stack spacing={6}>
          <TextSkeleton width="24ch" />
          <TextSkeleton width="18ch" />
        </Stack>
      </SkeletonRegion>
    )
  }
  if (!query.data) {
    return (
      <Stack py={8}>
        <ErrorBanner message={query.error.message} />
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch()
          }}
        >
          Retry
        </Button>
        <Button as={Link} to="/accounts" variant="ghost">
          Back to Accounts
        </Button>
      </Stack>
    )
  }
  const account = query.data
  return (
    <Box py={6}>
      <TopBar mb={6} align="center" gap={3} flexWrap="wrap">
        <TopBar.Item as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Item>
        <HStack spacing={4}>
          <TopBar.Item
            as="button"
            disabled={busy}
            onClick={() => {
              setNewName(account.displayName)
            }}
          >
            Rename
          </TopBar.Item>
          <TopBar.Item
            as="button"
            color="error.600"
            disabled={busy}
            onClick={() => {
              setDeletion({ kind: 'account' })
            }}
          >
            Remove Account
          </TopBar.Item>
        </HStack>
      </TopBar>
      <Stack spacing={6}>
        <HStack spacing={3} align="flex-start">
          <Box mt={1}>
            <InvestmentIcon boxSize={7} />
          </Box>
          <Box minW={0}>
            <Text
              ref={headingRef}
              tabIndex={-1}
              as="h1"
              sx={{ outline: 'none' }}
              textStyle="text/lg"
              fontWeight="medium"
              overflowWrap="anywhere"
            >
              {account.displayName}
            </Text>
            <HStack spacing={2} mt={1} flexWrap="wrap">
              <Text textStyle="text/xs" color="neutral.600">
                Other Bitcoin Investments
              </Text>
              <StatusBadge status="neutral" label="Manually updated" size="sm" />
            </HStack>
          </Box>
        </HStack>
        {query.isError && (
          <ErrorBanner message="Could not refresh this account. Showing the last available valuations." />
        )}
        <Stack maxW="640px" mx="auto" w="full" spacing={6}>
          <Grid
            templateColumns={{ base: '1fr', sm: '1fr 1fr' }}
            gap={4}
            borderTop="1px solid"
            borderBottom="1px solid"
            borderColor="neutral.200"
            py={5}
          >
            <Box minW={0}>
              <Text textStyle="text/sm" color="neutral.600">
                Latest Reported Value
              </Text>
              <FiatAmountText color="neutral.900" mt={1}>
                {formatInvestmentValue(account.valueCents)}
                <Text as="span" textStyle="text/sm" color="neutral.500" ml={1}>
                  {' '}
                  USD
                </Text>
              </FiatAmountText>
            </Box>
            <Box textAlign={{ base: 'left', sm: 'right' }}>
              <Text textStyle="text/sm" color="neutral.600">
                As of Date
              </Text>
              <Text textStyle="text/md" fontWeight="medium" mt={2}>
                {formatValuationDate(account.valuedAt)}
              </Text>
            </Box>
          </Grid>
          <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 4, md: 6 }}>
            <Box mb={4}>
              <DashboardCardTitle>{editing ? 'Edit Valuation' : 'Update Value'}</DashboardCardTitle>
              <Text textStyle="text/sm" color="neutral.600" mt={1}>
                Record the total USD value of this account on a specific date.
              </Text>
            </Box>
            <ValuationForm
              key={editing?.id ?? formKey}
              initial={editing ?? undefined}
              saving={busy}
              onSave={save}
              onCancel={
                editing
                  ? () => {
                      setEditing(null)
                    }
                  : undefined
              }
            />
          </Box>
          <Box>
            <DashboardCardTitle>Valuation History</DashboardCardTitle>
            <Text textStyle="text/sm" color="neutral.600" mt={1} mb={4}>
              Changes may include money added or withdrawn. They do not measure investment returns.
            </Text>
            {account.valuations.length > 1 ? (
              <Box h="240px" as="figure" aria-label="Reported investment valuations in USD" mb={4}>
                <HistoryLineChart
                  data={[...account.valuations].reverse().map((valuation) => ({
                    time: new Date(`${valuation.valuedAt}T12:00:00Z`).getTime(),
                    value: Number(valuation.valueCents) / 100,
                  }))}
                  showPoints
                  ticks={[...account.valuations]
                    .reverse()
                    .map((valuation) => new Date(`${valuation.valuedAt}T12:00:00Z`).getTime())}
                  formatValue={(value) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  formatTime={(time) => formatValuationDate(new Date(time).toISOString().slice(0, 10))}
                />
              </Box>
            ) : (
              <Box p={4} mb={4} bg="neutral.50" borderRadius="control">
                <Text textStyle="text/sm" color="neutral.600">
                  Your first valuation is saved. Add another date to see a chart.
                </Text>
              </Box>
            )}
            <Stack spacing={0}>
              {account.valuations.map((valuation) => (
                <Flex
                  key={valuation.id}
                  py={4}
                  borderBottom="1px solid"
                  borderColor="neutral.200"
                  justify="space-between"
                  align="flex-start"
                  gap={3}
                  flexWrap="wrap"
                >
                  <Box flex="1" minW="180px">
                    <Text textStyle="text/sm" color="neutral.600">
                      {formatValuationDate(valuation.valuedAt)}
                    </Text>
                    <Text textStyle="text/md" fontWeight="medium" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatInvestmentValue(valuation.valueCents)}
                    </Text>
                    {valuation.note !== null && valuation.note !== '' && (
                      <Text
                        textStyle="text/sm"
                        color="neutral.600"
                        mt={1}
                        whiteSpace="pre-wrap"
                        overflowWrap="anywhere"
                      >
                        {valuation.note}
                      </Text>
                    )}
                  </Box>
                  <HStack spacing={1}>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Edit valuation for ${valuation.valuedAt}`}
                      isDisabled={busy}
                      onClick={() => {
                        setEditing({ ...valuation, note: valuation.note ?? undefined })
                      }}
                    >
                      Edit
                    </Button>
                    <Tooltip
                      label="Keep at least one valuation. You can edit it or remove the account."
                      isDisabled={account.valuations.length > 1}
                      hasArrow
                    >
                      <Box as="span">
                        <Button
                          size="sm"
                          variant="ghost"
                          color="error.600"
                          aria-label={`Delete valuation for ${valuation.valuedAt}`}
                          isDisabled={busy || account.valuations.length === 1}
                          onClick={() => {
                            setDeletion({ kind: 'valuation', id: valuation.id, valuedAt: valuation.valuedAt })
                          }}
                        >
                          Delete
                        </Button>
                      </Box>
                    </Tooltip>
                  </HStack>
                </Flex>
              ))}
            </Stack>
          </Box>
        </Stack>
      </Stack>
      <Modal
        isOpen={deletion !== null}
        onClose={() => {
          if (!busy) {
            setDeletion(null)
          }
        }}
        initialFocusRef={cancelRef}
        isCentered
        closeOnOverlayClick={!busy}
        closeOnEsc={!busy}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text textStyle="text/lg">
              {deletion?.kind === 'account' ? `Remove ${account.displayName}?` : 'Remove this valuation?'}
            </Text>
          </ModalHeader>
          <ModalCloseButton isDisabled={busy} />
          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600">
              {deletion?.kind === 'account'
                ? 'This investment account and all its valuations will be deleted. Your other accounts will be unaffected.'
                : `The valuation for ${deletion?.kind === 'valuation' ? formatValuationDate(deletion.valuedAt) : ''} will be deleted. The remaining valuations will be kept.`}
            </Text>
          </ModalBody>
          <ModalFooter gap={2}>
            <Button
              ref={cancelRef}
              variant="outline"
              flex={1}
              isDisabled={busy}
              onClick={() => {
                setDeletion(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="error"
              flex={1}
              isLoading={busy}
              onClick={() => {
                void remove()
              }}
            >
              Remove
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        isOpen={newName !== null}
        onClose={() => {
          if (!busy) {
            setNewName(null)
          }
        }}
        isCentered
        closeOnOverlayClick={!busy}
        closeOnEsc={!busy}
      >
        <ModalOverlay />
        <ModalContent
          as="form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy) {
              void saveName()
            }
          }}
        >
          <ModalHeader>
            <Text textStyle="text/lg">Rename Account</Text>
          </ModalHeader>
          <ModalCloseButton isDisabled={busy} />
          <ModalBody>
            <FormControl isRequired isDisabled={busy}>
              <FormLabel htmlFor="rename-investment" textStyle="text/sm" color="neutral.600">
                Account Name
              </FormLabel>
              <Input
                id="rename-investment"
                maxLength={200}
                value={newName ?? ''}
                onChange={(event) => {
                  setNewName(event.target.value)
                }}
              />
            </FormControl>
          </ModalBody>
          <ModalFooter gap={2}>
            <Button
              variant="outline"
              flex={1}
              isDisabled={busy}
              onClick={() => {
                setNewName(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" flex={1} isDisabled={newName === null || newName.trim() === ''} isLoading={busy}>
              Save Name
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
