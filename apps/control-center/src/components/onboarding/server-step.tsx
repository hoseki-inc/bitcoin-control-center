import {
  Alert,
  AlertDescription,
  Box,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  Text,
  useToken,
} from '@chakra-ui/react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type ConnectionDetails,
  blankConnection,
  errorMessage,
  isOnionHost,
  isValidPort,
} from '../../pages/settings/electrum-connection'
import type { ElectrumChoice } from './electrum-choice'
import { ServerPreview } from './onboarding-previews'
import type { OnboardingStep } from './onboarding-steps'

type Server = 'own' | 'public'

// The public server comes first and chosen, as the server the app starts on. What Blockstream sees
// is in the step's text and preview; your node's line says what comes next.
const SERVER_OPTIONS: Array<{ value: Server; title: string; description: string; consequence?: string }> = [
  {
    value: 'public',
    title: 'Blockstream’s public server',
    description: 'Works right away, with nothing to set up.',
  },
  {
    value: 'own',
    title: 'My own node',
    description: 'Umbrel, Start9, or another Electrum server you run.',
    consequence: 'Only your node sees your wallets. You’ll enter its address next.',
  },
]

/** Why something can't go on yet: details to fix, or a failed connection with Sentinel's reason. */
type Problem = { message: string; reason?: string }

/** A problem's message, with Sentinel's reason beneath it when there is one. */
function ProblemDescription({ problem }: { problem: Problem }): JSX.Element {
  return (
    <AlertDescription>
      {problem.message}
      {problem.reason !== undefined && (
        <Text as="span" display="block" textStyle="text/xs" mt={1}>
          {problem.reason}
        </Text>
      )}
    </AlertDescription>
  )
}

/** The Connect via Tor switch, for the public server or your node. */
function TorSwitch({
  id,
  description,
  isChecked,
  isDisabled,
  onChange,
}: {
  id: string
  description: string
  isChecked: boolean
  isDisabled: boolean
  onChange: (torEnabled: boolean) => void
}): JSX.Element {
  return (
    <HStack justify="space-between" gap={3}>
      <Box>
        <FormLabel htmlFor={id} textStyle="label/sm" mb={0}>
          Connect via Tor
        </FormLabel>
        <Text id={`${id}-description`} textStyle="text/xs" color="neutral.600">
          {description}
        </Text>
      </Box>
      <Switch
        id={id}
        colorScheme="green"
        aria-describedby={`${id}-description`}
        isChecked={isChecked}
        isDisabled={isDisabled}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
    </HStack>
  )
}

/** One server to choose, as a card around its radio. Needs a RadioGroup. */
function ServerOption({
  item,
  isSelected,
}: {
  item: (typeof SERVER_OPTIONS)[number]
  isSelected: boolean
}): JSX.Element {
  const [selectedEdge] = useToken('colors', ['neutral.900'])
  return (
    <Box
      as="label"
      cursor="pointer"
      borderWidth="1px"
      borderColor={isSelected ? 'neutral.900' : 'neutral.200'}
      // An inset ring adds the selected weight without shifting the contents.
      boxShadow={isSelected ? `inset 0 0 0 1px ${selectedEdge}` : undefined}
      borderRadius="md"
      p={3}
      sx={{
        // Radio puts margin props on its whole row, so the dot alone is nudged from the card.
        '.chakra-radio__control': { mt: 1 },
        // The chosen dot matches the card's edge rather than the theme's orange.
        '.chakra-radio__control[data-checked], .chakra-radio__control[data-checked]:hover': {
          bg: 'neutral.900',
          borderColor: 'neutral.900',
        },
      }}
    >
      <Radio value={item.value} size="sm" alignItems="flex-start">
        <Text textStyle="text/sm" fontWeight="medium">
          {item.title}
        </Text>
      </Radio>
      <Text textStyle="text/xs" color="neutral.600" mt={1} ml={6}>
        {item.description}
      </Text>
    </Box>
  )
}

function ServerOptions({
  value,
  onChange,
  torEnabled,
  onTorChange,
  isDisabled,
  failure,
}: {
  value: Server
  onChange: (value: Server) => void
  /** Whether the public server connects through Tor. */
  torEnabled: boolean
  onTorChange: (torEnabled: boolean) => void
  isDisabled: boolean
  failure: Problem | null
}): JSX.Element {
  const failureRef = useRef<HTMLDivElement>(null)
  const consequence = SERVER_OPTIONS.find((item) => item.value === value)?.consequence

  // With Tor on, the step fills a desktop window, and the failure would sit below the fold.
  useEffect(() => {
    if (failure !== null) {
      failureRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [failure])

  return (
    <Stack gap={3}>
      <RadioGroup
        aria-label="Electrum server"
        aria-describedby={consequence === undefined ? undefined : 'server-consequence'}
        value={value}
        isDisabled={isDisabled}
        onChange={(next) => {
          if (next === 'own' || next === 'public') {
            onChange(next)
          }
        }}
      >
        <Stack gap={2}>
          {SERVER_OPTIONS.map((item) => (
            <ServerOption key={item.value} item={item} isSelected={item.value === value} />
          ))}
        </Stack>
      </RadioGroup>
      {/* Your node's own switch comes with its address, on the next step. */}
      {value === 'public' && (
        <TorSwitch
          id="public-tor"
          // One line each, so the step still fits a desktop window.
          description={
            torEnabled
              ? 'Hides your IP address. Tor can take a minute to start.'
              : 'Hides your IP address from Blockstream.'
          }
          isChecked={torEnabled}
          isDisabled={isDisabled}
          onChange={onTorChange}
        />
      )}
      {consequence !== undefined && (
        <Text id="server-consequence" textStyle="text/xs" color="neutral.600">
          {consequence}
        </Text>
      )}
      {failure !== null && (
        <Alert ref={failureRef} status="error">
          <ProblemDescription problem={failure} />
        </Alert>
      )}
    </Stack>
  )
}

function NodeForm({
  draft,
  onChange,
  onSubmit,
  isDisabled,
  isConnected,
  problem,
}: {
  draft: ConnectionDetails
  onChange: (value: Partial<ConnectionDetails>) => void
  onSubmit: () => void
  isDisabled: boolean
  /** Connected to these details already, as when coming back to the form. */
  isConnected: boolean
  problem: Problem | null
}): JSX.Element {
  const hostRef = useRef<HTMLInputElement>(null)
  const problemRef = useRef<HTMLDivElement>(null)
  const onionNeedsTor = isOnionHost(draft.host) && !draft.torEnabled
  // Enter in the address or port connects, like the button in the footer.
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit()
    }
  }

  useEffect(() => {
    hostRef.current?.focus()
  }, [])

  // On a short screen the form scrolls, and the problem would sit below the fold.
  useEffect(() => {
    if (problem !== null) {
      problemRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [problem])

  return (
    <Stack gap={3}>
      <FormControl>
        <FormLabel htmlFor="node-host" textStyle="label/sm">
          Address
        </FormLabel>
        <Input
          id="node-host"
          ref={hostRef}
          size="sm"
          placeholder="umbrel.local or 192.168.1.20"
          autoComplete="off"
          spellCheck={false}
          value={draft.host}
          isDisabled={isDisabled}
          onKeyDown={submitOnEnter}
          onChange={(event) => {
            onChange({ host: event.target.value })
          }}
        />
      </FormControl>
      <HStack gap={3} align="flex-end">
        <FormControl minW={0}>
          <FormLabel htmlFor="node-port" textStyle="label/sm">
            Port
          </FormLabel>
          <Input
            id="node-port"
            size="sm"
            type="number"
            min={1}
            max={65535}
            value={draft.port || ''}
            isDisabled={isDisabled}
            onKeyDown={submitOnEnter}
            onChange={(event) => {
              onChange({ port: Number(event.target.value) })
            }}
          />
        </FormControl>
        <FormControl w="120px" flexShrink={0}>
          <FormLabel htmlFor="node-protocol" textStyle="label/sm">
            Protocol
          </FormLabel>
          <Select
            id="node-protocol"
            size="sm"
            value={draft.protocol}
            isDisabled={isDisabled}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'tcp' || value === 'ssl') {
                onChange({ protocol: value })
              }
            }}
          >
            <option value="ssl">SSL</option>
            <option value="tcp">TCP</option>
          </Select>
        </FormControl>
      </HStack>
      <TorSwitch
        id="node-tor"
        description={
          draft.torEnabled
            ? 'Hides your IP address. Tor can take a minute to start.'
            : 'Hides your IP address. Needed for .onion addresses.'
        }
        isChecked={draft.torEnabled}
        isDisabled={isDisabled}
        onChange={(torEnabled) => {
          onChange({ torEnabled })
        }}
      />
      {isConnected && (
        <Text as="output" textStyle="text/sm" color="success.700">
          Connected to your node.
        </Text>
      )}
      {onionNeedsTor && problem === null && (
        <Text as="output" textStyle="text/sm" color="neutral.600">
          Onion addresses need Tor. Turn on Connect via Tor.
        </Text>
      )}
      {problem !== null && (
        <Alert ref={problemRef} status="error">
          <ProblemDescription problem={problem} />
        </Alert>
      )}
    </Stack>
  )
}

/** Why these details can't be tried yet, or null when they can. */
function invalidReason(draft: ConnectionDetails): string | null {
  if (draft.host.trim() === '') {
    return 'Enter your node’s address.'
  }
  if (!isValidPort(draft.port)) {
    return 'Enter a port from 1 to 65535.'
  }
  if (isOnionHost(draft.host) && !draft.torEnabled) {
    return 'Onion addresses need Tor. Turn on Connect via Tor.'
  }
  return null
}

function sameDetails(a: ConnectionDetails, b: ConnectionDetails | null): boolean {
  return (
    b !== null &&
    a.host.trim() === b.host.trim() &&
    a.port === b.port &&
    a.protocol === b.protocol &&
    a.torEnabled === b.torEnabled
  )
}

/**
 * Desktop's choice of Electrum server: keep the public one the app started with, through Tor or not,
 * or connect your own node, which follows as a step of its own.
 */
export function useServerSteps(choice: ElectrumChoice | undefined): OnboardingStep[] {
  const [server, setServer] = useState<Server>('public')
  const [publicTor, setPublicTor] = useState(false)
  const [busy, setBusy] = useState(false)
  const [choiceFailure, setChoiceFailure] = useState<Problem | null>(null)
  const [draft, setDraft] = useState(blankConnection)
  const [problem, setProblem] = useState<Problem | null>(null)
  // The details last connected here, so coming back to the form and on doesn't connect again.
  const [connected, setConnected] = useState<ConnectionDetails | null>(null)

  if (choice === undefined) {
    return []
  }

  const isConnected = sameDetails(draft, connected)

  const connect = async (): Promise<boolean> => {
    if (isConnected) {
      return true
    }
    const invalid = invalidReason(draft)
    if (invalid !== null) {
      setProblem({ message: invalid })
      return false
    }
    setBusy(true)
    setProblem(null)
    const details = { ...draft, host: draft.host.trim() }
    const result = await choice.connectNode(details)
    setBusy(false)
    if (result.isErr()) {
      setProblem({
        message: `Couldn’t connect to ${details.host}:${details.port}. Check these details and that your node is on.`,
        reason: errorMessage(result.unwrapErr(), 'The node didn’t answer.'),
      })
      return false
    }
    setConnected(details)
    toast.success('Connected to your node')
    return true
  }

  const steps: OnboardingStep[] = [
    {
      id: 'server',
      title: 'Choose your Electrum server',
      body: 'Control Center looks up your wallets on an Electrum server. Whoever runs it can see which addresses are yours and your IP address.',
      // Each server has its own Tor switch.
      preview: <ServerPreview server={server} torEnabled={server === 'public' ? publicTor : draft.torEnabled} />,
      controls: () => (
        <ServerOptions
          value={server}
          torEnabled={publicTor}
          isDisabled={busy}
          failure={choiceFailure}
          onChange={(next) => {
            setServer(next)
            setChoiceFailure(null)
          }}
          onTorChange={(torEnabled) => {
            setPublicTor(torEnabled)
            setChoiceFailure(null)
            if (torEnabled) {
              choice.startTor()
            }
          }}
        />
      ),
      primary: {
        label: 'Continue',
        isLoading: busy && server === 'public',
        // Only Tor takes long enough to say what's happening.
        loadingText: publicTor ? 'Connecting…' : undefined,
        run: async () => {
          if (server === 'own') {
            return true
          }
          setBusy(true)
          setChoiceFailure(null)
          const result = await choice.keepPublic(publicTor)
          setBusy(false)
          if (result.isErr()) {
            const error = result.unwrapErr()
            setChoiceFailure(
              publicTor
                ? {
                    message: 'Couldn’t connect through Tor. Try again, or turn off Connect via Tor.',
                    reason: errorMessage(error, 'Tor didn’t answer.'),
                  }
                : { message: errorMessage(error, 'Couldn’t switch back to the public server. Try again.') },
            )
            return false
          }
          setConnected(null)
          return true
        },
      },
    },
  ]
  if (server === 'own') {
    steps.push({
      id: 'node',
      followUp: true,
      title: 'Connect your node',
      body: 'You’ll find these in your node’s Electrum server app, such as Electrs or Fulcrum.',
      preview: <ServerPreview server="own" torEnabled={draft.torEnabled} />,
      controls: (next) => (
        <NodeForm
          draft={draft}
          isDisabled={busy}
          isConnected={isConnected}
          problem={problem}
          onSubmit={next}
          onChange={(value) => {
            setDraft((current) => ({ ...current, ...value }))
            setProblem(null)
            if (value.torEnabled === true) {
              choice.startTor()
            }
          }}
        />
      ),
      primary: {
        label: isConnected ? 'Continue' : 'Connect',
        isLoading: busy,
        loadingText: 'Connecting…',
        run: connect,
      },
    })
  }
  return steps
}
