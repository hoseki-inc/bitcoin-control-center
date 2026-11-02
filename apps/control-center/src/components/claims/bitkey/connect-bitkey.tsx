import {
  Box,
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Input,
  Stack,
  Text,
  Textarea,
  chakra,
  keyframes,
} from '@chakra-ui/react'
import { PageTransition } from '@hoseki/packages/ui/design-system'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import {
  ClaimConnectionWrapper,
  FloatingBitkeyImage,
  NavigationArrows,
  WizardFooter,
} from '@hoseki/packages/ui/wallet-ui'
import { type BitkeyExport, parseBitkeyExport } from '@hoseki/packages/wallet'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'
import type { ClaimDto } from '../../../trpc/server-types'
import { BitkeyConnected, BitkeyConnecting } from './bitkey-connected'
import { BitkeyKeyList, BitkeyUnverifiedNote } from './bitkey-notes'
import { BitkeyPhoneGuide, bitkeyExportSteps } from './bitkey-phone-steps'

type Step =
  | { kind: 'intro' }
  | { kind: 'export'; index: number }
  | { kind: 'import' }
  | { kind: 'confirm' }
  | { kind: 'done' }

const lastExportIndex = bitkeyExportSteps.length - 1

/**
 * The step lives in the URL, so switching to the Bitkey app and back, or reloading, keeps the user's place
 * and browser Back goes to the previous step. Only the step's name goes there, never the descriptor.
 */
function stepFromParam(value: string | null): Step {
  if (value === 'import' || value === 'confirm' || value === 'done') {
    return { kind: value }
  }
  const index = Number(/^export-(\d+)$/.exec(value ?? '')?.[1]) - 1
  return Number.isInteger(index) && index >= 0 && index <= lastExportIndex
    ? { kind: 'export', index }
    : { kind: 'intro' }
}

function stepToParam(step: Step): string {
  return step.kind === 'export' ? `export-${step.index + 1}` : step.kind
}

interface ReadExport {
  text: string
  parsed: BitkeyExport
}

export function ConnectBitkey(): JSX.Element {
  const [readExport, setReadExport] = useState<ReadExport | null>(null)
  const [name, setName] = useState('Bitkey')
  const [connected, setConnected] = useState<ClaimDto | null>(null)
  const [isHolding, setIsHolding] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const navigationState = parseNavigationState(location.state)
  const returnTo = navigationState?.returnTo ?? '/accounts'
  const trpcUtils = trpc.useUtils()
  const createBitkey = trpc.portalProve.registry.claims.create.bitkey.useMutation()

  const requested = stepFromParam(searchParams.get('step'))
  // The descriptor is only kept in memory, so after a reload the confirm step asks for it again.
  const step: Step = requested.kind === 'confirm' && readExport === null ? { kind: 'import' } : requested

  // The connecting screen stays up for at least a second, so the success check lands instead of flashing past.
  useEffect(() => {
    if (!isHolding) {
      return
    }
    const timeout = setTimeout(() => {
      setIsHolding(false)
    }, 1_000)
    return () => {
      clearTimeout(timeout)
    }
  }, [isHolding])

  function goTo(next: Step, { replace = false } = {}): void {
    setSearchParams({ step: stepToParam(next) }, { state: navigationState, replace })
  }

  function addBitkey(descriptorExport: string): void {
    setIsHolding(true)
    createBitkey.mutate(
      { descriptorExport, displayName: name.trim() },
      {
        onSuccess: ({ claim, alreadyConnected }) => {
          void trpcUtils.portalProve.registry.claims.list.invalidate()
          if (alreadyConnected) {
            toast.info('This Bitkey is already connected')
            void navigate(`/accounts/${claim.id}`)
            return
          }
          setConnected(claim)
          // Replacing the confirm step means Back can't add the same Bitkey again.
          goTo({ kind: 'done' }, { replace: true })
        },
        onError: (error) => {
          setIsHolding(false)
          // Sentinel only refuses a readable export when that Bitkey is archived.
          if (error.data?.code === 'CONFLICT') {
            toast.info('This Bitkey is archived', { description: 'Restore it from Archived accounts.' })
            void navigate('/accounts#archived')
            return
          }
          toast.error('Couldn’t add your Bitkey', { description: error.message })
        },
      },
    )
  }

  if (createBitkey.isLoading || isHolding) {
    return <BitkeyConnecting />
  }

  if (step.kind === 'done') {
    // The new account is only kept in memory, so after a reload the flow ends on Accounts.
    return connected ? <BitkeyConnected claim={connected} /> : <Navigate to="/accounts" replace />
  }

  return (
    <ClaimConnectionWrapper pt={8}>
      <PageTransition key={step.kind}>
        {step.kind === 'intro' && (
          <Intro
            onBack={() => {
              void navigate(returnTo)
            }}
            onNext={() => {
              goTo({ kind: 'export', index: 0 })
            }}
          />
        )}
        {step.kind === 'export' && (
          <ExportStep
            index={step.index}
            onBack={() => {
              goTo(step.index === 0 ? { kind: 'intro' } : { kind: 'export', index: step.index - 1 })
            }}
            onNext={() => {
              goTo(step.index === lastExportIndex ? { kind: 'import' } : { kind: 'export', index: step.index + 1 })
            }}
          />
        )}
        {step.kind === 'import' && (
          <ImportDescriptor
            onBack={() => {
              goTo({ kind: 'export', index: lastExportIndex })
            }}
            onRead={(read) => {
              setReadExport(read)
              goTo({ kind: 'confirm' })
            }}
          />
        )}
        {step.kind === 'confirm' && readExport && (
          <ConfirmBitkey
            readExport={readExport}
            name={name}
            onNameChange={setName}
            onBack={() => {
              goTo({ kind: 'import' })
            }}
            onAdd={() => {
              addBitkey(readExport.text)
            }}
          />
        )}
      </PageTransition>
    </ClaimConnectionWrapper>
  )
}

/** The step's title. It takes focus when the step changes, so screen readers announce the new step. */
function StepHeading({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [children])

  return (
    <Text
      as="h2"
      ref={ref}
      tabIndex={-1}
      textStyle="text/2xl"
      color="neutral.900"
      fontWeight="medium"
      _focus={{ outline: 'none' }}
    >
      {children}
    </Text>
  )
}

function Intro({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <Stack gap={4}>
      <FloatingBitkeyImage />

      <StepHeading>Connect Your Bitkey</StepHeading>
      <Text textStyle="text/md" color="neutral.900">
        Bitkey keeps your bitcoin in a wallet with three keys: one on your phone, one on your Bitkey, and one held by
        Block. To show it here, Control Center reads the wallet descriptor from the Bitkey app. The descriptor only
        holds public keys, so Control Center can see your balance but can never move your bitcoin.
      </Text>
      <Box>
        <Text textStyle="text/md" color="neutral.900" fontWeight="medium">
          You&apos;ll need:
        </Text>
        <chakra.ul ml={8} textStyle="text/md" color="neutral.900">
          <li>Your phone with the Bitkey app</li>
          <li>A way to copy text on your phone and paste it here</li>
        </chakra.ul>
      </Box>

      <BitkeyUnverifiedNote />

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>Next</Button>}
      />
    </Stack>
  )
}

const textIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

function ExportStep({ index, onBack, onNext }: { index: number; onBack: () => void; onNext: () => void }) {
  const step = bitkeyExportSteps[index]
  if (!step) {
    return null
  }

  return (
    <Stack gap={4}>
      <BitkeyPhoneGuide step={index} />

      <Stack key={index} gap={4} animation={`${textIn} 200ms ease-out`}>
        <StepHeading>{step.title}</StepHeading>
        <Text textStyle="text/md" color="neutral.900">
          {step.body}
        </Text>
      </Stack>

      <NavigationArrows onBack={onBack} onForward={onNext} />
    </Stack>
  )
}

function ImportDescriptor({ onBack, onRead }: { onBack: () => void; onRead: (read: ReadExport) => void }) {
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  return (
    <Stack gap={4}>
      <StepHeading>Add Your Wallet Descriptor</StepHeading>
      <Text textStyle="text/md" color="neutral.900">
        Paste the text you copied from the Bitkey app.
      </Text>

      <form
        id="bitkey-descriptor-form"
        onSubmit={(event) => {
          event.preventDefault()
          const result = parseBitkeyExport(pasted)
          if (result.isOk()) {
            onRead({ text: pasted, parsed: result.unwrap() })
          } else {
            setPasteError(result.unwrapErr().message)
          }
        }}
      >
        <FormControl isInvalid={pasteError !== null}>
          <FormLabel htmlFor="bitkey-descriptor">Wallet descriptor</FormLabel>
          <Textarea
            id="bitkey-descriptor"
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value)
              setPasteError(null)
            }}
            placeholder="External: wsh(sortedmulti(2,…"
            rows={5}
            spellCheck={false}
            autoComplete="off"
            {...monoInputProps}
          />
          {pasteError !== null && <FormErrorMessage>{pasteError}</FormErrorMessage>}
        </FormControl>
      </form>

      <TipAlert title="Keep it private">
        <Text color="neutral.800">
          The descriptor reveals every address and transaction in your Bitkey wallet. Control Center stores it locally
          and never shares it. Delete any other copy once you’ve added it.
        </Text>
      </TipAlert>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={
          <Button type="submit" form="bitkey-descriptor-form" isDisabled={pasted.trim() === ''}>
            Continue
          </Button>
        }
      />
    </Stack>
  )
}

function ConfirmBitkey({
  readExport,
  name,
  onNameChange,
  onBack,
  onAdd,
}: {
  readExport: ReadExport
  name: string
  onNameChange: (name: string) => void
  onBack: () => void
  onAdd: () => void
}) {
  const nameError =
    name.trim() === '' ? 'Give this account a name' : name.length > 255 ? 'Keep the name under 255 characters' : null

  return (
    <Stack gap={4}>
      <StepHeading>We Found Your Bitkey</StepHeading>
      <Text textStyle="text/md" color="neutral.900">
        Any two of these three keys move your bitcoin. Control Center holds none of them.
      </Text>

      <BitkeyKeyList
        keys={readExport.parsed.keys.map(({ role, keyExpression }) => ({
          role,
          xpub: keyExpression.xpub.toString(),
          derivationPath: keyExpression.keyOrigin?.derivationPath?.toString() ?? null,
        }))}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (nameError === null) {
            onAdd()
          }
        }}
      >
        <FormControl isInvalid={nameError !== null}>
          <FormLabel htmlFor="bitkey-name">Name</FormLabel>
          <Input
            id="bitkey-name"
            value={name}
            onChange={(event) => {
              onNameChange(event.target.value)
            }}
          />
          {nameError !== null && <FormErrorMessage>{nameError}</FormErrorMessage>}
        </FormControl>

        <Box mt={4}>
          <BitkeyUnverifiedNote />
        </Box>

        <WizardFooter
          leftButton={
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          }
          rightButton={
            <Button type="submit" isDisabled={nameError !== null}>
              Add Bitkey
            </Button>
          }
        />
      </form>
    </Stack>
  )
}
