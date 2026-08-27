import { Select, Stack, Text } from '@chakra-ui/react'
import { type Story, type StoryDefault } from '@ladle/react'
import { useState } from 'react'
import { type Keystore, KeystoresStatusIndicator } from './keystores-status-indicator'

export default {
  title: 'Prove / Claims / Keystores Status Indicator',
} satisfies StoryDefault

function getKeystoreClickHandler() {
  return (clickedKeystore: Keystore) => {
    console.log('Keystore clicked:', clickedKeystore)
  }
}

function WithControls(props: { keystores: Keystore[] }) {
  const [expandedKeystoreId, setExpandedKeystoreId] = useState<string | null>(null)
  return (
    <Stack>
      <KeystoresStatusIndicator
        keystores={props.keystores}
        expandedKeystoreId={expandedKeystoreId}
        getKeystoreClickHandler={getKeystoreClickHandler}
        threshold={props.keystores.length - 1}
        tooltipVariant="none"
      />
      <Stack>
        <Text>Expanded Keystore Name: {expandedKeystoreId}</Text>
        <Select
          placeholder="Select a keystore"
          onChange={(value) => {
            setExpandedKeystoreId(value.target.value)
          }}
        >
          {props.keystores.map((keystore) => (
            <option key={keystore.id} value={keystore.id}>
              {keystore.name}
            </option>
          ))}
        </Select>
      </Stack>
    </Stack>
  )
}

export const Default: Story = () => {
  const keystores0 = [
    { id: '1', wallet: null, name: 'Keystore 1', status: 'pending' },
    { id: '2', wallet: null, name: 'Keystore 3', status: 'pending' },
    { id: '3', wallet: null, name: 'Keystore 2', status: 'pending' },
  ] as const satisfies Keystore[]
  const keystores1 = [
    { id: '1', wallet: null, name: 'Keystore 3', status: 'pending' },
    { id: '2', wallet: null, name: 'Keystore 2', status: 'pending' },
    { id: '3', wallet: 'ledger', name: 'Ledger', status: 'identified' },
  ] as const satisfies Keystore[]
  const keystores2 = [
    { id: '1', wallet: null, name: 'Keystore 3', status: 'pending' },
    { id: '2', wallet: 'coldcard', name: 'Coldcard', status: 'identified' },
    { id: '3', wallet: 'ledger', name: 'Ledger', status: 'verified' },
  ] as const satisfies Keystore[]

  return (
    <Stack gap={24}>
      <WithControls keystores={keystores0} />
      <WithControls keystores={keystores1} />
      <WithControls keystores={keystores2} />
    </Stack>
  )
}

export const WithVeryLongKeystoreName: Story = () => {
  const [expandedKeystoreId, setExpandedKeystoreId] = useState<string | null>(null)
  const keystores = [
    { id: '1', wallet: 'trezor', name: 'Big name for a keystore because i like to be verbose', status: 'identified' },
    {
      id: '2',
      wallet: 'coldcard',
      name: 'Huge name for my Coldcard that i hold thousands of bitcoins in',
      status: 'verified',
    },
  ] as const satisfies Keystore[]

  return (
    <Stack gap={24}>
      <KeystoresStatusIndicator
        keystores={keystores}
        expandedKeystoreId={expandedKeystoreId}
        getKeystoreClickHandler={getKeystoreClickHandler}
        threshold={keystores.length - 1}
        tooltipVariant="none"
      />
      <Stack>
        <Text>Expanded Keystore Name: {expandedKeystoreId}</Text>
        {/* Controll inputs */}
        <Select
          placeholder="Select a keystore"
          onChange={(value) => {
            setExpandedKeystoreId(value.target.value)
          }}
        >
          {keystores.map((keystore) => (
            <option key={keystore.id} value={keystore.id}>
              {keystore.name}
            </option>
          ))}
        </Select>
      </Stack>
    </Stack>
  )
}

export const WithALargeNumberOfKeystores: Story = () => {
  const keystores: Keystore[] = Array.from({ length: 8 }, (_, index) => ({
    id: index.toString(),
    wallet: null,
    name: `Keystore ${index}`,
    status: 'pending',
  }))

  return (
    <KeystoresStatusIndicator
      keystores={keystores}
      expandedKeystoreId={keystores[0]?.id ?? null}
      getKeystoreClickHandler={getKeystoreClickHandler}
      threshold={keystores.length - 1}
      tooltipVariant="none"
    />
  )
}

export const WithTooltip: Story = () => {
  const keystores: Keystore[] = Array.from({ length: 3 }, (_, index) => ({
    id: index.toString(),
    wallet: null,
    name: `Keystore ${index}`,
    status: 'pending',
  }))

  return (
    <KeystoresStatusIndicator
      keystores={keystores}
      expandedKeystoreId={keystores[0]?.id ?? null}
      getKeystoreClickHandler={getKeystoreClickHandler}
      threshold={keystores.length - 1}
      tooltipVariant="pending"
    />
  )
}
