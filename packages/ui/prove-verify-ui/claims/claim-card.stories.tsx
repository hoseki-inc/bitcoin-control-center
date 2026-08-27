import { Box, Grid } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import Decimal from 'decimal.js'
import { ClaimCard, type ClaimCardKeystore } from './claim-card'
import { ClaimCardLoadingSkeleton } from './claim-card-loading-skeleton'

export default {
  title: 'Prove / Claims / Claim Card',
} satisfies StoryDefault

function dummyOfficialName(count: number) {
  return `Account #${count}`
}

export const AllWallets: Story = () => {
  return (
    <Grid templateColumns="repeat(3, 1fr)" gap={8} mb={16}>
      <ClaimCard
        officialName={dummyOfficialName(1)}
        displayName="Ledger Wallet"
        keystores={[{ id: '1', wallet: 'ledger' }]}
        status="pending"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(625420),
            current: new Decimal(625000000),
          },
        }}
        onClick={() => alert('Clicked')}
      />
      <ClaimCard
        officialName={dummyOfficialName(2)}
        displayName="Trezor Wallet"
        keystores={[{ id: '1', wallet: 'trezor' }]}
        status="verified"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(100),
            current: new Decimal(1000),
          },
        }}
        isSelected={false}
        onClick={() => alert('Clicked')}
      />
      <ClaimCard
        officialName={dummyOfficialName(3)}
        displayName="Coldcard Wallet"
        keystores={[{ id: '1', wallet: 'coldcard' }]}
        status="expired"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(100),
            current: new Decimal(1000),
          },
        }}
        isSelected={false}
        onClick={() => alert('Clicked')}
      />
      <ClaimCard
        officialName={dummyOfficialName(4)}
        displayName="Manual Wallet"
        keystores={[{ id: '1', wallet: null }]}
        status="verified"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(100),
            current: new Decimal(1000),
          },
        }}
        isSelected={false}
        onClick={() => alert('Clicked')}
      />
    </Grid>
  )
}

export const NoClickOrHover: Story = () => {
  return (
    <Grid templateColumns="repeat(3, 1fr)" gap={8} mb={16}>
      <ClaimCard
        officialName={dummyOfficialName(1)}
        displayName="Ledger Wallet"
        keystores={[{ id: '1', wallet: 'ledger' }]}
        status="pending"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(625420),
            current: new Decimal(625000000),
          },
        }}
        //onClick={() => alert('Clicked')} <-- no click
      />
    </Grid>
  )
}

export const LongName: Story = () => (
  <Box maxW="200px">
    <ClaimCard
      officialName={dummyOfficialName(5)}
      displayName="Wallet with a super duper long name"
      keystores={[{ id: '1', wallet: null }]}
      status="verified"
      balance={{
        status: 'success',
        value: {
          usd: new Decimal(100),
          current: new Decimal(1000),
        },
      }}
      isSelected={false}
      onClick={() => alert('Clicked')}
    />
  </Box>
)

export const Selected: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={8} mb={16}>
    <ClaimCard
      officialName={dummyOfficialName(6)}
      displayName="Whatever"
      keystores={[{ id: '1', wallet: 'trezor' }]}
      status="verified"
      balance={{
        status: 'success',
        value: {
          usd: new Decimal(100),
          current: new Decimal(1000),
        },
      }}
      isSelected={true}
      onClick={() => alert('Clicked')}
    />
  </Grid>
)

export const LoadingSkeleton: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={8} mb={16}>
    <ClaimCard
      officialName={dummyOfficialName(8)}
      displayName="Coldcard Wallet"
      keystores={[{ id: '1', wallet: 'coldcard' }]}
      status="verified"
      balance={{
        status: 'success',
        value: {
          usd: new Decimal(100),
          current: new Decimal(1000),
        },
      }}
      isSelected={false}
      onClick={() => alert('Clicked')}
    />
    <ClaimCardLoadingSkeleton />
    <ClaimCardLoadingSkeleton />
    <ClaimCardLoadingSkeleton />
  </Grid>
)

const keystores: ClaimCardKeystore[] = [
  { id: '1', wallet: 'ledger', isVerified: true },
  { id: '2', wallet: null, isVerified: false },
  { id: '3', wallet: 'coldcard', isVerified: false },
]

export const Multisig: Story = () => (
  <Grid templateColumns="repeat(3, minmax(0, 1fr))" gap={8} mb={16}>
    <ClaimCard
      officialName={dummyOfficialName(9)}
      displayName="My huge big fat stack"
      keystores={keystores}
      threshold={2}
      status="pending"
      balance={{
        status: 'success',
        value: {
          usd: new Decimal(100),
          current: new Decimal(1000),
        },
      }}
    />
    <ClaimCard
      officialName={dummyOfficialName(9)}
      displayName="Main MultiSig Vault"
      keystores={keystores}
      threshold={2}
      status="verified"
      balance={{
        status: 'success',
        value: {
          usd: new Decimal(100),
          current: new Decimal(1000),
        },
      }}
    />
    <ClaimCard
      officialName={dummyOfficialName(9)}
      displayName="MultiSig Lost in Boating Accident"
      keystores={[
        { id: '1', wallet: 'ledger', isVerified: true },
        { id: '2', wallet: 'trezor', isVerified: true },
        { id: '3', wallet: 'coldcard', isVerified: false },
      ]}
      threshold={3}
      status="expired"
      balance={{
        status: 'success',
        value: {
          usd: new Decimal(100),
          current: new Decimal(1000),
        },
      }}
    />
  </Grid>
)

export const Statuses: Story = () => {
  return (
    <Grid templateColumns="repeat(3, 1fr)" gap={8} mb={16}>
      <ClaimCard
        officialName={dummyOfficialName(10)}
        displayName="Pending Status"
        keystores={[{ id: '1', wallet: 'ledger' }]}
        status="pending"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(1000),
            current: new Decimal(10000),
          },
        }}
      />
      <ClaimCard
        officialName={dummyOfficialName(11)}
        displayName="Verified Status"
        keystores={[{ id: '1', wallet: 'trezor' }]}
        status="verified"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(2500),
            current: new Decimal(25000),
          },
        }}
      />
      <ClaimCard
        officialName={dummyOfficialName(12)}
        displayName="Expired Status"
        keystores={[{ id: '1', wallet: 'coldcard' }]}
        status="expired"
        balance={{
          status: 'success',
          value: {
            usd: new Decimal(500),
            current: new Decimal(5000),
          },
        }}
      />
    </Grid>
  )
}

export const BalanceLoading: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={8} mb={16}>
    <ClaimCard
      officialName={dummyOfficialName(13)}
      displayName="MyClaim"
      keystores={[{ id: '1', wallet: 'ledger' }]}
      status="verified"
      balance={{ status: 'loading' }}
    />
  </Grid>
)

export const BalanceFailed: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={8} mb={16}>
    <ClaimCard
      officialName={dummyOfficialName(14)}
      displayName="MyClaim"
      keystores={[{ id: '1', wallet: 'trezor' }]}
      status="verified"
      balance={{ status: 'fail' }}
    />
  </Grid>
)
