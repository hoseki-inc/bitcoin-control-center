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
  Input,
  Select,
  Stack,
  Text,
  Textarea,
  chakra,
  usePrefersReducedMotion,
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
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ClaimSelection } from '../../components/claims/claim-selection'
import { EmptyStatePreview } from '../../components/empty-state-preview'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { parseNavigationState } from '../../lib/navigation-state'
import { JUST_GENERATED_STATE } from '../../lib/statement-navigation'
import { trpc } from '../../trpc'

/** Existing product limit for statement dates. */
const MIN_MEMPOOL_PRICE_DATE = new Date('2023-04-01')
const MIN_STATEMENT_DATE = MIN_MEMPOOL_PRICE_DATE

const LEFT_COLUMN_WIDTH = { base: 'auto', md: '35%' }

/** How long this page fades out after Generate, before generation fades in. */
const LEAVE_FADE_MS = 200

export function StatementCreatePage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const navState = parseNavigationState(location.state)
  const reduceMotion = usePrefersReducedMotion()
  const [isLeaving, setIsLeaving] = useState(false)
  const cancelPath = navState?.returnTo ?? '/home'

  // claims
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<ClaimId>>(new Set())
  const [hasAppliedPreSelection, setHasAppliedPreSelection] = useState(false)
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: true })

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

  // generate, then follow progress on the statement page
  const trpcUtils = trpc.useUtils()
  const initiateStatementGenerationMutation = trpc.portalProve.statement.initiateGeneration.useMutation()
  const initiateMutationWithArgs = useMutation({
    mutationFn: async () => {
      if (isAfter(openingDate, closingDate)) {
        toast.error('Start date must be before end date')
        return
      }

      const generatedStatement = await initiateStatementGenerationMutation.mutateAsync({
        claimIds: Array.from(selectedClaimIds),
        timezone: userTimezone,
        quoteCurrency,
        openingDate,
        closingDate,
        name: name || null,
        address: address || null,
      })

      // Statement lists show it straight away, rather than once they refresh.
      void trpcUtils.portalProve.statement.list.cancel()
      trpcUtils.portalProve.statement.list.setData(
        undefined,
        (statements) =>
          statements && [generatedStatement, ...statements.filter((item) => item.id !== generatedStatement.id)],
      )
      // The statement page opens generation straight away with what Sentinel just returned.
      trpcUtils.portalProve.statement.retrieve.setData(generatedStatement.id, generatedStatement)
      // Fade this page out first, so generation fades in from a clear screen rather than cutting in.
      if (!reduceMotion) {
        setIsLeaving(true)
        await new Promise((resolve) => {
          setTimeout(resolve, LEAVE_FADE_MS)
        })
      }
      void navigate(`/statements/${generatedStatement.id}`, { state: JUST_GENERATED_STATE })
    },
    onError: (error: { message: string }) => {
      toast.error(error.message)
    },
  })

  // Ask the user to connect a wallet only once we know they have none.
  const hasAccounts = !claimsQuery.isSuccess || claimsQuery.data.length > 0
  const hasAnySelected = selectedClaimIds.size > 0

  return (
    <Stack py={8} spacing={8} opacity={isLeaving ? 0 : 1} transition={`opacity ${LEAVE_FADE_MS}ms ease-in`}>
      <Panel icon={<FileCheckIcon />} title="Generate Statement">
        <Box pt={8} pb={hasAccounts ? 0 : 8} px={4}>
          <Stack alignItems="stretch" direction={{ base: 'column', md: 'row' }} gap={{ base: 4, md: 8 }}>
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
              <Stack gap={5} flexGrow="1" minW={0} w="full" sx={{ containerType: 'inline-size' }}>
                <Stack gap={1}>
                  <Text as="h2" textStyle="text/md" fontWeight="medium">
                    Customize Your Statement
                  </Text>
                  <Text textStyle="text/sm">Select the date range and currency shown in your statement.</Text>
                </Stack>
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
                    <FormLabel textStyle="label/md" fontWeight="medium" color="neutral.900" htmlFor="opening-date">
                      Start Date
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
                    <FormLabel textStyle="label/md" fontWeight="medium" color="neutral.900" htmlFor="closing-date">
                      End Date
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
                    <FormLabel textStyle="label/md" fontWeight="medium" color="neutral.900" htmlFor="quote-currency">
                      Currency
                    </FormLabel>
                    <Select
                      id="quote-currency"
                      value={quoteCurrency}
                      onChange={(event) => {
                        const parsed = parseUnknown(StatementQuoteCurrencySchema, event.target.value)
                        if (parsed.isOk()) {
                          setQuoteCurrency(parsed.unwrap())
                        }
                      }}
                    >
                      {StatementQuoteCurrencySchema.options.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
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
                <AccordionItem border="none" px={0}>
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
                    <Stack alignItems="stretch" direction={{ base: 'column', md: 'row' }} gap={{ base: 4, md: 8 }}>
                      <Stack gap={1} flexBasis={LEFT_COLUMN_WIDTH} flexShrink={0}>
                        <Text textStyle="text/sm" color="neutral.600">
                          Add your name and address to be included on the statement.
                        </Text>
                      </Stack>
                      <Stack gap={4} flexGrow="1" minW={0}>
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
                    </Stack>
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            </>
          )}

          <chakra.hr my={8} />

          <Stack alignItems="stretch" direction={{ base: 'column', md: 'row' }} gap={{ base: 4, md: 8 }}>
            <Stack gap={1} flexBasis={LEFT_COLUMN_WIDTH} flexShrink={0}>
              <Text as="h2" textStyle="text/md" fontWeight="medium">
                {hasAccounts ? 'Select Accounts' : 'First, Connect an Account.'}
              </Text>
              <Text textStyle="text/sm" color="neutral.600">
                {hasAccounts
                  ? 'Self-custody accounts where you’ve proven ownership. For custodial accounts, your custodian can provide statements.'
                  : 'Before you can generate a bitcoin ownership statement, you’ll need to connect a wallet and verify control.'}
              </Text>
              {!hasAccounts && (
                <Button as={Link} to="/accounts/add" mt={4} alignSelf="flex-start" size="sm">
                  Connect Wallet
                </Button>
              )}
            </Stack>

            <ClaimSelection
              flexGrow="1"
              selectedClaimIds={selectedClaimIds}
              setSelectedClaimIds={setSelectedClaimIds}
            />
          </Stack>

          {hasAccounts && (
            <Box py={4} px={0}>
              {/* Stacked in reading order on small screens, so the focus order matches what's shown. */}
              <Stack direction={{ base: 'column', md: 'row' }} justifyContent="space-between">
                <Button as={Link} to={cancelPath} variant="outline">
                  Cancel
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
              </Stack>
            </Box>
          )}
        </Box>
      </Panel>
    </Stack>
  )
}

function StatementExampleAsEmptyState(): JSX.Element {
  return (
    <EmptyStatePreview
      src="/empty-view/claims-empty-state-download-example.png"
      caption="View a preview of a Bitcoin Control Center statement."
    />
  )
}
