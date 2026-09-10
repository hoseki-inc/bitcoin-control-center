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
  Grid,
  HStack,
  Image,
  Input,
  type ModalProps,
  Select,
  Stack,
  Text,
  Textarea,
  chakra,
} from '@chakra-ui/react'
import { getLatestStatementClosingDate } from '@hoseki/packages/lib/statement-dates'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { ClaimId } from '@hoseki/packages/schemas'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import { DateInput, Panel } from '@hoseki/packages/ui/design-system'
import { useMutation } from '@tanstack/react-query'
import { addDays, endOfDay, isAfter, min, startOfDay, subMonths } from 'date-fns'
import { FileCheckIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { ClaimSelection } from '../../components/claims/claim-selection'
import { FullTransitionModal, getContent } from '../../components/full-transition-modal'
import { StatementPreviewModal } from '../../components/statement-preview-modal'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { parseNavigationState } from '../../lib/navigation-state'
import { useStatementPolling } from '../../providers/statement-polling-provider'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { isExchangeConnected } from '../../utils/exchange-connection-status'

/** Existing product limit for statement dates. */
const MIN_MEMPOOL_PRICE_DATE = new Date('2023-04-01')
const MIN_STATEMENT_DATE = MIN_MEMPOOL_PRICE_DATE

export function StatementCreatePage(): JSX.Element {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState<boolean>(false)
  const location = useLocation()
  const navState = parseNavigationState(location.state)
  const cancelPath = navState?.returnTo ?? '/home'

  // claims and exchange accounts
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<ClaimId>>(new Set())
  const [selectedExchangeAccountIds, setSelectedExchangeAccountIds] = useState<Set<string>>(new Set())
  const [hasAppliedPreSelection, setHasAppliedPreSelection] = useState(false)
  const [hasAppliedExchangePreSelection, setHasAppliedExchangePreSelection] = useState(false)
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: true })
  const exchangeAccountsQuery = trpc.portalProve.exchange.list.useQuery()

  useEffect(() => {
    if (hasAppliedPreSelection || !claimsQuery.data) {
      return
    }
    setHasAppliedPreSelection(true)

    if (navState?.preSelectedClaimIds && navState.preSelectedClaimIds.length > 0) {
      const validIds = claimsQuery.data.map((c) => c.id)
      const preSelected = navState.preSelectedClaimIds.flatMap((id) => {
        const validId = validIds.find((candidate) => candidate === id)
        return validId != null && validId.length > 0 ? [validId] : []
      })
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
    if (hasAppliedExchangePreSelection || !exchangeAccountsQuery.data) {
      return
    }
    setHasAppliedExchangePreSelection(true)
    setSelectedExchangeAccountIds(
      new Set(exchangeAccountsQuery.data.filter(isExchangeConnected).map((account) => account.id)),
    )
  }, [exchangeAccountsQuery.data, hasAppliedExchangePreSelection])

  const [quoteCurrency, setQuoteCurrency] = useState<StatementQuoteCurrency>('USD')

  // dates
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()
  // The browser's own timezone is always recognized; UTC only guards against an unexpected runtime.
  const latestClosingDate = getLatestStatementClosingDate(now, userTimezone).unwrapOrElse(() =>
    getLatestStatementClosingDate(now, 'UTC').expect('UTC is always a recognized timezone'),
  )
  const [closingDate, setClosingDate] = useState<Date>(() => latestClosingDate)
  const [openingDate, setOpeningDate] = useState<Date>(() => startOfDay(subMonths(new Date(), 3)))

  // name and address — pre-populate from saved settings in local mode
  const { data: savedUserName } = useLocalSetting('user_name')
  const [name, setName] = useState<string>('')
  const [nameInitialized, setNameInitialized] = useState(false)
  const [address, setAddress] = useState<string>('')

  useEffect(() => {
    if (savedUserName != null && savedUserName !== '' && !nameInitialized) {
      setName(savedUserName)
      setNameInitialized(true)
    }
  }, [savedUserName, nameInitialized])

  // polling:
  // statement `status` starts as 'pending' when startPolling() is called,
  // then it is updated to a 'completed' or 'failed' statement.
  const { startPolling, statement } = useStatementPolling()

  // generate
  const initiateStatementGenerationMutation = trpc.portalProve.statement.initiateGeneration.useMutation()
  const initiateMutationWithArgs = useMutation({
    mutationFn: async () => {
      if (isAfter(openingDate, closingDate)) {
        toast.error('Start date must be before end date')
        return
      }

      const generatedStatement = await initiateStatementGenerationMutation.mutateAsync({
        claimIds: Array.from(selectedClaimIds),
        exchangeAccountIds: Array.from(selectedExchangeAccountIds),
        timezone: userTimezone,
        quoteCurrency,
        openingDate,
        closingDate,
        name: name || null,
        address: address || null,
      })

      // keeping them at the end of the fn to make sure we're overwriting
      // provider state via `startPolling(statement)` before opening the modal,
      // so that the modal doesn't show the old completed/failed statement screen
      startPolling(generatedStatement.id)
      setIsModalOpen(true)
    },
    onError: (error: { message: string }) => {
      toast.error(error.message)
    },
  })

  const LEFT_COLUMN_WIDTH = '35%'

  const hasAccounts = (claimsQuery.data?.length ?? 0) > 0 || (exchangeAccountsQuery.data?.length ?? 0) > 0
  const hasAnySelected = selectedClaimIds.size > 0 || selectedExchangeAccountIds.size > 0

  return (
    <Stack py={8} spacing={8}>
      <Panel icon={<FileCheckIcon />} title="Generate Statement">
        <Box pt={8} pb={hasAccounts ? 0 : 8} px={4}>
          <Stack direction={{ base: 'column', md: 'row' }} alignItems="flex-start" gap={8}>
            <Stack gap={1} flexBasis={{ base: 'auto', md: LEFT_COLUMN_WIDTH }} flexShrink={0}>
              <Text as="h2" textStyle="text/md" fontWeight="medium">
                What is a Bitcoin Control Center statement?
              </Text>
              <Text textStyle="text/sm" color="neutral.600">
                A Bitcoin Control Center statement is like a bank statement for your self-custodial Bitcoin, showing
                your transactions over a customizable time period.
              </Text>
            </Stack>

            {hasAccounts ? (
              <Stack gap={5} flexGrow="1" minW={0} w="full" sx={{ containerType: 'inline-size' }}>
                <Text as="h2" textStyle="text/md" fontWeight="medium">
                  Statement details
                </Text>
                <Grid
                  templateColumns="minmax(0, 1fr) minmax(0, 1fr) 96px"
                  gap={3.5}
                  alignItems="end"
                  sx={{
                    '@container (max-width: 440px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
                    '@container (max-width: 320px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
                  }}
                >
                  <FormControl minW={0}>
                    <FormLabel textStyle="label/md" fontWeight="normal" color="neutral.900" htmlFor="opening-date">
                      Start date
                    </FormLabel>
                    <DateInput
                      id="opening-date"
                      max={latestClosingDate}
                      min={addDays(MIN_STATEMENT_DATE, 1)}
                      value={openingDate}
                      onChange={(date) => {
                        if (date) {
                          setOpeningDate(startOfDay(date))
                        }
                      }}
                      size="md"
                    />
                  </FormControl>

                  <FormControl minW={0}>
                    <FormLabel textStyle="label/md" fontWeight="normal" color="neutral.900" htmlFor="closing-date">
                      End date
                    </FormLabel>
                    <DateInput
                      id="closing-date"
                      max={latestClosingDate}
                      value={closingDate}
                      onChange={(date) => {
                        if (date) {
                          setClosingDate(min([endOfDay(date), latestClosingDate]))
                        }
                      }}
                      size="md"
                    />
                  </FormControl>

                  <FormControl w="96px">
                    <FormLabel textStyle="label/md" fontWeight="normal" color="neutral.900" htmlFor="quote-currency">
                      Currency
                    </FormLabel>
                    <Select
                      id="quote-currency"
                      aria-label="Statement currency"
                      value={quoteCurrency}
                      onChange={(event) => {
                        const parsed = parseUnknown(StatementQuoteCurrencySchema, event.target.value)
                        if (parsed.isOk()) {
                          setQuoteCurrency(parsed.unwrap())
                        }
                      }}
                    >
                      <option value="USD" aria-label="USD — US Dollar">
                        USD
                      </option>
                      <option value="CAD" aria-label="CAD — Canadian Dollar">
                        CAD
                      </option>
                      <option value="GBP" aria-label="GBP — British Pound">
                        GBP
                      </option>
                      <option value="EUR" aria-label="EUR — Euro">
                        EUR
                      </option>
                    </Select>
                  </FormControl>
                </Grid>
              </Stack>
            ) : (
              <StatementExampleAsEmptyState />
            )}
          </Stack>

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
                            onChange={(e) => {
                              setName(e.target.value)
                            }}
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
                            onChange={(e) => {
                              setAddress(e.target.value)
                            }}
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
                    isDisabled={!hasAnySelected}
                    variant="outline"
                    onClick={() => {
                      setIsPreviewModalOpen(true)
                    }}
                  >
                    Preview Statement
                  </Button>
                  <Button
                    isDisabled={!hasAnySelected || initiateMutationWithArgs.isLoading}
                    isLoading={initiateMutationWithArgs.isLoading}
                    onClick={() => {
                      initiateMutationWithArgs.mutate()
                    }}
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
        onClose={() => {
          setIsModalOpen(false)
        }}
        statement={statement ?? null}
      />

      <StatementPreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => {
          setIsPreviewModalOpen(false)
        }}
        claimIds={Array.from(selectedClaimIds)}
        exchangeAccountIds={Array.from(selectedExchangeAccountIds)}
        openingDate={openingDate}
        closingDate={closingDate}
        timezone={userTimezone}
        quoteCurrency={quoteCurrency}
        name={name || null}
        address={address || null}
        context="self_generated"
      />
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
