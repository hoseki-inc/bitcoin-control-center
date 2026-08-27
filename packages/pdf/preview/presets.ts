import { Decimal } from 'decimal.js'
import type { PdfStatement } from '../../schemas'

export const sampleCustomStatement: PdfStatement = {
  id: 'st_stmt_samplestatement123',
  createdAt: new Date('2024-01-15T10:30:00Z'),
  status: 'completed',
  counter: 42,
  timezone: 'UTC',
  format: 'custom',
  currency: 'BTC',
  user: {
    email: 'mathhew.powell@example.com',
    name: 'Matthew Powell',
    address: '456 Oak Avenue, San Francisco, CA 94102, United States',
  },
  summary: {
    openingDate: new Date('2024-01-01T00:00:00Z'),
    closingDate: new Date('2024-01-31T23:59:59Z'),
    openingBalance: {
      sats: 250000000n, // 2.5 BTC
      usdValue: new Decimal(112500),
      rate: new Decimal(45000),
      timestamp: new Date('2024-01-01T00:00:00Z'),
      provider: 'coingecko',
    },
    closingBalance: {
      sats: 293000000n, // 2.93 BTC
      usdValue: new Decimal(131850),
      rate: new Decimal(45000),
      timestamp: new Date('2024-01-31T23:59:59Z'),
      provider: 'coingecko',
    },
    moneyIn: {
      sats: 54000000n, // 0.54 BTC
      usdValue: new Decimal(24300),
      rate: new Decimal(45000),
      timestamp: new Date('2024-01-15T12:00:00Z'),
      provider: 'coingecko',
    },
    moneyOut: {
      sats: 11000000n, // 0.11 BTC
      usdValue: new Decimal(4950),
      rate: new Decimal(45000),
      timestamp: new Date('2024-01-25T14:00:00Z'),
      provider: 'coingecko',
    },
    entries: [
      {
        displayName: 'Main Wallet',
        openingBalance: {
          sats: 100000000n, // 1 BTC
          usdValue: new Decimal(45000),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-01T00:00:00Z'),
          provider: 'coingecko',
        },
        closingBalance: {
          sats: 133000000n, // 1.33 BTC
          usdValue: new Decimal(59850),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-31T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyIn: {
          sats: 44000000n, // 0.44 BTC
          usdValue: new Decimal(19800),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-15T12:00:00Z'),
          provider: 'coingecko',
        },
        moneyOut: {
          sats: 11000000n, // 0.11 BTC
          usdValue: new Decimal(4950),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-25T14:00:00Z'),
          provider: 'coingecko',
        },
      },
      {
        displayName: 'Savings Account',
        openingBalance: {
          sats: 100000000n, // 1 BTC
          usdValue: new Decimal(45000),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-01T00:00:00Z'),
          provider: 'coingecko',
        },
        closingBalance: {
          sats: 110000000n, // 1.1 BTC
          usdValue: new Decimal(49500),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-31T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyIn: {
          sats: 10000000n, // 0.1 BTC
          usdValue: new Decimal(4500),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-20T10:00:00Z'),
          provider: 'coingecko',
        },
        moneyOut: {
          sats: 0n,
          usdValue: new Decimal(0),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-31T23:59:59Z'),
          provider: 'coingecko',
        },
      },
      {
        displayName: 'Trading Account',
        openingBalance: {
          sats: 50000000n, // 0.5 BTC
          usdValue: new Decimal(22500),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-01T00:00:00Z'),
          provider: 'coingecko',
        },
        closingBalance: {
          sats: 50000000n, // 0.5 BTC
          usdValue: new Decimal(22500),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-31T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyIn: {
          sats: 0n,
          usdValue: new Decimal(0),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-31T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyOut: {
          sats: 0n,
          usdValue: new Decimal(0),
          rate: new Decimal(45000),
          timestamp: new Date('2024-01-31T23:59:59Z'),
          provider: 'coingecko',
        },
      },
    ],
  },
  statementEntries: [
    {
      displayName: 'Main Wallet',
      openingBalance: {
        sats: 100000000n, // 1 BTC
        usdValue: new Decimal(45000),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-01T00:00:00Z'),
        provider: 'coingecko',
      },
      closingBalance: {
        sats: 133000000n, // 1.33 BTC
        usdValue: new Decimal(59850),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-31T23:59:59Z'),
        provider: 'coingecko',
      },
      moneyIn: {
        sats: 44000000n, // 0.44 BTC
        usdValue: new Decimal(19800),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-15T12:00:00Z'),
        provider: 'coingecko',
      },
      moneyOut: {
        sats: 11000000n, // 0.11 BTC
        usdValue: new Decimal(4950),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-25T14:00:00Z'),
        provider: 'coingecko',
      },
      transactions: [
        {
          date: new Date('2024-01-03T09:30:00Z'),
          confirmed: true,
          blockHeight: 824500,
          amount: {
            sats: 5000000n, // 0.05 BTC
            usdValue: new Decimal(2250),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-03T09:30:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 105000000n, // 1.05 BTC
            usdValue: new Decimal(47250),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-03T09:30:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-07T14:15:00Z'),
          confirmed: true,
          blockHeight: 824800,
          amount: {
            sats: 10000000n, // 0.1 BTC
            usdValue: new Decimal(4500),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-07T14:15:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 115000000n, // 1.15 BTC
            usdValue: new Decimal(51750),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-07T14:15:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-12T11:00:00Z'),
          confirmed: true,
          blockHeight: 825200,
          amount: {
            sats: 7500000n, // 0.075 BTC
            usdValue: new Decimal(3375),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-12T11:00:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 122500000n, // 1.225 BTC
            usdValue: new Decimal(55125),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-12T11:00:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-15T12:00:00Z'),
          confirmed: true,
          blockHeight: 825000,
          amount: {
            sats: 7500000n, // 0.075 BTC
            usdValue: new Decimal(3375),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-15T12:00:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 130000000n, // 1.3 BTC
            usdValue: new Decimal(58500),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-15T12:00:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-18T16:30:00Z'),
          confirmed: true,
          blockHeight: 825600,
          amount: {
            sats: 2500000n, // 0.025 BTC
            usdValue: new Decimal(1125),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-18T16:30:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 132500000n, // 1.325 BTC
            usdValue: new Decimal(59625),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-18T16:30:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-22T10:45:00Z'),
          confirmed: true,
          blockHeight: 826000,
          amount: {
            sats: -2500000n, // -0.025 BTC (outgoing)
            usdValue: new Decimal(-1125),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-22T10:45:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 130000000n, // 1.3 BTC
            usdValue: new Decimal(58500),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-22T10:45:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-25T14:00:00Z'),
          confirmed: true,
          blockHeight: 826400,
          amount: {
            sats: -2500000n, // -0.025 BTC (outgoing)
            usdValue: new Decimal(-1125),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-25T14:00:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 127500000n, // 1.275 BTC
            usdValue: new Decimal(57375),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-25T14:00:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-29T13:20:00Z'),
          confirmed: true,
          blockHeight: 826800,
          amount: {
            sats: -2500000n, // -0.025 BTC (outgoing)
            usdValue: new Decimal(-1125),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-29T13:20:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 125000000n, // 1.25 BTC
            usdValue: new Decimal(56250),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-29T13:20:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-30T08:15:00Z'),
          confirmed: true,
          blockHeight: 826900,
          amount: {
            sats: 3000000n, // 0.03 BTC
            usdValue: new Decimal(1350),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T08:15:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 128000000n, // 1.28 BTC
            usdValue: new Decimal(57600),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T08:15:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-30T11:45:00Z'),
          confirmed: true,
          blockHeight: 826950,
          amount: {
            sats: 2000000n, // 0.02 BTC
            usdValue: new Decimal(900),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T11:45:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 130000000n, // 1.3 BTC
            usdValue: new Decimal(58500),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T11:45:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-30T14:30:00Z'),
          confirmed: true,
          blockHeight: 827000,
          amount: {
            sats: -1000000n, // -0.01 BTC (outgoing)
            usdValue: new Decimal(-450),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T14:30:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 129000000n, // 1.29 BTC
            usdValue: new Decimal(58050),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T14:30:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-30T16:20:00Z'),
          confirmed: true,
          blockHeight: 827050,
          amount: {
            sats: 4000000n, // 0.04 BTC
            usdValue: new Decimal(1800),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T16:20:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 133000000n, // 1.33 BTC
            usdValue: new Decimal(59850),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-30T16:20:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-31T09:00:00Z'),
          confirmed: true,
          blockHeight: 827100,
          amount: {
            sats: 1500000n, // 0.015 BTC
            usdValue: new Decimal(675),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T09:00:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 134500000n, // 1.345 BTC
            usdValue: new Decimal(60525),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T09:00:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-31T12:30:00Z'),
          confirmed: true,
          blockHeight: 827150,
          amount: {
            sats: -3000000n, // -0.03 BTC (outgoing)
            usdValue: new Decimal(-1350),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T12:30:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 131500000n, // 1.315 BTC
            usdValue: new Decimal(59175),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T12:30:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-31T15:10:00Z'),
          confirmed: true,
          blockHeight: 827200,
          amount: {
            sats: 2500000n, // 0.025 BTC
            usdValue: new Decimal(1125),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T15:10:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 134000000n, // 1.34 BTC
            usdValue: new Decimal(60300),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T15:10:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-31T17:45:00Z'),
          confirmed: true,
          blockHeight: 827250,
          amount: {
            sats: -1500000n, // -0.015 BTC (outgoing)
            usdValue: new Decimal(-675),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T17:45:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 132500000n, // 1.325 BTC
            usdValue: new Decimal(59625),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T17:45:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-31T19:20:00Z'),
          confirmed: true,
          blockHeight: 827300,
          amount: {
            sats: 1000000n, // 0.01 BTC
            usdValue: new Decimal(450),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T19:20:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 133500000n, // 1.335 BTC
            usdValue: new Decimal(60075),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T19:20:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-31T21:00:00Z'),
          confirmed: true,
          blockHeight: 827350,
          amount: {
            sats: -500000n, // -0.005 BTC (outgoing)
            usdValue: new Decimal(-225),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T21:00:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 133000000n, // 1.33 BTC
            usdValue: new Decimal(59850),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-31T21:00:00Z'),
            provider: 'coingecko',
          },
        },
      ],
    },
    {
      displayName: 'Savings Account',
      openingBalance: {
        sats: 100000000n, // 1 BTC
        usdValue: new Decimal(45000),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-01T00:00:00Z'),
        provider: 'coingecko',
      },
      closingBalance: {
        sats: 110000000n, // 1.1 BTC
        usdValue: new Decimal(49500),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-31T23:59:59Z'),
        provider: 'coingecko',
      },
      moneyIn: {
        sats: 10000000n, // 0.1 BTC
        usdValue: new Decimal(4500),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-20T10:00:00Z'),
        provider: 'coingecko',
      },
      moneyOut: {
        sats: 0n,
        usdValue: new Decimal(0),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-31T23:59:59Z'),
        provider: 'coingecko',
      },
      transactions: [
        {
          date: new Date('2024-01-05T08:00:00Z'),
          confirmed: true,
          blockHeight: 824600,
          amount: {
            sats: 2000000n, // 0.02 BTC
            usdValue: new Decimal(900),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-05T08:00:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 102000000n, // 1.02 BTC
            usdValue: new Decimal(45900),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-05T08:00:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-10T15:30:00Z'),
          confirmed: true,
          blockHeight: 825100,
          amount: {
            sats: 1500000n, // 0.015 BTC
            usdValue: new Decimal(675),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-10T15:30:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 103500000n, // 1.035 BTC
            usdValue: new Decimal(46575),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-10T15:30:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-14T12:15:00Z'),
          confirmed: true,
          blockHeight: 825300,
          amount: {
            sats: 2500000n, // 0.025 BTC
            usdValue: new Decimal(1125),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-14T12:15:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 106000000n, // 1.06 BTC
            usdValue: new Decimal(47700),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-14T12:15:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-20T10:00:00Z'),
          confirmed: true,
          blockHeight: 825800,
          amount: {
            sats: 2000000n, // 0.02 BTC
            usdValue: new Decimal(900),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-20T10:00:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 108000000n, // 1.08 BTC
            usdValue: new Decimal(48600),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-20T10:00:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-24T14:45:00Z'),
          confirmed: true,
          blockHeight: 826200,
          amount: {
            sats: 1500000n, // 0.015 BTC
            usdValue: new Decimal(675),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-24T14:45:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 109500000n, // 1.095 BTC
            usdValue: new Decimal(49275),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-24T14:45:00Z'),
            provider: 'coingecko',
          },
        },
        {
          date: new Date('2024-01-28T09:30:00Z'),
          confirmed: true,
          blockHeight: 826600,
          amount: {
            sats: 500000n, // 0.005 BTC
            usdValue: new Decimal(225),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-28T09:30:00Z'),
            provider: 'coingecko',
          },
          balance: {
            sats: 110000000n, // 1.1 BTC
            usdValue: new Decimal(49500),
            rate: new Decimal(45000),
            timestamp: new Date('2024-01-28T09:30:00Z'),
            provider: 'coingecko',
          },
        },
      ],
    },
    {
      displayName: 'Trading Account',
      openingBalance: {
        sats: 50000000n, // 0.5 BTC
        usdValue: new Decimal(22500),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-01T00:00:00Z'),
        provider: 'coingecko',
      },
      closingBalance: {
        sats: 50000000n, // 0.5 BTC
        usdValue: new Decimal(22500),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-31T23:59:59Z'),
        provider: 'coingecko',
      },
      moneyIn: {
        sats: 0n,
        usdValue: new Decimal(0),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-31T23:59:59Z'),
        provider: 'coingecko',
      },
      moneyOut: {
        sats: 0n,
        usdValue: new Decimal(0),
        rate: new Decimal(45000),
        timestamp: new Date('2024-01-31T23:59:59Z'),
        provider: 'coingecko',
      },
      transactions: [],
    },
  ],
}

export const sampleMonthlyStatement: PdfStatement = {
  id: 'st_stmt_monthly123',
  createdAt: new Date('2024-04-15T10:30:00Z'),
  status: 'completed',
  counter: 43,
  timezone: 'UTC',
  format: 'monthly',
  currency: 'BTC',
  user: {
    email: 'mathhew.powell@example.com',
    name: 'Matthew Powell',
    address: '456 Oak Avenue, San Francisco, CA 94102, United States',
  },
  months: [
    // January 2024
    {
      summary: {
        openingDate: new Date('2024-01-01T00:00:00Z'),
        closingDate: new Date('2024-01-31T23:59:59Z'),
        openingBalance: {
          sats: 100000000n, // 1 BTC
          usdValue: new Decimal(42000),
          rate: new Decimal(42000),
          timestamp: new Date('2024-01-01T00:00:00Z'),
          provider: 'coingecko',
        },
        closingBalance: {
          sats: 135000000n, // 1.35 BTC
          usdValue: new Decimal(59400),
          rate: new Decimal(44000),
          timestamp: new Date('2024-01-31T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyIn: {
          sats: 57000000n, // 0.57 BTC
          usdValue: new Decimal(24810),
          rate: new Decimal(44000),
          timestamp: new Date('2024-01-15T12:00:00Z'),
          provider: 'coingecko',
        },
        moneyOut: {
          sats: 22000000n, // 0.22 BTC
          usdValue: new Decimal(9550),
          rate: new Decimal(44000),
          timestamp: new Date('2024-01-30T17:00:00Z'),
          provider: 'coingecko',
        },
        entries: [
          {
            displayName: 'Main Wallet',
            openingBalance: {
              sats: 70000000n, // 0.7 BTC
              usdValue: new Decimal(29400),
              rate: new Decimal(42000),
              timestamp: new Date('2024-01-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 85000000n, // 0.85 BTC
              usdValue: new Decimal(37400),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 37000000n, // 0.37 BTC
              usdValue: new Decimal(16010),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-15T12:00:00Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 22000000n, // 0.22 BTC
              usdValue: new Decimal(9550),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-30T17:00:00Z'),
              provider: 'coingecko',
            },
          },
          {
            displayName: 'Savings Account',
            openingBalance: {
              sats: 30000000n, // 0.3 BTC
              usdValue: new Decimal(12600),
              rate: new Decimal(42000),
              timestamp: new Date('2024-01-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 50000000n, // 0.5 BTC
              usdValue: new Decimal(22000),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 20000000n, // 0.2 BTC
              usdValue: new Decimal(8800),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-20T12:00:00Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-31T23:59:59Z'),
              provider: 'coingecko',
            },
          },
          {
            displayName: 'Total',
            openingBalance: {
              sats: 100000000n, // 1 BTC (0.7 + 0.3)
              usdValue: new Decimal(42000),
              rate: new Decimal(42000),
              timestamp: new Date('2024-01-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 135000000n, // 1.35 BTC (0.85 + 0.5)
              usdValue: new Decimal(59400),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 57000000n, // 0.57 BTC (0.37 + 0.2)
              usdValue: new Decimal(24810),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-15T12:00:00Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 22000000n, // 0.22 BTC
              usdValue: new Decimal(9550),
              rate: new Decimal(44000),
              timestamp: new Date('2024-01-30T17:00:00Z'),
              provider: 'coingecko',
            },
          },
        ],
      },
      statementEntries: [
        {
          displayName: 'Main Wallet',
          openingBalance: {
            sats: 70000000n, // 0.7 BTC
            usdValue: new Decimal(29400),
            rate: new Decimal(42000),
            timestamp: new Date('2024-01-01T00:00:00Z'),
            provider: 'coingecko',
          },
          closingBalance: {
            sats: 85000000n, // 0.85 BTC
            usdValue: new Decimal(37400),
            rate: new Decimal(44000),
            timestamp: new Date('2024-01-31T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyIn: {
            sats: 37000000n, // 0.37 BTC
            usdValue: new Decimal(16010),
            rate: new Decimal(44000),
            timestamp: new Date('2024-01-15T12:00:00Z'),
            provider: 'coingecko',
          },
          moneyOut: {
            sats: 22000000n, // 0.22 BTC
            usdValue: new Decimal(9550),
            rate: new Decimal(44000),
            timestamp: new Date('2024-01-30T17:00:00Z'),
            provider: 'coingecko',
          },
          transactions: [
            {
              date: new Date('2024-01-03T10:00:00Z'),
              confirmed: true,
              blockHeight: 824500,
              amount: {
                sats: 8000000n, // 0.08 BTC
                usdValue: new Decimal(3360),
                rate: new Decimal(42000),
                timestamp: new Date('2024-01-03T10:00:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 78000000n, // 0.78 BTC
                usdValue: new Decimal(32760),
                rate: new Decimal(42000),
                timestamp: new Date('2024-01-03T10:00:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-06T14:30:00Z'),
              confirmed: true,
              blockHeight: 824700,
              amount: {
                sats: 5000000n, // 0.05 BTC
                usdValue: new Decimal(2100),
                rate: new Decimal(42000),
                timestamp: new Date('2024-01-06T14:30:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 83000000n, // 0.83 BTC
                usdValue: new Decimal(34860),
                rate: new Decimal(42000),
                timestamp: new Date('2024-01-06T14:30:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-09T09:15:00Z'),
              confirmed: true,
              blockHeight: 824900,
              amount: {
                sats: -3000000n, // -0.03 BTC (outgoing)
                usdValue: new Decimal(-1260),
                rate: new Decimal(42000),
                timestamp: new Date('2024-01-09T09:15:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 80000000n, // 0.8 BTC
                usdValue: new Decimal(33600),
                rate: new Decimal(42000),
                timestamp: new Date('2024-01-09T09:15:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-12T16:45:00Z'),
              confirmed: true,
              blockHeight: 825100,
              amount: {
                sats: 10000000n, // 0.1 BTC
                usdValue: new Decimal(4300),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-12T16:45:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 90000000n, // 0.9 BTC
                usdValue: new Decimal(38700),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-12T16:45:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-15T12:00:00Z'),
              confirmed: true,
              blockHeight: 825000,
              amount: {
                sats: 7000000n, // 0.07 BTC
                usdValue: new Decimal(3010),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-15T12:00:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 97000000n, // 0.97 BTC
                usdValue: new Decimal(41710),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-15T12:00:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-18T11:20:00Z'),
              confirmed: true,
              blockHeight: 825300,
              amount: {
                sats: -2000000n, // -0.02 BTC (outgoing)
                usdValue: new Decimal(-860),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-18T11:20:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 95000000n, // 0.95 BTC
                usdValue: new Decimal(40850),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-18T11:20:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-21T15:30:00Z'),
              confirmed: true,
              blockHeight: 825500,
              amount: {
                sats: 4000000n, // 0.04 BTC
                usdValue: new Decimal(1720),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-21T15:30:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 99000000n, // 0.99 BTC
                usdValue: new Decimal(42570),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-21T15:30:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-24T13:10:00Z'),
              confirmed: true,
              blockHeight: 825700,
              amount: {
                sats: -5000000n, // -0.05 BTC (outgoing)
                usdValue: new Decimal(-2150),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-24T13:10:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 94000000n, // 0.94 BTC
                usdValue: new Decimal(40420),
                rate: new Decimal(43000),
                timestamp: new Date('2024-01-24T13:10:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-27T08:45:00Z'),
              confirmed: true,
              blockHeight: 825900,
              amount: {
                sats: 3000000n, // 0.03 BTC
                usdValue: new Decimal(1320),
                rate: new Decimal(44000),
                timestamp: new Date('2024-01-27T08:45:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 97000000n, // 0.97 BTC
                usdValue: new Decimal(42680),
                rate: new Decimal(44000),
                timestamp: new Date('2024-01-27T08:45:00Z'),
                provider: 'coingecko',
              },
            },
            {
              date: new Date('2024-01-30T17:00:00Z'),
              confirmed: true,
              blockHeight: 826000,
              amount: {
                sats: -12000000n, // -0.12 BTC (outgoing)
                usdValue: new Decimal(-5280),
                rate: new Decimal(44000),
                timestamp: new Date('2024-01-30T17:00:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 85000000n, // 0.85 BTC
                usdValue: new Decimal(37400),
                rate: new Decimal(44000),
                timestamp: new Date('2024-01-30T17:00:00Z'),
                provider: 'coingecko',
              },
            },
          ],
        },
        {
          displayName: 'Savings Account',
          openingBalance: {
            sats: 30000000n, // 0.3 BTC
            usdValue: new Decimal(12600),
            rate: new Decimal(42000),
            timestamp: new Date('2024-01-01T00:00:00Z'),
            provider: 'coingecko',
          },
          closingBalance: {
            sats: 50000000n, // 0.5 BTC
            usdValue: new Decimal(22000),
            rate: new Decimal(44000),
            timestamp: new Date('2024-01-31T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyIn: {
            sats: 20000000n, // 0.2 BTC
            usdValue: new Decimal(8800),
            rate: new Decimal(44000),
            timestamp: new Date('2024-01-20T12:00:00Z'),
            provider: 'coingecko',
          },
          moneyOut: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(44000),
            timestamp: new Date('2024-01-31T23:59:59Z'),
            provider: 'coingecko',
          },
          transactions: [
            {
              date: new Date('2024-01-20T12:00:00Z'),
              confirmed: true,
              blockHeight: 825200,
              amount: {
                sats: 20000000n, // 0.2 BTC
                usdValue: new Decimal(8800),
                rate: new Decimal(44000),
                timestamp: new Date('2024-01-20T12:00:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 50000000n, // 0.5 BTC
                usdValue: new Decimal(22000),
                rate: new Decimal(44000),
                timestamp: new Date('2024-01-20T12:00:00Z'),
                provider: 'coingecko',
              },
            },
          ],
        },
      ],
    },
    // February 2024
    {
      summary: {
        openingDate: new Date('2024-02-01T00:00:00Z'),
        closingDate: new Date('2024-02-29T23:59:59Z'),
        openingBalance: {
          sats: 135000000n, // 1.35 BTC
          usdValue: new Decimal(59400),
          rate: new Decimal(44000),
          timestamp: new Date('2024-02-01T00:00:00Z'),
          provider: 'coingecko',
        },
        closingBalance: {
          sats: 125000000n, // 1.25 BTC
          usdValue: new Decimal(62500),
          rate: new Decimal(50000),
          timestamp: new Date('2024-02-29T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyIn: {
          sats: 0n,
          usdValue: new Decimal(0),
          rate: new Decimal(50000),
          timestamp: new Date('2024-02-29T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyOut: {
          sats: 10000000n, // 0.1 BTC
          usdValue: new Decimal(5000),
          rate: new Decimal(50000),
          timestamp: new Date('2024-02-15T12:00:00Z'),
          provider: 'coingecko',
        },
        entries: [
          {
            displayName: 'Main Wallet',
            openingBalance: {
              sats: 85000000n, // 0.85 BTC
              usdValue: new Decimal(37400),
              rate: new Decimal(44000),
              timestamp: new Date('2024-02-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 75000000n, // 0.75 BTC
              usdValue: new Decimal(37500),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-29T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-29T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 10000000n, // 0.1 BTC
              usdValue: new Decimal(5000),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-15T12:00:00Z'),
              provider: 'coingecko',
            },
          },
          {
            displayName: 'Savings Account',
            openingBalance: {
              sats: 50000000n, // 0.5 BTC
              usdValue: new Decimal(22000),
              rate: new Decimal(44000),
              timestamp: new Date('2024-02-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 50000000n, // 0.5 BTC
              usdValue: new Decimal(25000),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-29T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-29T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-29T23:59:59Z'),
              provider: 'coingecko',
            },
          },
          {
            displayName: 'Total',
            openingBalance: {
              sats: 135000000n, // 1.35 BTC (0.85 + 0.5)
              usdValue: new Decimal(59400),
              rate: new Decimal(44000),
              timestamp: new Date('2024-02-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 125000000n, // 1.25 BTC (0.75 + 0.5)
              usdValue: new Decimal(62500),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-29T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-29T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 10000000n, // 0.1 BTC
              usdValue: new Decimal(5000),
              rate: new Decimal(50000),
              timestamp: new Date('2024-02-15T12:00:00Z'),
              provider: 'coingecko',
            },
          },
        ],
      },
      statementEntries: [
        {
          displayName: 'Main Wallet',
          openingBalance: {
            sats: 85000000n, // 0.85 BTC
            usdValue: new Decimal(37400),
            rate: new Decimal(44000),
            timestamp: new Date('2024-02-01T00:00:00Z'),
            provider: 'coingecko',
          },
          closingBalance: {
            sats: 75000000n, // 0.75 BTC
            usdValue: new Decimal(37500),
            rate: new Decimal(50000),
            timestamp: new Date('2024-02-29T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyIn: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(50000),
            timestamp: new Date('2024-02-29T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyOut: {
            sats: 10000000n, // 0.1 BTC
            usdValue: new Decimal(5000),
            rate: new Decimal(50000),
            timestamp: new Date('2024-02-15T12:00:00Z'),
            provider: 'coingecko',
          },
          transactions: [
            {
              date: new Date('2024-02-15T12:00:00Z'),
              confirmed: true,
              blockHeight: 830000,
              amount: {
                sats: -10000000n, // -0.1 BTC (outgoing)
                usdValue: new Decimal(-5000),
                rate: new Decimal(50000),
                timestamp: new Date('2024-02-15T12:00:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 75000000n, // 0.75 BTC
                usdValue: new Decimal(37500),
                rate: new Decimal(50000),
                timestamp: new Date('2024-02-15T12:00:00Z'),
                provider: 'coingecko',
              },
            },
          ],
        },
        {
          displayName: 'Savings Account',
          openingBalance: {
            sats: 50000000n, // 0.5 BTC
            usdValue: new Decimal(22000),
            rate: new Decimal(44000),
            timestamp: new Date('2024-02-01T00:00:00Z'),
            provider: 'coingecko',
          },
          closingBalance: {
            sats: 50000000n, // 0.5 BTC
            usdValue: new Decimal(25000),
            rate: new Decimal(50000),
            timestamp: new Date('2024-02-29T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyIn: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(50000),
            timestamp: new Date('2024-02-29T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyOut: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(50000),
            timestamp: new Date('2024-02-29T23:59:59Z'),
            provider: 'coingecko',
          },
          transactions: [],
        },
      ],
    },
    // March 2024
    {
      summary: {
        openingDate: new Date('2024-03-01T00:00:00Z'),
        closingDate: new Date('2024-03-31T23:59:59Z'),
        openingBalance: {
          sats: 125000000n, // 1.25 BTC
          usdValue: new Decimal(62500),
          rate: new Decimal(50000),
          timestamp: new Date('2024-03-01T00:00:00Z'),
          provider: 'coingecko',
        },
        closingBalance: {
          sats: 175000000n, // 1.75 BTC
          usdValue: new Decimal(122500),
          rate: new Decimal(70000),
          timestamp: new Date('2024-03-31T23:59:59Z'),
          provider: 'coingecko',
        },
        moneyIn: {
          sats: 50000000n, // 0.5 BTC
          usdValue: new Decimal(35000),
          rate: new Decimal(70000),
          timestamp: new Date('2024-03-10T12:00:00Z'),
          provider: 'coingecko',
        },
        moneyOut: {
          sats: 0n,
          usdValue: new Decimal(0),
          rate: new Decimal(70000),
          timestamp: new Date('2024-03-31T23:59:59Z'),
          provider: 'coingecko',
        },
        entries: [
          {
            displayName: 'Main Wallet',
            openingBalance: {
              sats: 75000000n, // 0.75 BTC
              usdValue: new Decimal(37500),
              rate: new Decimal(50000),
              timestamp: new Date('2024-03-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 100000000n, // 1.0 BTC
              usdValue: new Decimal(70000),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 25000000n, // 0.25 BTC
              usdValue: new Decimal(17500),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-10T12:00:00Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
          },
          {
            displayName: 'Savings Account',
            openingBalance: {
              sats: 50000000n, // 0.5 BTC
              usdValue: new Decimal(25000),
              rate: new Decimal(50000),
              timestamp: new Date('2024-03-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 50000000n, // 0.5 BTC
              usdValue: new Decimal(35000),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
          },
          {
            displayName: 'Trading Account',
            openingBalance: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(50000),
              timestamp: new Date('2024-03-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 25000000n, // 0.25 BTC
              usdValue: new Decimal(17500),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 25000000n, // 0.25 BTC
              usdValue: new Decimal(17500),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-25T12:00:00Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
          },
          {
            displayName: 'Total',
            openingBalance: {
              sats: 125000000n, // 1.25 BTC (0.75 + 0.5 + 0)
              usdValue: new Decimal(62500),
              rate: new Decimal(50000),
              timestamp: new Date('2024-03-01T00:00:00Z'),
              provider: 'coingecko',
            },
            closingBalance: {
              sats: 175000000n, // 1.75 BTC (1.0 + 0.5 + 0.25)
              usdValue: new Decimal(122500),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
            moneyIn: {
              sats: 50000000n, // 0.5 BTC (0.25 + 0 + 0.25)
              usdValue: new Decimal(35000),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-10T12:00:00Z'),
              provider: 'coingecko',
            },
            moneyOut: {
              sats: 0n,
              usdValue: new Decimal(0),
              rate: new Decimal(70000),
              timestamp: new Date('2024-03-31T23:59:59Z'),
              provider: 'coingecko',
            },
          },
        ],
      },
      statementEntries: [
        {
          displayName: 'Main Wallet',
          openingBalance: {
            sats: 75000000n, // 0.75 BTC
            usdValue: new Decimal(37500),
            rate: new Decimal(50000),
            timestamp: new Date('2024-03-01T00:00:00Z'),
            provider: 'coingecko',
          },
          closingBalance: {
            sats: 100000000n, // 1.0 BTC
            usdValue: new Decimal(70000),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-31T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyIn: {
            sats: 25000000n, // 0.25 BTC
            usdValue: new Decimal(17500),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-10T12:00:00Z'),
            provider: 'coingecko',
          },
          moneyOut: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-31T23:59:59Z'),
            provider: 'coingecko',
          },
          transactions: [
            {
              date: new Date('2024-03-10T12:00:00Z'),
              confirmed: true,
              blockHeight: 835000,
              amount: {
                sats: 25000000n, // 0.25 BTC
                usdValue: new Decimal(17500),
                rate: new Decimal(70000),
                timestamp: new Date('2024-03-10T12:00:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 100000000n, // 1.0 BTC
                usdValue: new Decimal(70000),
                rate: new Decimal(70000),
                timestamp: new Date('2024-03-10T12:00:00Z'),
                provider: 'coingecko',
              },
            },
          ],
        },
        {
          displayName: 'Savings Account',
          openingBalance: {
            sats: 50000000n, // 0.5 BTC
            usdValue: new Decimal(25000),
            rate: new Decimal(50000),
            timestamp: new Date('2024-03-01T00:00:00Z'),
            provider: 'coingecko',
          },
          closingBalance: {
            sats: 50000000n, // 0.5 BTC
            usdValue: new Decimal(35000),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-31T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyIn: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-31T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyOut: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-31T23:59:59Z'),
            provider: 'coingecko',
          },
          transactions: [],
        },
        {
          displayName: 'Trading Account',
          openingBalance: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(50000),
            timestamp: new Date('2024-03-01T00:00:00Z'),
            provider: 'coingecko',
          },
          closingBalance: {
            sats: 25000000n, // 0.25 BTC
            usdValue: new Decimal(17500),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-31T23:59:59Z'),
            provider: 'coingecko',
          },
          moneyIn: {
            sats: 25000000n, // 0.25 BTC
            usdValue: new Decimal(17500),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-25T12:00:00Z'),
            provider: 'coingecko',
          },
          moneyOut: {
            sats: 0n,
            usdValue: new Decimal(0),
            rate: new Decimal(70000),
            timestamp: new Date('2024-03-31T23:59:59Z'),
            provider: 'coingecko',
          },
          transactions: [
            {
              date: new Date('2024-03-25T12:00:00Z'),
              confirmed: true,
              blockHeight: 837000,
              amount: {
                sats: 25000000n, // 0.25 BTC
                usdValue: new Decimal(17500),
                rate: new Decimal(70000),
                timestamp: new Date('2024-03-25T12:00:00Z'),
                provider: 'coingecko',
              },
              balance: {
                sats: 25000000n, // 0.25 BTC
                usdValue: new Decimal(17500),
                rate: new Decimal(70000),
                timestamp: new Date('2024-03-25T12:00:00Z'),
                provider: 'coingecko',
              },
            },
          ],
        },
      ],
    },
  ],
}
