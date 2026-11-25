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
import { Ok, Result } from '@hoseki/packages/result'
import { ScriptTypeRadioGroup, getUniqueFundedScriptType } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { encodingsToLabels, monoInputProps } from '@hoseki/packages/ui/utils/bitcoin'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'
import { type TrackedWallet, isPlainXpub, parseTrackedWallet } from './tracked-wallet'
import { useXpubScriptBalances } from './use-xpub-script-balances'

export function ClaimsVerifyTrackPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'

  const [displayName, setDisplayName] = useState('')
  const [raw, setRaw] = useState('')
  const [pickedScriptType, setPickedScriptType] = useState<SingleSigAccountScriptType | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const utils = trpc.useUtils()
  const createSinglesig = trpc.portalProve.accounts.create.singlesig.useMutation()
  const createMultisig = trpc.portalProve.accounts.create.multisig.useMutation()
  const trackExisting = trpc.portalProve.accounts.track.useMutation()

  const plain = isPlainXpub(raw)
  const { balances: scriptTypeBalances, isScanning } = useXpubScriptBalances(raw)
  const effectiveScriptType = plain ? (pickedScriptType ?? getUniqueFundedScriptType(scriptTypeBalances)) : null
  const wallet = parseTrackedWallet(raw, effectiveScriptType)
  const isInvalid = raw.trim() !== '' && !plain && wallet === null
  const isValid = displayName.trim().length > 0 && wallet !== null

  /** Saves the wallet, or tracks the one already here, and says where it now opens. */
  async function save(tracked: TrackedWallet, name: string): Promise<Result<{ path: string; isNew: boolean }, Error>> {
    const network = tracked.account.network().toString()
    const account = tracked.account.descriptor()
    const existing = await Result.fromPromise(utils.portalProve.accounts.get.byAccount.fetch({ network, account }))
    if (existing.isOk()) {
      const claim = existing.unwrap()
      const path = claim.isArchived ? '/accounts#archived' : `/accounts/${claim.id}`
      // Someone who started proving this wallet but now chooses to track it no longer has anything to do.
      if (claim.status !== 'pending' || claim.isArchived) {
        return Ok({ path, isNew: false })
      }
      return Result.fromPromise(
        trackExisting.mutateAsync({ id: claim.id }).then(async () => utils.portalProve.accounts.invalidate()),
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
          utils.portalProve.accounts.invalidate(),
          utils.portalProve.portfolio.invalidate(),
          utils.portalProve.onchain.walletBalances.invalidate(),
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
              const nextRaw = e.target.value
              setRaw(nextRaw)
              if (nextRaw.trim() !== raw.trim()) {
                setPickedScriptType(null)
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

        {plain && (
          <FormControl>
            <Flex align="center" justify="space-between" gap={2} mb={2}>
              <FormLabel textStyle="text/sm" color="neutral.600" fontWeight="medium" mb={0}>
                Script Type
              </FormLabel>
              {isScanning && (
                <Text textStyle="label/xs" color="neutral.500">
                  Checking Electrum…
                </Text>
              )}
            </Flex>
            <ScriptTypeRadioGroup
              name="script-type"
              value={effectiveScriptType}
              onChange={setPickedScriptType}
              balances={scriptTypeBalances}
              isTestnet={raw.trim().startsWith('tpub')}
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
