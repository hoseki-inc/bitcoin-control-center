import {
  Box,
  FormControl,
  FormLabel,
  HStack,
  Radio,
  RadioGroup,
  SimpleGrid,
  Spinner,
  Text,
  VisuallyHidden,
} from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheckIcon, ClockIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { type RouterOutput, baseTrpc } from '../../trpc'
import { NOTICE_FADE_MS, useFadingNotice } from './fading-notice'

type StatementSource = RouterOutput['settings']['statementSource']['source']

export const STATEMENT_SOURCE_QUERY_KEY = ['statement-source']

/** Where new statements look up transactions, as saved in Sentinel. */
export function useStatementSource(): ReturnType<typeof useQuery<RouterOutput['settings']['statementSource']>> {
  return useQuery({
    queryKey: STATEMENT_SOURCE_QUERY_KEY,
    queryFn: async ({ signal }) => baseTrpc.settings.statementSource.query(undefined, { signal }),
  })
}

const SOURCES = [
  { value: 'mempool', title: 'mempool.space', fast: true },
  { value: 'electrum', title: 'Configured Electrum server', fast: false },
] as const

/**
 * Desktop's choice of where statements look up transactions: mempool.space, or the Electrum server
 * the app is connected to. Shown only where Sentinel lets it be chosen.
 */
export function StatementSourceSettings({ torEnabled }: { torEnabled: boolean }): JSX.Element | null {
  const queryClient = useQueryClient()
  // The choice being saved, shown over the saved one until Sentinel answers.
  const [unsaved, setUnsaved] = useState<StatementSource | null>(null)
  // The latest choice made while a save runs, sent once it finishes.
  const pending = useRef<StatementSource | null>(null)
  const sending = useRef(false)
  const [savedNotice, setSavedNotice] = useFadingNotice()
  const query = useStatementSource()
  if (query.data?.selectable === false) {
    return null
  }
  const source = unsaved ?? query.data?.source

  const change = (next: StatementSource): void => {
    pending.current = next
    setUnsaved(next)
    setSavedNotice(null)
    void save()
  }

  /** Sends the latest choice, and any made while it was sending, then shows what Sentinel saved. */
  const save = async (): Promise<void> => {
    if (sending.current) {
      return
    }
    sending.current = true
    let failed = false
    try {
      await queryClient.cancelQueries({ queryKey: STATEMENT_SOURCE_QUERY_KEY })
      for (let next = pending.current; next !== null; next = pending.current) {
        pending.current = null
        try {
          await baseTrpc.settings.setStatementSource.mutate({ source: next })
          failed = false
        } catch {
          failed = true
        }
      }
    } finally {
      sending.current = false
    }
    // Read back what was saved, since a lost reply can follow a committed write.
    await queryClient.refetchQueries({ queryKey: STATEMENT_SOURCE_QUERY_KEY })
    setUnsaved(null)
    if (failed) {
      toast.error('Could not save the statement source. Please try again.')
    } else {
      setSavedNotice('shown')
    }
  }

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 5, md: 10 }}>
      <Box>
        <Text as="h2" textStyle="text/md" fontWeight="semibold" color="neutral.900">
          Statement data
        </Text>
        <Text id="statement-source-description" mt={2} textStyle="text/sm" color="neutral.600" maxW="36ch">
          Statements look up every transaction in your accounts. Choose where those lookups go.
        </Text>
      </Box>
      <FormControl as="fieldset" isDisabled={source === undefined} aria-busy={unsaved !== null}>
        <HStack justify="space-between" mb={2}>
          <FormLabel as="legend" textStyle="text/sm" mb={0}>
            Look up transactions on
          </FormLabel>
          <HStack
            as="output"
            w={4}
            flexShrink={0}
            color="green.600"
            opacity={unsaved !== null || savedNotice === 'shown' ? 1 : 0}
            transition={`opacity ${NOTICE_FADE_MS}ms ease-out`}
          >
            {unsaved !== null ? (
              <>
                <Spinner size="xs" color="neutral.500" />
                <VisuallyHidden>Saving the statement source</VisuallyHidden>
              </>
            ) : (
              savedNotice !== null && (
                <>
                  <CircleCheckIcon size={16} aria-hidden />
                  <VisuallyHidden>Statement source saved</VisuallyHidden>
                </>
              )
            )}
          </HStack>
        </HStack>
        <RadioGroup
          value={source ?? ''}
          aria-describedby="statement-source-description statement-source-help"
          onChange={(value) => {
            const next = SOURCES.find((item) => item.value === value)
            if (next) {
              change(next.value)
            }
          }}
        >
          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
            {SOURCES.map((item) => {
              const isSelected = source === item.value
              return (
                <Box
                  key={item.value}
                  as="label"
                  cursor="pointer"
                  borderWidth="1px"
                  borderColor={isSelected ? 'neutral.900' : 'neutral.200'}
                  // An inset ring adds the selected weight without shifting the contents.
                  boxShadow={isSelected ? 'inset 0 0 0 1px var(--chakra-colors-neutral-900)' : undefined}
                  borderRadius="md"
                  p={3}
                >
                  <Radio value={item.value} colorScheme="orange" size="sm">
                    <Text textStyle="text/sm" fontWeight="medium">
                      {item.title}
                    </Text>
                  </Radio>
                  <Text textStyle="text/xs" color="neutral.600" mt={1.5} ml={6}>
                    <Text
                      as="span"
                      fontWeight="medium"
                      px={1.5}
                      py={0.5}
                      borderRadius="sm"
                      bg={item.fast ? 'success.100' : 'warning.100'}
                      color={item.fast ? 'success.800' : 'warning.800'}
                    >
                      {item.fast ? 'Fastest' : 'Slower'}
                    </Text>
                    {item.value === 'mempool' && ' · Default'}
                  </Text>
                </Box>
              )
            })}
          </SimpleGrid>
        </RadioGroup>
        <Text id="statement-source-help" mt={2} textStyle="text/xs" color="neutral.600">
          {source === 'electrum'
            ? torEnabled
              ? 'Slower. Your transaction details are shared with the server operator.'
              : 'Slower. Your IP address and transaction details are shared with the server operator.'
            : 'Fastest. Your IP address and transaction details are shared with mempool.space.'}
        </Text>
        {source === 'electrum' && torEnabled && (
          <HStack mt={3} bg="neutral.50" borderRadius="md" px={3} py={2} gap={2} color="neutral.700">
            <ClockIcon size={14} aria-hidden />
            <Text textStyle="text/xs">
              Your current Electrum connection uses Tor, so statement generation could take several minutes.
            </Text>
          </HStack>
        )}
        {query.isError && (
          <Text role="alert" mt={2} textStyle="text/sm" color="error.700">
            Could not load statement settings. Refresh to try again.
          </Text>
        )}
      </FormControl>
    </SimpleGrid>
  )
}
