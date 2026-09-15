import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Image,
  Input,
  type ModalProps,
  Stack,
  Text,
  Textarea,
  chakra,
} from '@chakra-ui/react'
import type { ClaimId } from '@hoseki/packages/schemas'
import { DateInput, Panel } from '@hoseki/packages/ui/design-system'
import { useMutation } from '@tanstack/react-query'
import { addDays, endOfDay, format, isAfter, isBefore, min, startOfDay, subMonths } from 'date-fns'
import { FileCheckIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { ClaimSelection } from '../../components/claims/claim-selection'
import { FullTransitionModal, getContent } from '../../components/full-transition-modal'
import { StatementPreviewModal } from '../../components/statement-preview-modal'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { useStatementPolling } from '../../providers/statement-polling-provider'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { isExchangeConnected } from '../../utils/exchange-connection-status'

/** mempool.space historical price data available from April 2023. */
const MIN_MEMPOOL_PRICE_DATE = new Date('2023-04-01')
const MIN_STATEMENT_DATE = MIN_MEMPOOL_PRICE_DATE

export function StatementCreatePage(): JSX.Element {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState<boolean>(false)
  const location = useLocation()
  const navState = location.state as { preSelectedClaimIds?: ClaimId[]; returnTo?: string } | null
  const cancelPath = navState?.returnTo ?? '/home'

  // claims and exchange accounts
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<ClaimId>>(new Set())
  const [selectedExchangeAccountIds, setSelectedExchangeAccountIds] = useState<Set<string>>(new Set())
  const [hasAppliedPreSelection, setHasAppliedPreSelection] = useState(false)
  const [hasAppliedExchangePreSelection, setHasAppliedExchangePreSelection] = useState(false)
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: true })
  const exchangeAccountsQuery = trpc.portalProve.exchange.list.useQuery()

  useEffect(() => {
    if (hasAppliedPreSelection || !claimsQuery.data) return
    setHasAppliedPreSelection(true)

    if (navState?.preSelectedClaimIds && navState.preSelectedClaimIds.length > 0) {
      const validIds = claimsQuery.data.map((c) => c.id)
      const preSelected = navState.preSelectedClaimIds.filter((id) => validIds.includes(id))
      if (preSelected.length > 0) {
        setSelectedClaimIds(new Set(preSelected))
      }
    } else {
      // Select all verified claims by default
      setSelectedClaimIds(new Set(claimsQuery.data.map((c) => c.id)))
    }
  }, [claimsQuery.data, navState, hasAppliedPreSelection])

  // Select all exchange accounts by default once loaded
  useEffect(() => {
    if (hasAppliedExchangePreSelection || !exchangeAccountsQuery.data) return
    setHasAppliedExchangePreSelection(true)
    setSelectedExchangeAccountIds(
      new Set(exchangeAccountsQuery.data.filter(isExchangeConnected).map((account) => account.id)),
    )
  }, [exchangeAccountsQuery.data, hasAppliedExchangePreSelection])

  // dates
  const [closingDate, setClosingDate] = useState<Date>(() => new Date())
  const [openingDate, setOpeningDate] = useState<Date>(() => startOfDay(subMonths(new Date(), 3)))

  // name and address — pre-populate from saved settings in local mode
  const { data: savedUserName } = useLocalSetting('user_name')
  const [name, setName] = useState<string>('')
  const [nameInitialized, setNameInitialized] = useState(false)
  const [address, setAddress] = useState<string>('')

  useEffect(() => {
    if (savedUserName && !nameInitialized) {
      setName(savedUserName)
      setNameInitialized(true)
    }
  }, [savedUserName, nameInitialized])

  // polling:
  // statement `status` starts as 'pending' when startPolling() is called,
  // then it is updated to a 'completed' or 'failed' statement.
  const { startPolling, statement } = useStatementPolling()

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // generate
  const initiateStatementGenerationMutation = trpc.portalProve.statement.initiateGeneration.useMutation()
  const initiateMutationWithArgs = useMutation({
    mutationFn: async () => {
      if (dateError) {
        toast.error(dateError)
        return
      }

      const statement = await initiateStatementGenerationMutation.mutateAsync({
        claimIds: Array.from(selectedClaimIds),
        exchangeAccountIds: Array.from(selectedExchangeAccountIds),
        timezone: userTimezone,
        openingDate,
        closingDate,
        name: name || null,
        address: address || null,
      })

      // keeping them at the end of the fn to make sure we're overwriting
      // provider state via `startPolling(statement)` before opening the modal,
      // so that the modal doesn't show the old completed/failed statement screen
      startPolling(statement.id)
      setIsModalOpen(true)
    },
    onError: (error: { message: string }) => {
      toast.error(error.message ?? 'Error when generating statement')
    },
  })

  const LEFT_COLUMN_WIDTH = '35%'
  const dateError = isBefore(openingDate, startOfDay(addDays(MIN_STATEMENT_DATE, 1)))
    ? 'Start date must be after April 1, 2023.'
    : isAfter(openingDate, closingDate)
      ? 'Start date must be on or before end date.'
      : isAfter(closingDate, new Date())
        ? 'End date cannot be in the future.'
        : null
  const invalidDateRange = dateError !== null

  const hasAccounts =
    (claimsQuery.data && claimsQuery.data.length > 0) ||
    (exchangeAccountsQuery.data && exchangeAccountsQuery.data.length > 0)
  const hasAnySelected = selectedClaimIds.size > 0 || selectedExchangeAccountIds.size > 0

  return (
    <Stack py={8} spacing={8}>
      <Panel icon={<FileCheckIcon />} title="Generate Statement">
        <Box pt={8} pb={hasAccounts ? 0 : 8} px={4}>
          <HStack alignItems="flex-start" gap={8}>
            <Stack gap={1} flexBasis={LEFT_COLUMN_WIDTH} flexShrink={0}>
              <Text as="h2" textStyle="text/md" fontWeight="medium">
                What is a Bitcoin Control Center statement?
              </Text>
              <Text textStyle="text/sm" color="neutral.600">
                A Bitcoin Control Center statement is like a bank statement for your self-custodial Bitcoin, showing
                your transactions over a customizable time period.
              </Text>
            </Stack>

            {hasAccounts ? (
              <Stack gap={4} flexGrow="1">
                <Stack gap={1}>
                  <Text as="h2" textStyle="text/md" fontWeight="medium">
                    Customize Your Date Range
                  </Text>
                  <Text textStyle="text/sm">
                    Select a date range for the transaction history shown in your statement.
                  </Text>
                </Stack>
                <HStack spacing={5}>
                  <FormControl>
                    <FormLabel textStyle="label/md" fontWeight="medium" color="neutral.900" htmlFor="opening-date">
                      Start Date
                    </FormLabel>
                    <DateInput
                      id="opening-date"
                      aria-invalid={invalidDateRange}
                      aria-describedby={invalidDateRange ? 'date-range-error' : undefined}
                      max={new Date()}
                      min={addDays(MIN_STATEMENT_DATE, 1)}
                      value={openingDate}
                      onChange={(date) => {
                        if (date) setOpeningDate(startOfDay(date))
                      }}
                      onBlur={(event) => {
                        if (!event.currentTarget.value) {
                          event.currentTarget.value = format(openingDate, 'yyyy-MM-dd')
                        }
                      }}
                      size="md"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel textStyle="label/md" fontWeight="medium" color="neutral.900" htmlFor="closing-date">
                      End Date
                    </FormLabel>
                    <DateInput
                      id="closing-date"
                      aria-invalid={invalidDateRange}
                      aria-describedby={invalidDateRange ? 'date-range-error' : undefined}
                      max={new Date()}
                      value={closingDate}
                      onChange={(date) => {
                        if (date) setClosingDate(min([endOfDay(date), new Date()]))
                      }}
                      onBlur={(event) => {
                        if (!event.currentTarget.value) {
                          event.currentTarget.value = format(closingDate, 'yyyy-MM-dd')
                        }
                      }}
                      size="md"
                    />
                  </FormControl>
                </HStack>
                {invalidDateRange && (
                  <Text id="date-range-error" role="alert" textStyle="text/sm" color="error.700">
                    {dateError}
                  </Text>
                )}
              </Stack>
            ) : (
              <StatementExampleAsEmptyState />
            )}
          </HStack>

          {hasAccounts && (
            <>
              <chakra.hr my={8} />

              <Accordion allowToggle>
                <AccordionItem border="none">
                  <AccordionButton px={0} py={1} _hover={{ bg: 'transparent' }}>
                    <HStack flex="1" alignItems="flex-start" gap={8} textAlign="left">
                      <Text
                        as="h2"
                        textStyle="text/md"
                        fontWeight="medium"
                        flexBasis={LEFT_COLUMN_WIDTH}
                        flexShrink={0}
                      >
                        Contact Information{' '}
                        <Text as="span" fontWeight="normal" color="neutral.600" fontStyle="italic">
                          (optional)
                        </Text>
                      </Text>
                      <Box flexGrow="1" />
                    </HStack>
                    <AccordionIcon />
                  </AccordionButton>
                  <AccordionPanel px={0} py={1}>
                    <HStack alignItems="flex-start" gap={8}>
                      <Stack gap={1} flexBasis={LEFT_COLUMN_WIDTH} flexShrink={0}>
                        <Text textStyle="text/sm" color="neutral.600">
                          Add your name and address to be included on the statement.
                        </Text>
                      </Stack>
                      <Stack gap={4} flexGrow="1">
                        <FormControl>
                          <FormLabel textStyle="label/md" fontWeight="medium" color="neutral.900" htmlFor="name">
                            Name
                          </FormLabel>
                          <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your name"
                            size="md"
                          />
                        </FormControl>
                        <FormControl>
                          <FormLabel textStyle="label/md" fontWeight="medium" color="neutral.900" htmlFor="address">
                            Address
                            <FormHelperText
                              as="span"
                              ml={2}
                              textStyle="text/sm"
                              color="neutral.600"
                              fontWeight="normal"
                              fontStyle="italic"
                            >
                              (This will appear on the statement exactly as entered)
                            </FormHelperText>
                          </FormLabel>
                          <Textarea
                            id="address"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Enter your address"
                            rows={2}
                            size="md"
                          />
                        </FormControl>
                      </Stack>
                    </HStack>
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            </>
          )}

          <chakra.hr my={8} />

          <HStack alignItems="flex-start" gap={8}>
            <Stack gap={1} flexBasis={LEFT_COLUMN_WIDTH} flexShrink={0}>
              <Text as="h2" textStyle="text/md" fontWeight="medium">
                {hasAccounts ? 'Select Accounts' : 'First, Connect an Account.'}
              </Text>
              <Text textStyle="text/sm" color="neutral.600">
                {hasAccounts
                  ? 'Accounts where you’ve proven ownership.'
                  : 'Before you can generate a bitcoin ownership statement, you’ll need to connect a wallet and verify control.'}
              </Text>
              {!hasAccounts && (
                <Button as={Link} to="/accounts" mt={4} alignSelf="flex-start" size="sm">
                  Connect Wallet
                </Button>
              )}
            </Stack>

            <ClaimSelection
              flexGrow="1"
              selectedClaimIds={selectedClaimIds}
              setSelectedClaimIds={setSelectedClaimIds}
              selectedExchangeAccountIds={selectedExchangeAccountIds}
              setSelectedExchangeAccountIds={setSelectedExchangeAccountIds}
            />
          </HStack>

          {hasAccounts && (
            <Box py={4} px={0}>
              <HStack justifyContent="space-between">
                <Button as={Link} to={cancelPath} variant="outline">
                  Cancel
                </Button>
                <HStack>
                  <Button
                    isDisabled={!hasAnySelected || invalidDateRange}
                    variant="outline"
                    onClick={() => setIsPreviewModalOpen(true)}
                  >
                    Preview Statement
                  </Button>
                  <Button
                    isDisabled={!hasAnySelected || invalidDateRange || initiateMutationWithArgs.isLoading}
                    isLoading={initiateMutationWithArgs.isLoading}
                    onClick={() => initiateMutationWithArgs.mutate()}
                  >
                    Generate Statement
                  </Button>
                </HStack>
              </HStack>
            </Box>
          )}
        </Box>
      </Panel>

      <StatementGenerationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        statement={statement ?? null}
      />

      {!invalidDateRange && (
        <StatementPreviewModal
          isOpen={isPreviewModalOpen}
          onClose={() => setIsPreviewModalOpen(false)}
          claimIds={Array.from(selectedClaimIds)}
          exchangeAccountIds={Array.from(selectedExchangeAccountIds)}
          openingDate={openingDate}
          closingDate={closingDate}
          timezone={userTimezone}
          name={name || null}
          address={address || null}
          context="self_generated"
        />
      )}
    </Stack>
  )
}

function StatementGenerationModal({
  statement,
  ...props
}: { statement: StatementDto | null } & Omit<ModalProps, 'children'>) {
  const completedContent = (
    <HStack>
      <Button as={Link} to="/portfolio" variant="outline">
        Back to Home
      </Button>
      {statement && (
        <Button as={Link} to={`/statements/${statement.id}`}>
          View Statement
        </Button>
      )}
    </HStack>
  )

  return (
    <FullTransitionModal
      content={getContent()}
      status={statement?.status ?? 'pending'}
      additionalCompletedContent={completedContent}
      {...props}
    />
  )
}

function StatementExampleAsEmptyState() {
  return (
    <Box position="relative">
      <Image src="/empty-view/claims-empty-state-download-example.png" alt="Example Bitcoin statement." />
    </Box>
  )
}
