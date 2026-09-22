import { Grid } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import Decimal from 'decimal.js'
import { AssetCard } from './asset-card'

export default {
  title: 'Design System / Asset Card',
} satisfies StoryDefault

export const USDC: Story = () => (
  <AssetCard currency="USDC" balance={new Decimal('1234.56')} usdBalance={new Decimal('1234.56')} />
)

export const USDT: Story = () => (
  <AssetCard currency="USDT" balance={new Decimal('5678.90')} usdBalance={new Decimal('5678.90')} />
)

export const ETH: Story = () => (
  <AssetCard currency="ETH" balance={new Decimal('11.8')} usdBalance={new Decimal('34546.82')} />
)

export const SmallAmounts: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={4}>
    <AssetCard currency="USDC" balance={new Decimal('0.01')} usdBalance={new Decimal('0.01')} />
    <AssetCard currency="USDT" balance={new Decimal('1.00')} usdBalance={new Decimal('1.00')} />
    <AssetCard currency="ETH" balance={new Decimal('0.001')} usdBalance={new Decimal('2.89')} />
  </Grid>
)

export const LargeAmounts: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={4}>
    <AssetCard currency="USDC" balance={new Decimal('1234567.89')} usdBalance={new Decimal('1234567.89')} />
    <AssetCard currency="USDT" balance={new Decimal('999999.99')} usdBalance={new Decimal('999999.99')} />
    <AssetCard currency="ETH" balance={new Decimal('1234.5678')} usdBalance={new Decimal('3456789.01')} />
  </Grid>
)

export const AllCurrencies: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={4}>
    <AssetCard currency="USDC" balance={new Decimal('1234.56')} usdBalance={new Decimal('1234.56')} />
    <AssetCard currency="USDT" balance={new Decimal('5678.90')} usdBalance={new Decimal('5678.90')} />
    <AssetCard currency="ETH" balance={new Decimal('11.8')} usdBalance={new Decimal('34546.82')} />
  </Grid>
)

export const WithClick: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={4}>
    <AssetCard
      currency="USDC"
      balance={new Decimal('1234.56')}
      usdBalance={new Decimal('1234.56')}
      onClick={() => {
        alert('USDC clicked')
      }}
    />
    <AssetCard
      currency="USDT"
      balance={new Decimal('5678.90')}
      usdBalance={new Decimal('5678.90')}
      onClick={() => {
        alert('USDT clicked')
      }}
    />
    <AssetCard
      currency="ETH"
      balance={new Decimal('11.8')}
      usdBalance={new Decimal('34546.82')}
      onClick={() => {
        alert('ETH clicked')
      }}
    />
  </Grid>
)

export const ZeroBalances: Story = () => (
  <Grid templateColumns="repeat(3, 1fr)" gap={4}>
    <AssetCard currency="USDC" balance={new Decimal('0')} usdBalance={new Decimal('0')} />
    <AssetCard currency="USDT" balance={new Decimal('0')} usdBalance={new Decimal('0')} />
    <AssetCard currency="ETH" balance={new Decimal('0')} usdBalance={new Decimal('0')} />
  </Grid>
)
