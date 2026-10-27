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
import type { Result } from '@hoseki/packages/result'
import { FileDropReader, type FileDropState, PageTransition } from '@hoseki/packages/ui/design-system'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import {
  ClaimConnectionWrapper,
  FloatingBitkeyImage,
  NavigationArrows,
  WizardFooter,
} from '@hoseki/packages/ui/wallet-ui'
import { type BitkeyExport, parseBitkeyExport } from '@hoseki/packages/wallet'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'
import { BitkeyKeyList, BitkeyUnverifiedNote } from './bitkey-notes'
import { BITKEY_PHONE_HEIGHT, BitkeyPhoneGuide, bitkeyExportSteps } from './bitkey-phone-steps'

type Step = { kind: 'intro' } | { kind: 'export'; index: number } | { kind: 'import' } | { kind: 'confirm' }

const lastExportIndex = bitkeyExportSteps.length - 1

interface ReadExport {
  text: string
  parsed: BitkeyExport
}

export function ConnectBitkey(): JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const [readExport, setReadExport] = useState<ReadExport | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'

  return (
    <ClaimConnectionWrapper pt={8}>
      <PageTransition key={step.kind}>
        {step.kind === 'intro' && (
          <Intro
            onBack={() => {
              void navigate(returnTo)
            }}
            onNext={() => {
              setStep({ kind: 'export', index: 0 })
            }}
          />
        )}
        {step.kind === 'export' && (
          <ExportStep
            index={step.index}
            onBack={() => {
              setStep(step.index === 0 ? { kind: 'intro' } : { kind: 'export', index: step.index - 1 })
            }}
            onNext={() => {
              setStep(step.index === lastExportIndex ? { kind: 'import' } : { kind: 'export', index: step.index + 1 })
            }}
          />
        )}
        {step.kind === 'import' && (
          <ImportDescriptor
            onBack={() => {
              setStep({ kind: 'export', index: lastExportIndex })
            }}
            onRead={(read) => {
              setReadExport(read)
              setStep({ kind: 'confirm' })
            }}
          />
        )}
        {step.kind === 'confirm' && readExport && (
          <ConfirmBitkey
            readExport={readExport}
            onBack={() => {
              setStep({ kind: 'import' })
            }}
          />
        )}
      </PageTransition>
    </ClaimConnectionWrapper>
  )
}

function Intro({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <Stack gap={4}>
      {/* The same height as the phone on the next steps, so the text doesn't jump. */}
      <Box h={`${BITKEY_PHONE_HEIGHT}px`} display="grid" placeItems="center">
        <FloatingBitkeyImage imageHeight="280px" pt={0} pb={0} />
      </Box>

      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Connect Your Bitkey
      </Text>
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
          <li>A way to send text to this computer, such as AirDrop, email, or a note</li>
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
        <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
          {step.title}
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          {step.body}
        </Text>
      </Stack>

      <NavigationArrows onBack={onBack} onForward={onNext} />
    </Stack>
  )
}

function ImportDescriptor({ onBack, onRead }: { onBack: () => void; onRead: (read: ReadExport) => void }) {
  const [fileDropStatus, setFileDropStatus] = useState<FileDropState>('ready')
  const [fileError, setFileError] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  function readText(text: string): Result<ReadExport, Error> {
    return parseBitkeyExport(text).map((parsed) => ({ text, parsed }))
  }

  return (
    <Stack gap={4}>
      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Add Your Wallet Descriptor
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Paste the text from the Bitkey app, or drop the file if you saved it. It starts with “External:”.
      </Text>

      <form
        id="bitkey-descriptor-form"
        onSubmit={(event) => {
          event.preventDefault()
          const result = readText(pasted)
          if (result.isOk()) {
            onRead(result.unwrap())
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

      <FileDropReader
        readAs="text"
        readyText="Or drag the saved file here"
        invalidText="That file isn’t a Bitkey wallet descriptor."
        validText="Success!"
        validationFn={(content) => readText(content)}
        onValidContentRead={(read) => {
          setFileError(null)
          onRead(read)
        }}
        onInvalidContentRead={(error) => {
          setFileError(error.message)
        }}
        acceptedFileTypes={['txt']}
        status={fileDropStatus}
        onStatusChange={setFileDropStatus}
      />
      {fileError !== null && (
        <Text textStyle="text/sm" color="error.600">
          {fileError}
        </Text>
      )}

      <TipAlert title="Keep it private">
        <Text color="neutral.800">
          The descriptor reveals every address and transaction in your Bitkey wallet. Only add it here, and delete the
          copy you sent once you’re done.
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

function ConfirmBitkey({ readExport, onBack }: { readExport: ReadExport; onBack: () => void }) {
  const navigate = useNavigate()
  const trpcUtils = trpc.useUtils()
  const createBitkey = trpc.portalProve.registry.claims.create.bitkey.useMutation()
  const [name, setName] = useState('Bitkey')
  const nameError = name.trim() === '' ? 'Name can not be empty' : name.length > 255 ? 'Name is too long' : null

  function addBitkey(): void {
    createBitkey.mutate(
      { descriptorExport: readExport.text, displayName: name.trim() },
      {
        onSuccess: ({ claim, alreadyConnected }) => {
          void trpcUtils.portalProve.registry.claims.list.invalidate()
          if (alreadyConnected) {
            toast.info('This Bitkey is already connected')
          }
          void navigate(`/accounts/${claim.id}`)
        },
        onError: (error) => {
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

  return (
    <Stack gap={4}>
      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        We Found Your Bitkey
      </Text>
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
            addBitkey()
          }
        }}
      >
        <FormControl isInvalid={nameError !== null}>
          <FormLabel htmlFor="bitkey-name">Name</FormLabel>
          <Input
            id="bitkey-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
          {nameError !== null && <FormErrorMessage>{nameError}</FormErrorMessage>}
        </FormControl>

        <Box mt={4}>
          <BitkeyUnverifiedNote isBrief />
        </Box>

        <WizardFooter
          leftButton={
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          }
          rightButton={
            <Button type="submit" isDisabled={nameError !== null} isLoading={createBitkey.isLoading}>
              Add Bitkey
            </Button>
          }
        />
      </form>
    </Stack>
  )
}
