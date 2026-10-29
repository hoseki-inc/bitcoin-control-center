import {
  Box,
  Button,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Input,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { MultiSigAccount, SingleSigAccount, type SingleSigAccountScriptType } from '@hoseki/packages/bitcoin'
import { getRecordValue } from '@hoseki/packages/lib'
import { Result } from '@hoseki/packages/result'
import { RadioCardGroup } from '@hoseki/packages/ui/design-system'
import { getDefaultEncoding } from '@hoseki/packages/ui/design-system/forms/bitcoin-input-form-fields'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { encodingsToLabels, labelsToEncodings, monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { Slip132 } from '@hoseki/packages/wallet'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { createMultisigClaimInputFromDescriptor } from '../../../components/multisig/multisig-from-descriptor'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'
import type { CreateMultisigClaimInput } from '../../../trpc/server-types'

type TrackedWallet =
  | { kind: 'singlesig'; account: SingleSigAccount }
  | { kind: 'multisig'; input: CreateMultisigClaimInput; account: MultiSigAccount }

/**
 * A descriptor as Control Center saves it: key origins and checksum left out, and a receive or change branch, or
 * the /** shorthand, standing for both, since accounts are saved with each key's receive and change branches.
 */
function trackedForm(descriptor: string): string {
  const body = descriptor.split('#')[0] ?? descriptor
  return body.replace(/\[[^\]]*\]/g, '').replace(/\/(?:[01]\/\*|\*\*)/g, '/<0;1>/*')
}

/**
 * Whether a multisig descriptor tracks the addresses it describes: no Taproot script tree or Taproot multisig, and
 * every key followed only by its receive and change branches, not another branch or a single address. Keys must
 * all use the same branches, since each address combines every key's key at the same position.
 */
function isTrackableMultisig(descriptor: string): boolean {
  const body = trackedForm(descriptor)
  if (/\{|multi_a\(/.test(body)) {
    return false
  }
  const keys = body.match(/[a-zA-Z]pub[^,)]*/g) ?? []
  const asWritten = (descriptor.split('#')[0] ?? descriptor).replace(/\[[^\]]*\]/g, '')
  const branches = new Set(
    (asWritten.match(/[a-zA-Z]pub[^,)]*/g) ?? []).map((key) =>
      key.replace(/^[a-zA-Z]pub[1-9A-HJ-NP-Za-km-z]+/, '').replace('/**', '/<0;1>/*'),
    ),
  )
  return (
    keys.length > 1 &&
    branches.size === 1 &&
    keys.every((key) => /^[a-zA-Z]pub[1-9A-HJ-NP-Za-km-z]+\/<0;1>\/\*$/.test(key))
  )
}

/** Reads a multisig descriptor, a single-sig descriptor or an extended public key. */
export function parseTrackedWallet(raw: string, xpubScriptType: SingleSigAccountScriptType): TrackedWallet | null {
  const text = raw.trim()
  if (text.includes('multi(')) {
    if (!isTrackableMultisig(text)) {
      return null
    }
    // The importer also reads exports with Ypub or Zpub keys, but needs key origins.
    const imported = createMultisigClaimInputFromDescriptor(text, '').unwrapOr(null)
    const account = MultiSigAccount.fromDescriptor(imported?.account ?? text).unwrapOr(null)
    if (account === null) {
      return null
    }
    // Key origins are only needed to sign, so a descriptor without them is still enough to track.
    const keystores =
      imported?.keystores ??
      account.xpubs.map((xpub) => ({
        label: 'Key',
        derivationPath: null,
        publicKey: xpub.toString(),
        wallet: null,
        model: null,
      }))
    const input = { displayName: '', account: account.descriptor(), network: account.network().toString(), keystores }
    return { kind: 'multisig', input, account }
  }
  // A receive descriptor and its change descriptor can be pasted together; the first says enough.
  const first = text.split(/\s+/)[0] ?? text
  if (first.includes('(')) {
    const account = SingleSigAccount.fromDescriptor(first).unwrapOr(null)
    // The parser reads only the first key and its type, so anything else in the descriptor would be dropped.
    const isSavedAsWritten = account !== null && trackedForm(account.descriptor()) === trackedForm(first)
    return isSavedAsWritten ? { kind: 'singlesig', account } : null
  }
  // Uppercase prefixes such as Ypub and Zpub are one multisig cosigner's key, not a wallet of its own.
  if (/^[A-Z]pub/.test(text)) {
    return null
  }
  const xpub = Slip132.getXpubFromString(text).unwrapOr(null)
  return xpub === null ? null : { kind: 'singlesig', account: new SingleSigAccount(xpubScriptType, xpub) }
}

/** A plain xpub or tpub doesn't say which addresses it uses. */
function needsScriptType(raw: string): boolean {
  const text = raw.trim()
  return (text.startsWith('xpub') || text.startsWith('tpub')) && Slip132.getXpubFromString(text).isOk()
}

export function ClaimsVerifyTrackPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'

  const [displayName, setDisplayName] = useState('')
  const [raw, setRaw] = useState('')
  const [scriptType, setScriptType] = useState<SingleSigAccountScriptType>('p2pkh')
  const [isSaving, setIsSaving] = useState(false)

  const utils = trpc.useUtils()
  const createSinglesig = trpc.portalProve.registry.claims.create.singlesig.useMutation()
  const createMultisig = trpc.portalProve.registry.claims.create.multisig.useMutation()
  const trackExisting = trpc.portalProve.registry.claims.track.useMutation()

  const wallet = parseTrackedWallet(raw, scriptType)
  const isInvalid = raw.trim() !== '' && wallet === null
  const isValid = displayName.trim().length > 0 && wallet !== null

  async function handleSubmit(): Promise<void> {
    if (!isValid) {
      return
    }
    setIsSaving(true)
    const name = displayName.trim()
    const network = wallet.account.network().toString()
    const descriptor = wallet.account.descriptor()

    const existing = await Result.fromPromise(
      utils.portalProve.registry.claims.get.byAccount.fetch({ network, account: descriptor }),
    )
    if (existing.isOk()) {
      const claim = existing.unwrap()
      // Someone who started proving this wallet but now chooses to track it no longer has anything to do.
      if (claim.status === 'pending' && !claim.isArchived) {
        const tracked = await Result.fromPromise(trackExisting.mutateAsync({ id: claim.id }))
        if (tracked.isErr()) {
          setIsSaving(false)
          toast.error("Couldn't add this wallet", { description: tracked.unwrapErr().message })
          return
        }
        await utils.portalProve.registry.claims.invalidate()
      }
      toast.info('This wallet is already in Control Center')
      void navigate(claim.isArchived ? '/accounts#archived' : `/accounts/${claim.id}`)
      return
    }

    const created = await Result.fromPromise(
      wallet.kind === 'multisig'
        ? createMultisig.mutateAsync({ ...wallet.input, displayName: name, trackOnly: true })
        : createSinglesig.mutateAsync({
            network,
            account: wallet.account.descriptor(),
            displayName: name,
            keystore: { label: 'Default Keystore', wallet: null, model: null, derivationPath: null },
            trackOnly: true,
          }),
    )
    if (created.isErr()) {
      setIsSaving(false)
      toast.error("Couldn't add this wallet", { description: created.unwrapErr().message })
      return
    }

    await utils.portalProve.registry.claims.invalidate()
    await utils.portalProve.controlCenter.invalidate()
    toast.success('Wallet added')
    void navigate(`/accounts/${created.unwrap().claim.id}`)
  }

  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to={returnTo}>
          Back
        </TopBar.Item>
      </TopBar>

      <Stack spacing={6} maxW="480px" mx="auto">
        <PageHeading
          title="Track an xpub or Descriptor"
          description="Enter an xpub or descriptor below to track its balance."
        />

        <FormControl>
          <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
            Display Name
          </FormLabel>
          <Input
            placeholder="e.g. Sparrow, Family Multisig"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
            }}
          />
        </FormControl>

        <FormControl isInvalid={isInvalid}>
          <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
            xpub or Descriptor
          </FormLabel>
          <Textarea
            rows={4}
            placeholder="zpub…, wpkh([…]xpub…) or wsh(sortedmulti(2,…))"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              // Keep the type someone picked for a plain xpub; other keys say their own.
              if (!needsScriptType(e.target.value)) {
                setScriptType(getDefaultEncoding(e.target.value.trim()))
              }
            }}
            sx={{ resize: 'none' }}
            {...monoInputProps}
          />
          {wallet !== null && (
            <Text textStyle="label/sm" color="neutral.500" mt={1}>
              {wallet.kind === 'multisig'
                ? `Multisig, ${wallet.account.threshold} of ${wallet.account.xpubs.length}`
                : `Single-sig, ${encodingsToLabels[wallet.account.scriptType]}`}
            </Text>
          )}
          <FormErrorMessage>Enter an xpub, or a single-sig or multisig descriptor</FormErrorMessage>
        </FormControl>

        {needsScriptType(raw) && (
          <FormControl>
            <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium">
              Script Type
            </FormLabel>
            <RadioCardGroup
              options={Object.keys(labelsToEncodings)}
              name="script-type"
              value={encodingsToLabels[scriptType]}
              onChange={(label: string) => {
                setScriptType(getRecordValue(labelsToEncodings, label) ?? 'p2pkh')
              }}
            />
          </FormControl>
        )}

        <Flex justify="flex-end">
          <Button
            onClick={() => {
              void handleSubmit()
            }}
            isLoading={isSaving}
            isDisabled={!isValid}
          >
            Track Wallet
          </Button>
        </Flex>
      </Stack>
    </Box>
  )
}
