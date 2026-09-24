import { Box, Button, FormControl, Input, Stack, Switch, Text } from '@chakra-ui/react'
import { SegmentedControl } from '@hoseki/packages/ui/design-system/forms/segmented-control'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { Bitcoin, ChevronRight, EyeOff, Rocket, SunMoon, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { type AppearancePreference, useAppearance } from '../../hooks/use-appearance'
import { useBitcoinDisplay } from '../../hooks/use-bitcoin-display'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { usePrivacy } from '../../hooks/use-privacy'
import { bitcoinDisplayUnit, formatBitcoin } from '../../lib/bitcoin-display'
import { isDesktop } from '../../mode'
import { ElectrumRow } from './electrum-settings'
import { SettingsGroup, SettingsRow } from './settings-rows'
import { WallpaperRow } from './wallpaper-settings'

export function SettingsPage(): JSX.Element {
  return (
    <Box py={{ base: 6, md: 10 }} maxW="880px">
      <PageHeading title="Settings" description="App preferences and personal information." />
      <Stack mt={{ base: 8, md: 10 }} spacing={7}>
        <SettingsGroup label="You">
          <NameRow tone={0} />
        </SettingsGroup>
        <SettingsGroup label="Look and feel">
          <AppearanceRow tone={1} />
          <WallpaperRow tone={2} />
          <PrivacyRow tone={3} />
        </SettingsGroup>
        <SettingsGroup label="Bitcoin">
          <BitcoinDisplayRow tone={4} />
        </SettingsGroup>
        <SettingsGroup label="Help">
          <Box
            as={Link}
            to="/getting-started"
            display="block"
            transition="background-color 150ms"
            _hover={{ bg: 'var(--edge-bg-hover)' }}
            _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '-2px' }}
          >
            <SettingsRow
              icon={Rocket}
              tone={5}
              title="Getting started"
              description="Learn how to track your Bitcoin with Control Center."
              control={<ChevronRight size={18} color="var(--hoseki-colors-text-tertiary)" aria-hidden />}
            />
          </Box>
        </SettingsGroup>
        {isDesktop && (
          <SettingsGroup label="Connection">
            <ElectrumRow tone={6} />
          </SettingsGroup>
        )}
      </Stack>
    </Box>
  )
}

function NameRow({ tone }: { tone: number }): JSX.Element {
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
    <SettingsRow
      icon={UserRound}
      tone={tone}
      title={<label htmlFor="user-name">Your name</label>}
      description="Used in your greeting and on generated statements."
      descriptionId="user-name-description"
      control={
        <Box
          as="form"
          display="flex"
          gap={2}
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <FormControl isDisabled={isLoading || isSaving || isError} w={{ base: 'full', md: '240px' }}>
            <Input
              id="user-name"
              autoComplete="name"
              aria-describedby="user-name-description"
              maxLength={200}
              placeholder="Enter your name"
              size="sm"
              value={name}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </FormControl>
          <Button
            type="submit"
            size="sm"
            isLoading={isSaving}
            loadingText="Saving"
            isDisabled={isLoading || isError || name.trim() === (savedName ?? '')}
          >
            Save name
          </Button>
        </Box>
      }
      footer={
        isError ? (
          <Text role="alert" textStyle="text/sm" color="status.error.fg">
            Could not load your name. Refresh to try again.
          </Text>
        ) : undefined
      }
    />
  )
}

const APPEARANCE_OPTIONS: ReadonlyArray<{ value: AppearancePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function AppearanceRow({ tone }: { tone: number }): JSX.Element {
  const { preference, setPreference } = useAppearance()
  return (
    <SettingsRow
      icon={SunMoon}
      tone={tone}
      title="Appearance"
      titleId="appearance-heading"
      description="Light or dark glass, or follow your device."
      descriptionId="appearance-description"
      control={
        <SegmentedControl
          name="appearance"
          value={preference}
          options={APPEARANCE_OPTIONS}
          onChange={setPreference}
          ariaLabel="Appearance"
          ariaDescribedBy="appearance-description"
        />
      }
    />
  )
}

function PrivacyRow({ tone }: { tone: number }): JSX.Element {
  const { hidden, toggle } = usePrivacy()
  return (
    <SettingsRow
      icon={EyeOff}
      tone={tone}
      title={<label htmlFor="hide-balances">Hide balances</label>}
      description="Mask amounts everywhere, for screen sharing or working in public. Also in the top-right corner."
      control={<Switch id="hide-balances" isChecked={hidden} onChange={toggle} size="lg" />}
    />
  )
}

const DISPLAY_OPTIONS = [
  { value: 'symbol', label: 'Bitcoin symbol' },
  { value: 'sats', label: 'Sats' },
  { value: 'btc', label: 'BTC' },
] as const

function BitcoinDisplayRow({ tone }: { tone: number }): JSX.Element {
  const { unit, saveAsync, isSaving, isLoading, isError } = useBitcoinDisplay()
  const handleChange = async (value: string): Promise<void> => {
    try {
      await saveAsync(bitcoinDisplayUnit(value))
      toast.success('Bitcoin display updated')
    } catch {
      toast.error('Could not save your display preference. Please try again.')
    }
  }

  return (
    <SettingsRow
      icon={Bitcoin}
      tone={tone}
      title="Bitcoin display"
      titleId="bitcoin-display-heading"
      description="The Bitcoin symbol and sats both show whole satoshi amounts. Each option previews 2.1 BTC."
      descriptionId="bitcoin-display-description"
      footer={
        <Stack spacing={3}>
          <SegmentedControl
            name="bitcoin-display"
            value={unit}
            onChange={(value) => void handleChange(value)}
            ariaLabel="Bitcoin display"
            ariaDescribedBy="bitcoin-display-description"
            isDisabled={isLoading || isSaving || isError}
            fullWidth
            options={DISPLAY_OPTIONS.map((option) => ({
              value: option.value,
              ariaLabel: option.label,
              label: (
                <Box as="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatBitcoin('2.1', option.value)}
                </Box>
              ),
            }))}
          />
          <Text textStyle="text/xs" color={isError ? 'status.error.fg' : 'text.secondary'} role="status">
            {isError
              ? 'Could not load your preference. Refresh to try again.'
              : isLoading
                ? 'Loading preference…'
                : isSaving
                  ? 'Saving preference…'
                  : 'Saved automatically on this Control Center.'}
          </Text>
        </Stack>
      }
    />
  )
}
