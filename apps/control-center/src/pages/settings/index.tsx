import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  VisuallyHidden,
} from '@chakra-ui/react'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { CircleCheckIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { OnboardingTakeover } from '../../components/onboarding/onboarding-takeover'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { isDesktop } from '../../mode'
import { type RouterOutput, baseTrpc, trpc } from '../../trpc'
import { ElectrumSettings, useActiveConnectionUsesTor } from './electrum-settings'
import { NOTICE_FADE_MS, useFadingNotice } from './fading-notice'
import { SecuritySettings } from './security-settings'
import { StatementSourceSettings } from './statement-source-settings'

export function SettingsPage({ desktop = isDesktop }: { desktop?: boolean }): JSX.Element {
  const { data: savedName, isLoading, saveAsync, isSaving, isError } = useLocalSetting('user_name')
  const [draftName, setDraftName] = useState<string | null>(null)
  const name = draftName ?? savedName ?? ''

  const handleSave = async (): Promise<void> => {
    try {
      await saveAsync(name.trim())
      setDraftName(null)
      toast.success('Name saved')
    } catch {
      toast.error('Could not save your name. Please try again.')
    }
  }

  return (
    <Box py={{ base: 6, md: 10 }} maxW="960px">
      <PageHeading title="Settings" description="App preferences and personal information." />
      <Stack mt={{ base: 8, md: 10 }} spacing={8} divider={<Divider borderColor="neutral.200" />}>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
          <Box>
            <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
              Personal information
            </Text>
            <Text id="user-name-description" mt={2} textStyle="text/sm" color="neutral.600" maxW="32ch">
              This name will appear on your generated statements.
            </Text>
          </Box>
          <Box
            as="form"
            onSubmit={(event: React.FormEvent) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            <FormControl isDisabled={isLoading || isSaving || isError}>
              <FormLabel htmlFor="user-name" textStyle="text/sm" mb={2}>
                Your name
              </FormLabel>
              <Input
                id="user-name"
                autoComplete="name"
                aria-describedby="user-name-description"
                maxLength={200}
                placeholder="Enter your name"
                value={name}
                onChange={(event) => {
                  setDraftName(event.target.value)
                }}
              />
              {isError && (
                <Text role="alert" textStyle="text/sm" color="error.700" mt={2}>
                  Could not load your name. Refresh to try again.
                </Text>
              )}
              <Button
                type="submit"
                size="sm"
                mt={4}
                isLoading={isSaving}
                loadingText="Saving"
                isDisabled={isLoading || isError || name.trim() === (savedName ?? '')}
              >
                Save name
              </Button>
            </FormControl>
          </Box>
        </SimpleGrid>
        <SecuritySettings />
        <IntroductionSettings desktop={desktop} />
        <PriceSourceSettings />
        {desktop && <DesktopStatementSource />}
        {desktop && <ElectrumSettings />}
      </Stack>
    </Box>
  )
}

function IntroductionSettings({ desktop }: { desktop: boolean }): JSX.Element {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [opens, setOpens] = useState(0)

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
      <Box>
        <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
          Introduction
        </Text>
        <Text mt={2} textStyle="text/sm" color="neutral.600" maxW="32ch">
          A quick tour of what Control Center does and how your data is handled.
        </Text>
      </Box>
      <Box>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpens((count) => count + 1)
            setIsOpen(true)
          }}
        >
          View Introduction
        </Button>
      </Box>
      {/* Shows the introduction again without changing the choice saved on first run. A new one each
          time starts at step 1; it stays mounted while closing so it can fade out. */}
      <OnboardingTakeover
        key={opens}
        isOpen={isOpen}
        desktop={desktop}
        onSkip={() => {
          setIsOpen(false)
        }}
        onAddAccount={() => {
          void navigate('/accounts/add')
        }}
      />
    </SimpleGrid>
  )
}

function DesktopStatementSource(): JSX.Element {
  return <StatementSourceSettings torEnabled={useActiveConnectionUsesTor()} />
}

// ─── Bitcoin price source ────────────────────────────────────────────────────

type PriceSourceOptions = RouterOutput['settings']['priceSource']
type PriceStatus = RouterOutput['settings']['priceStatus']
interface PriceChange {
  source?: PriceSourceOptions['selected']
  fallbacks?: boolean
}
const PRICE_SOURCE_QUERY_KEY = ['price-source']
const PRICE_STATUS_QUERY_KEY = ['price-status']
// Queries showing USD values from the current price, refreshed after a change.
const USD_QUERY_KEYS = [getQueryKey(trpc.portalProve.controlCenter.getData)]
// Reset rather than refreshed: a failed price request would otherwise keep showing a price from a source
// the change no longer allows, and account balances never refetch on mount.
const RESET_USD_QUERY_KEYS = [
  getQueryKey(trpc.portalProve.retrieveBitcoinPrice),
  getQueryKey(trpc.portalProve.retrieveBitcoinPriceHistory),
  getQueryKey(trpc.portalProve.onchain.bitcoinAccountBalances),
]

interface StatusResult {
  status: 'loading' | 'error' | 'success'
  data: PriceStatus | undefined
}

/**
 * The price status, only when its last refresh succeeded and it describes the current choice.
 * React Query keeps the previous data after a failed refresh; that must never read as current.
 */
function currentStatus(
  result: StatusResult | undefined,
  options: Pick<PriceSourceOptions, 'selected' | 'fallbacks'> | null,
): PriceStatus | null {
  const status = result?.status === 'success' ? result.data : undefined
  if (!status || !options || status.selected !== options.selected || status.fallbacks !== options.fallbacks) {
    return null
  }
  return status
}

function withChange(options: PriceSourceOptions, change: PriceChange): PriceSourceOptions {
  return { ...options, selected: change.source ?? options.selected, fallbacks: change.fallbacks ?? options.fallbacks }
}

function PriceSourceSettings(): JSX.Element {
  const queryClient = useQueryClient()
  // Changes Sentinel has not confirmed yet, shown over the saved settings until their save finishes.
  const [unsaved, setUnsaved] = useState<PriceChange | null>(null)
  // From a change until the price has been checked under the saved settings.
  const [checking, setChecking] = useState(false)
  // Changes made while a save request runs, sent when it finishes; the latest value of each setting wins.
  const pending = useRef<PriceChange | null>(null)
  const sending = useRef(false)
  // Counts changes, so a check that a later change has superseded never reports.
  const changeCount = useRef(0)
  const query = useQuery({
    queryKey: PRICE_SOURCE_QUERY_KEY,
    queryFn: async ({ signal }) => baseTrpc.settings.priceSource.query(undefined, { signal }),
    // A refresh started before a save finished could bring back the old settings.
    enabled: unsaved === null,
  })
  // Separate from the options, which must stay usable while a price lookup waits on the network.
  const statusQuery = useQuery({
    queryKey: PRICE_STATUS_QUERY_KEY,
    queryFn: async ({ signal }) => baseTrpc.settings.priceStatus.query(undefined, { signal }),
  })
  const saved: PriceSourceOptions | null = query.data ?? null
  const options = saved && unsaved ? withChange(saved, unsaved) : saved
  const [savedNotice, setSavedNotice] = useFadingNotice()

  // Every change is kept, including each step of choosing with the keyboard. The controls stay enabled,
  // since disabling them would drop keyboard focus.
  const change = (next: PriceChange): void => {
    if (!saved) {
      return
    }
    changeCount.current += 1
    pending.current = { ...pending.current, ...next }
    setUnsaved((current) => ({ ...current, ...next }))
    setSavedNotice(null)
    setChecking(true)
    void save()
  }

  /** Sends the pending changes in order, then checks the price under the saved settings. */
  const save = async (): Promise<void> => {
    if (sending.current) {
      return
    }
    sending.current = true
    const takePending = (): PriceChange | null => {
      const next = pending.current
      pending.current = null
      return next
    }
    let result: PriceSourceOptions | null = null
    let failed: PriceChange | null = null
    try {
      await queryClient.cancelQueries({ queryKey: PRICE_SOURCE_QUERY_KEY })
      for (let next = takePending(); next !== null; next = takePending()) {
        try {
          result = await baseTrpc.settings.setPriceSettings.mutate(next)
        } catch {
          // Changes made meanwhile are dropped with it, and the saved settings are shown again.
          failed = { ...next, ...takePending() }
        }
      }
    } finally {
      sending.current = false
    }

    const latest = changeCount.current
    if (result) {
      queryClient.setQueryData(PRICE_SOURCE_QUERY_KEY, result)
    }
    setUnsaved(null)
    if (failed) {
      toast.error(
        failed.source === undefined
          ? 'Could not save the fallback setting. Please try again.'
          : 'Could not save the price source. Please try again.',
      )
    }
    // A status request that began before the save would describe the old choice, so start a new one.
    await queryClient.cancelQueries({ queryKey: PRICE_STATUS_QUERY_KEY })
    if (latest !== changeCount.current) {
      return
    }
    // Refreshed after a failure too, since a lost reply can follow a committed write.
    const refreshing = Promise.all([
      queryClient.invalidateQueries({ queryKey: PRICE_SOURCE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PRICE_STATUS_QUERY_KEY }),
      ...USD_QUERY_KEYS.map(async (queryKey) => queryClient.invalidateQueries({ queryKey })),
      ...RESET_USD_QUERY_KEYS.map(async (queryKey) => queryClient.resetQueries({ queryKey })),
    ])
    // After a failure, the refresh runs in the background so another attempt is not held up.
    if (!failed) {
      await refreshing
    }
    if (latest !== changeCount.current) {
      return
    }
    setChecking(false)
    // Confirm only when a successful check shows the saved choice supplying the price.
    const status = failed ? null : currentStatus(queryClient.getQueryState<PriceStatus>(PRICE_STATUS_QUERY_KEY), result)
    if (status?.price && status.price.source === status.selected && !status.price.lastKnown) {
      setSavedNotice('shown')
    }
  }

  const label = (name: string | undefined): string | undefined =>
    options?.sources.find((source) => source.name === name)?.label
  const selectedLabel = label(options?.selected) ?? 'your primary price source'
  // Read through the query result, so a status that arrives or changes later renders.
  const status = checking ? null : currentStatus(statusQuery, options)
  const fallbackLabel =
    status?.price && !status.price.lastKnown && status.price.source !== status.selected
      ? label(status.price.source)
      : undefined

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
      <Box>
        <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
          Bitcoin price
        </Text>
        <Text id="price-source-description" mt={2} textStyle="text/sm" color="neutral.600" maxW="36ch">
          Used to show your balances in US dollars. Price requests include no wallet information.
        </Text>
      </Box>
      <FormControl isDisabled={!options} aria-busy={checking}>
        <FormLabel htmlFor="price-source" textStyle="text/sm" mb={2}>
          Price source
        </FormLabel>
        <HStack gap={2}>
          <Select
            id="price-source"
            flex={1}
            aria-describedby="price-source-description"
            value={options?.selected ?? ''}
            onChange={(event) => {
              const next = options?.sources.find((source) => source.name === event.target.value)
              if (next) {
                change({ source: next.name })
              }
            }}
          >
            {options?.sources.map((source) => (
              <option key={source.name} value={source.name}>
                {source.label}
              </option>
            ))}
          </Select>
          <HStack
            as="output"
            w={4}
            flexShrink={0}
            color="green.600"
            opacity={checking || savedNotice === 'shown' ? 1 : 0}
            transition={`opacity ${NOTICE_FADE_MS}ms ease-out`}
          >
            {checking ? (
              <>
                <Spinner size="xs" color="neutral.500" />
                <VisuallyHidden>Checking the price source</VisuallyHidden>
              </>
            ) : (
              savedNotice !== null && (
                <>
                  <CircleCheckIcon size={16} aria-hidden />
                  <VisuallyHidden>Price settings saved</VisuallyHidden>
                </>
              )
            )}
          </HStack>
        </HStack>
        <Checkbox
          id="price-fallbacks"
          mt={4}
          size="sm"
          colorScheme="orange"
          aria-describedby="price-fallbacks-description"
          isChecked={options?.fallbacks ?? true}
          onChange={(event) => {
            change({ fallbacks: event.target.checked })
          }}
        >
          <Text textStyle="text/sm">Allow fallbacks</Text>
        </Checkbox>
        <Text id="price-fallbacks-description" mt={1} textStyle="text/xs" color="neutral.600">
          If your primary price source is unavailable, use the next best source.
        </Text>
        {query.isError && (
          <Text role="alert" mt={2} textStyle="text/sm" color="error.700">
            Could not load price settings. Refresh to try again.
          </Text>
        )}
        {!checking && statusQuery.isError && (
          <Text role="alert" mt={2} textStyle="text/sm" color="error.700">
            Could not check the price source. Refresh to try again.
          </Text>
        )}
        {fallbackLabel !== undefined && (
          <Text as="output" display="block" mt={2} textStyle="text/xs" color="neutral.600">
            Using {fallbackLabel} while {selectedLabel} is unavailable.
          </Text>
        )}
        {status?.price?.lastKnown === true && (
          <Text as="output" display="block" mt={2} textStyle="text/xs" color="neutral.600">
            No price source is available right now. Showing the last known price.
          </Text>
        )}
        {status && status.price === null && (
          <Text as="output" display="block" mt={2} textStyle="text/xs" color="error.700">
            No price is available right now.
          </Text>
        )}
      </FormControl>
    </SimpleGrid>
  )
}
