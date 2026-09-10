import { Box, Button, HStack, Radio, RadioGroup, Spinner, Stack, Text } from '@chakra-ui/react'
import { WalletAnimation, WizardFooter } from '@hoseki/packages/ui/wallet-ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { LedgerHidApi, LedgerHidUpdate } from '../../../../../../desktop/src/ledger-hid-api'
import { useLedgerStore } from '../../../hooks/use-ledger-store'
import { ledgerConnectionMessage } from '../../../lib/desktop-ledger'
import { closeDesktopLedger, openDesktopLedger } from '../../../lib/open-desktop-ledger'
import { browserLogger } from '../../../logger'

type State =
  | { phase: 'idle' | 'searching' | 'connecting' | 'cancelling' | 'ready' }
  | { phase: 'choosing'; devices: LedgerHidUpdate['devices'] }
  | { phase: 'error'; title: string; detail: string }

type Attempt = { id: string; abort: AbortController; expired: boolean }

export function DesktopLedgerConnection({
  bridge,
  onBack,
  onContinue,
}: {
  bridge: LedgerHidApi
  onBack?: () => void
  onContinue: () => void
}): JSX.Element {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [selected, setSelected] = useState('')
  const attempt = useRef<Attempt | null>(null)
  const queryClient = useQueryClient()
  const init = useLedgerStore((store) => store.init)
  const reset = useLedgerStore((store) => store.reset)
  const isConnected = useLedgerStore((store) => store.isConnected)
  const deviceModel = useLedgerStore((store) => store.deviceModel)

  useEffect(() => {
    const unsubscribe = bridge.subscribe((update) => {
      const current = attempt.current
      if (!current || update.requestId !== current.id || current.abort.signal.aborted) return
      if (update.status === 'expired') {
        current.expired = true
        setState({
          phase: 'error',
          title: 'Connection timed out',
          detail: 'Check your Ledger and try connecting again.',
        })
      } else if (update.status === 'connecting') {
        setState({ phase: 'connecting' })
      } else if (update.status === 'choosing') {
        setSelected((previous) =>
          update.devices.length === 1
            ? (update.devices[0]?.id ?? '')
            : update.devices.some((device) => device.id === previous)
              ? previous
              : '',
        )
        setState({ phase: 'choosing', devices: update.devices })
      }
    })
    return () => {
      unsubscribe()
      const current = attempt.current
      attempt.current = null
      current?.abort.abort()
      if (current) bridge.cancel(current.id)
    }
  }, [bridge])

  useEffect(() => {
    if (state.phase === 'ready' && !isConnected) {
      setState({
        phase: 'error',
        title: 'Your Ledger was disconnected',
        detail: 'Reconnect and unlock the device, then open the Bitcoin app.',
      })
    }
  }, [isConnected, state.phase])

  function cancel(): void {
    const current = attempt.current
    current?.abort.abort()
    if (current) bridge.cancel(current.id)
    setSelected('')
    setState({ phase: current ? 'cancelling' : 'idle' })
  }

  async function connect(): Promise<void> {
    if (attempt.current) return
    const current: Attempt = { id: crypto.randomUUID(), abort: new AbortController(), expired: false }
    attempt.current = current
    setState({ phase: 'searching' })
    setSelected('')
    const active = (): boolean => attempt.current === current && !current.abort.signal.aborted
    try {
      await queryClient.cancelQueries({ queryKey: ['ledger-wallets'] })
      queryClient.removeQueries({ queryKey: ['ledger-wallets'] })
      if (!active()) return
      await reset(closeDesktopLedger)
      if (!active()) return
      const accepted = await bridge.begin(current.id)
      if (!active()) {
        bridge.cancel(current.id)
        return
      }
      if (!accepted) {
        setState({
          phase: 'error',
          title: 'A connection is already in progress',
          detail: 'Finish or cancel the other connection, then try again.',
        })
        return
      }
      await init(() => openDesktopLedger(current.abort.signal), current.abort.signal)
      if (active()) {
        browserLogger.info('Desktop Ledger connected')
        setState({ phase: 'ready' })
      }
    } catch (error) {
      if (active() && !current.expired) {
        const message = ledgerConnectionMessage(error)
        browserLogger.warn({ reason: message.title }, 'Desktop Ledger connection failed')
        setState({ phase: 'error', ...message })
      }
    } finally {
      // Only release the reservation once requestDevice has settled (or was never called).
      bridge.end(current.id)
      if (attempt.current === current) {
        attempt.current = null
        if (current.abort.signal.aborted) setState({ phase: 'idle' })
      }
    }
  }

  const devices = state.phase === 'choosing' ? state.devices : []
  const missing = state.phase === 'choosing' && devices.length === 0
  const busy = ['searching', 'choosing', 'connecting', 'cancelling'].includes(state.phase)
  const duplicateName = devices.some(
    (device, index) => devices.findIndex((other) => other.name === device.name) !== index,
  )
  const selectedDevice = devices.find((device) => device.id === selected)
  const canSelect = !!selectedDevice && devices.filter((device) => device.name === selectedDevice.name).length === 1

  async function choose(): Promise<void> {
    const current = attempt.current
    if (current && canSelect) {
      try {
        await bridge.choose(current.id, selected)
      } catch {
        cancel()
      }
    }
  }

  const title =
    state.phase === 'error'
      ? state.title
      : state.phase === 'ready'
        ? `${deviceModel?.productName ?? 'Ledger'} is connected`
        : missing
          ? 'No Ledger detected'
          : state.phase === 'choosing'
            ? 'Choose a Ledger'
            : state.phase === 'cancelling'
              ? 'Cancelling connection…'
              : state.phase === 'connecting'
                ? 'Connecting to your Ledger…'
                : 'Looking for your Ledger…'
  const detail =
    state.phase === 'error'
      ? state.detail
      : state.phase === 'ready'
        ? 'Continue to find your Bitcoin accounts.'
        : missing
          ? 'Check your USB connection and unlock your Ledger. This screen will update when it appears.'
          : duplicateName
            ? 'These devices have the same name. Unplug the Ledger you don’t want to use so you can tell them apart.'
            : state.phase === 'choosing'
              ? 'Select the Ledger you want to connect.'
              : 'Keep your Ledger connected and unlocked, with the Bitcoin app open.'

  return (
    <>
      <WalletAnimation animation="ledgerPlugIn" />
      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Connect your Ledger
      </Text>
      <Text textStyle="text/md" color="neutral.700">
        Connect via USB, unlock your Ledger with your PIN, and open the Bitcoin app.
      </Text>
      {state.phase !== 'idle' && (
        <Box
          bg="neutral.50"
          borderRadius="lg"
          p={5}
          my={3}
          role={state.phase === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <HStack align="start" spacing={3}>
            {(state.phase === 'searching' || state.phase === 'connecting') && <Spinner size="sm" mt={1} />}
            <Stack spacing={2} flex={1}>
              <Text textStyle="text/md" fontWeight="medium" color="neutral.900">
                {title}
              </Text>
              <Text textStyle="text/sm" color="neutral.700">
                {detail}
              </Text>
              {devices.length > 1 && (
                <RadioGroup value={selected} onChange={setSelected} aria-label="Available Ledgers">
                  <Stack spacing={3} mt={2}>
                    {devices.map((device) => (
                      <Radio
                        key={device.id}
                        value={device.id}
                        isDisabled={devices.filter((other) => other.name === device.name).length > 1}
                      >
                        {device.name}
                      </Radio>
                    ))}
                  </Stack>
                </RadioGroup>
              )}
            </Stack>
          </HStack>
        </Box>
      )}
      <Stack spacing={2} my={3}>
        <Text textStyle="text/md" color="neutral.900" fontWeight="medium">
          Your private keys stay private.
        </Text>
        <Text textStyle="text/sm" color="neutral.700">
          We use the official Ledger SDK to access public account information. Your private keys never leave your
          Ledger, and ownership proofs require your approval on the device.
        </Text>
      </Stack>
      <Box as="details" color="neutral.700" my={3}>
        <Box as="summary" cursor="pointer" textStyle="text/sm">
          Connection help
        </Box>
        <Text textStyle="text/sm" mt={2}>
          Use a USB cable that supports data. If the connection fails, check whether Ledger Live or another wallet app
          is using your Ledger.
        </Text>
      </Box>
      <WizardFooter
        leftButton={
          busy ? (
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          ) : onBack ? (
            <Button
              variant="outline"
              onClick={() => {
                cancel()
                onBack()
              }}
            >
              Back
            </Button>
          ) : undefined
        }
        rightButton={
          state.phase === 'ready' ? (
            <Button onClick={onContinue}>Continue</Button>
          ) : state.phase === 'choosing' && !missing ? (
            <Button onClick={() => void choose()} isDisabled={!canSelect}>
              Connect selected Ledger
            </Button>
          ) : (
            <Button
              onClick={() => void connect()}
              isDisabled={busy}
              isLoading={state.phase === 'connecting' || state.phase === 'searching'}
            >
              {missing ? 'Waiting for Ledger' : state.phase === 'error' ? 'Try again' : 'Connect Ledger'}
            </Button>
          )
        }
      />
    </>
  )
}
