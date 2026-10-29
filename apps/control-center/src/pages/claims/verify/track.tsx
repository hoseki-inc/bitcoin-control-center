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
import type { SingleSigAccountScriptType } from '@hoseki/packages/bitcoin'
import { getRecordValue } from '@hoseki/packages/lib'
import { Ok, Result } from '@hoseki/packages/result'
import { RadioCardGroup } from '@hoseki/packages/ui/design-system'
import { getDefaultEncoding } from '@hoseki/packages/ui/design-system/forms/bitcoin-input-form-fields'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { encodingsToLabels, labelsToEncodings, monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'
import { type TrackedWallet, isPlainXpub, parseTrackedWallet } from './tracked-wallet'

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

  /** Saves the wallet, or tracks the one already here, and says where it now opens. */
  async function save(tracked: TrackedWallet, name: string): Promise<Result<{ path: string; isNew: boolean }, Error>> {
    const network = tracked.account.network().toString()
    const account = tracked.account.descriptor()
    const existing = await Result.fromPromise(
      utils.portalProve.registry.claims.get.byAccount.fetch({ network, account }),
    )
    if (existing.isOk()) {
      const claim = existing.unwrap()
      const path = claim.isArchived ? '/accounts#archived' : `/accounts/${claim.id}`
      // Someone who started proving this wallet but now chooses to track it no longer has anything to do.
      if (claim.status !== 'pending' || claim.isArchived) {
        return Ok({ path, isNew: false })
      }
      return Result.fromPromise(
        trackExisting.mutateAsync({ id: claim.id }).then(async () => utils.portalProve.registry.claims.invalidate()),
      ).map(() => ({ path, isNew: false }))
    }
    return Result.fromPromise(
      (tracked.kind === 'multisig'
        ? createMultisig.mutateAsync({
            displayName: name,
            account: tracked.account.descriptor(),
            network,
            keystores: tracked.keystores,
            trackOnly: true,
          })
        : createSinglesig.mutateAsync({
            network,
            account: tracked.account.descriptor(),
            displayName: name,
            keystore: { label: 'Default Keystore', wallet: null, model: null, derivationPath: null },
            trackOnly: true,
          })
      ).then(async (created) => {
        await Promise.all([
          utils.portalProve.registry.claims.invalidate(),
          utils.portalProve.controlCenter.invalidate(),
        ])
        return { path: `/accounts/${created.claim.id}`, isNew: true }
      }),
    )
  }

  async function handleSubmit(): Promise<void> {
    if (!isValid) {
      return
    }
    setIsSaving(true)
    const saved = await save(wallet, displayName.trim())
    if (saved.isErr()) {
      setIsSaving(false)
      toast.error("Couldn't add this wallet", { description: saved.unwrapErr().message })
      return
    }
    const { path, isNew } = saved.unwrap()
    if (isNew) {
      toast.success('Wallet added')
    } else {
      toast.info('This wallet is already in Control Center')
    }
    void navigate(path)
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
              if (!isPlainXpub(e.target.value)) {
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

        {isPlainXpub(raw) && (
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
