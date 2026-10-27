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
} from '@chakra-ui/react'
import type { Result } from '@hoseki/packages/result'
import { FileDropReader, type FileDropState, PageTransition } from '@hoseki/packages/ui/design-system'
import { TipAlert } from '@hoseki/packages/ui/design-system/feedback/tip-alert'
import { monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { ClaimConnectionWrapper, FloatingBitkeyImage, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { type BitkeyExport, parseBitkeyExport } from '@hoseki/packages/wallet'
import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'
import { BitkeyKeyList, BitkeyUnverifiedNote } from './bitkey-notes'
import { BitkeyPhoneSteps } from './bitkey-phone-steps'

type Step = 'intro' | 'export' | 'import' | 'confirm'

interface ReadExport {
  text: string
  parsed: BitkeyExport
}

export function ConnectBitkey(): JSX.Element {
  const [step, setStep] = useState<Step>('intro')
  const [readExport, setReadExport] = useState<ReadExport | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'

  return (
    <ClaimConnectionWrapper pt={8}>
      <PageTransition key={step}>
        {step === 'intro' && (
          <Intro
            onBack={() => {
              void navigate(returnTo)
            }}
            onNext={() => {
              setStep('export')
            }}
          />
        )}
        {step === 'export' && (
          <ExportInstructions
            onBack={() => {
              setStep('intro')
            }}
            onNext={() => {
              setStep('import')
            }}
          />
        )}
        {step === 'import' && (
          <ImportDescriptor
            onBack={() => {
              setStep('export')
            }}
            onRead={(read) => {
              setReadExport(read)
              setStep('confirm')
            }}
          />
        )}
        {step === 'confirm' && readExport && (
          <ConfirmBitkey
            readExport={readExport}
            onBack={() => {
              setStep('import')
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
      <FloatingBitkeyImage />

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

function ExportInstructions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
          Export Your Wallet Descriptor
        </Text>
        <Text textStyle="text/md" color="neutral.900">
          In the Bitkey app, the descriptor is called an XPUB bundle. Your phone shares it as text.
        </Text>
      </Stack>

      <BitkeyPhoneSteps />

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>I Have It</Button>}
      />
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
        <Stack gap={3}>
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
          <Button type="submit" alignSelf="flex-end" isDisabled={pasted.trim() === ''}>
            Continue
          </Button>
        </Stack>
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

      <TipAlert title="Keep it private" icon={CircleAlert}>
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
        It’s a 2-of-3 wallet. Any two of these keys can move your bitcoin; Control Center holds none of them.
      </Text>

      <BitkeyKeyList
        keys={readExport.parsed.keys.map((key) => ({ role: key.role, xpub: key.keyExpression.xpub.toString() }))}
      />

      <BitkeyUnverifiedNote />

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
