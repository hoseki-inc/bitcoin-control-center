import { TZDate } from '@date-fns/tz'
import type ReactPDF from '@react-pdf/renderer'
import type { ViewProps } from '@react-pdf/renderer'
import { format, isFirstDayOfMonth, isLastDayOfMonth, isSameMonth } from 'date-fns'
import Decimal from 'decimal.js'
import React from 'react'
import { type CurrencyCode, Money, USD, currencies } from '../currency'
import type {
  CustomPdfStatement,
  MonthlyPdfStatement,
  PdfStatement,
  StatementEntry,
  StatementTransaction,
  SummaryEntry,
} from '../schemas/pdf-statement'
import type { StatementQuoteCurrency } from '../schemas/statement-quote'
import { getColor } from '../ui/design-system/theme/extractors'
import { formatDateRange } from '../ui/utils/date-and-time'

/**
 * Note, Istvan 2025-04-07:
 * Chosen based on available space considering header and footer.
 * This value determines how many table rows can fit on a single page.
 */
const MAX_ROWS_PER_PAGE = 8
const PUBLIC_MEMPOOL_URL = 'https://mempool.space'
const MONO_GLYPH_WIDTH_EM = 0.6
/** Space reserved between amounts in neighbouring columns. */
const AMOUNT_COLUMN_GAP = 12

/**
 * Shrinks only text too long for its column, such as CAD 12,345,678.90, so neighbouring amounts
 * never run together. GeistMono glyphs are all 0.6 em wide, so the text width is exact. The
 * layout narrows columns slightly to fit the page, so the remaining gap is a little under the
 * reserve.
 */
function fitFontSize(text: string, fontSize: number, columnWidth: number): number {
  return Math.min(fontSize, (columnWidth - AMOUNT_COLUMN_GAP) / (text.length * MONO_GLYPH_WIDTH_EM))
}

export type DocumentInput = {
  watermarkText: string
  statement: PdfStatement
}

export type EnvelopeDocumentInput = {
  watermarkText: string
  statements: PdfStatement[]
}

const tokens = {
  typography: {
    fontFamily: 'Geist',
    fontFamilyMono: 'GeistMono',
    fontWeights: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    fontSize: {
      xxs: 8,
      xs: 10,
      sm: 12,
      base: 14,
      md: 16,
      lg: 18,
      xl: 20,
    },
  },
  spacing: {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 4,
  },
}

interface StatementDocumentTemplates {
  CustomStatementDocument: React.FC<{ input: DocumentInput; qrCode: string }>
  MonthlyStatementDocument: React.FC<{ input: DocumentInput; qrCode: string }>
  EnvelopeDocument: React.FC<{ input: EnvelopeDocumentInput; qrCode: string }>
}

type RendererPrimitive =
  | 'Document'
  | 'Page'
  | 'Text'
  | 'View'
  | 'Svg'
  | 'Rect'
  | 'Path'
  | 'Image'
  | 'Link'
  | 'G'
  | 'Defs'
  | 'ClipPath'
  | 'LinearGradient'
  | 'Stop'
type StatementRenderer = Pick<typeof ReactPDF, 'Font' | 'StyleSheet'> & {
  [Primitive in RendererPrimitive]: React.ComponentType<React.ComponentProps<(typeof ReactPDF)[Primitive]>>
}

export function getStatementDocumentTemplates(
  pdf: StatementRenderer,
  geistDirPath: string,
): StatementDocumentTemplates {
  const {
    Document,
    Page,
    StyleSheet,
    Text,
    View,
    Font,
    Svg,
    Rect,
    Path,
    Image,
    Link,
    G,
    Defs,
    ClipPath,
    LinearGradient,
    Stop,
  } = pdf

  Font.register({
    family: 'Geist',
    fontStyle: 'normal',
    fonts: [
      { fontWeight: tokens.typography.fontWeights.regular, src: `${geistDirPath}/Geist-Regular.ttf` },
      { fontWeight: tokens.typography.fontWeights.medium, src: `${geistDirPath}/Geist-Medium.ttf` },
      { fontWeight: tokens.typography.fontWeights.semibold, src: `${geistDirPath}/Geist-SemiBold.ttf` },
    ],
  })

  Font.register({
    family: 'GeistMono',
    fontStyle: 'normal',
    fonts: [
      { fontWeight: tokens.typography.fontWeights.regular, src: `${geistDirPath}/GeistMono-Regular.ttf` },
      { fontWeight: tokens.typography.fontWeights.medium, src: `${geistDirPath}/GeistMono-Medium.ttf` },
      { fontWeight: tokens.typography.fontWeights.semibold, src: `${geistDirPath}/GeistMono-SemiBold.ttf` },
    ],
  })

  const formatMinorToMajor = (minorUnits: bigint, currency: CurrencyCode, showCurrency: boolean = true) => {
    const currencyLabel = showCurrency ? ` ${currency}` : ''
    const currencyObj = currencies[currency]
    const money = Money.fromMinor(currencyObj, minorUnits)

    // Use the currency's exponent as the number of decimal places to display
    return money.toMajorAmount().absoluteValue().toFixed(currencyObj.exponent) + currencyLabel
  }
  const formatQuote = (decimal: Decimal | null, quoteCurrency: StatementQuoteCurrency = 'USD'): string => {
    if (!decimal) {
      return 'N/A'
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: quoteCurrency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: 'never',
    }).format(decimal.toNumber())
  }

  const formatTzDate = (date: Date | null, formatString: string, timezone: string): string => {
    if (!date) {
      return 'N/A'
    }
    return format(new TZDate(date, timezone), formatString)
  }

  const createBaseStyles = () =>
    StyleSheet.create({
      page: {
        fontFamily: tokens.typography.fontFamily,
        backgroundColor: getColor('shades.0'),
        paddingTop: 32,
      },
      // This container is used to put everything else apart from the watermark
      // in a z-index stack beneath the watermark.
      headerAndMainContainer: {
        position: 'relative',
        // Setting negative because of a React-PDF bug.
        // See my comment in `createWatermarkStyles.watermarkContainer`.
        zIndex: -1,
      },
      mainContentContainer: {
        marginTop: tokens.spacing.xxl,
        borderRadius: tokens.radius.sm,
        paddingTop: tokens.spacing.sm,
        paddingLeft: tokens.spacing.md,
        paddingRight: tokens.spacing.md,
        minHeight: '95%',
        display: 'flex',
        flexDirection: 'column',
        borderTopWidth: 1,
        borderTopColor: getColor('neutral.200'),
      },
      contentWrapper: {
        flex: 1,
      },

      text: {
        small: {
          fontSize: tokens.typography.fontSize.xs,
          color: getColor('neutral.500'),
        },
        base: {
          fontSize: tokens.typography.fontSize.xs,
          color: getColor('neutral.900'),
        },
        medium: {
          fontSize: tokens.typography.fontSize.sm,
          color: getColor('neutral.900'),
        },
        large: {
          fontSize: tokens.typography.fontSize.base,
          color: getColor('neutral.900'),
        },
        title: {
          fontSize: tokens.typography.fontSize.xs,
          fontWeight: tokens.typography.fontWeights.medium,
          marginBottom: tokens.spacing.xs,
          color: getColor('neutral.900'),
          textTransform: 'uppercase',
          letterSpacing: 1,
        },
      },

      sectionTitle: {
        marginTop: tokens.spacing.sm,
        marginBottom: tokens.spacing.xs,
        fontSize: tokens.typography.fontSize.xs,
        fontWeight: tokens.typography.fontWeights.medium,
        color: getColor('neutral.900'),
        textTransform: 'uppercase',
        letterSpacing: 1,
      },
      tableHeader: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        marginTop: tokens.spacing.sm,
        padding: 0,
        borderBottomWidth: 0,
      },
      tableHeaderText: {
        fontSize: tokens.typography.fontSize.xs,
        fontWeight: tokens.typography.fontWeights.medium,
        textTransform: 'uppercase',
        color: getColor('neutral.500'),
        letterSpacing: 1,
      },
      tableRow: {
        flexDirection: 'row',
        fontFamily: tokens.typography.fontFamilyMono,
        paddingVertical: tokens.spacing.xs,
        paddingHorizontal: 0,
        borderBottomWidth: 1,
        borderBottomColor: getColor('neutral.200'),
        backgroundColor: getColor('shades.0'),
      },
      tableRowAlternate: {
        backgroundColor: 'transparent',
      },
      cell: {
        paddingHorizontal: 0,
        paddingVertical: tokens.spacing.xxs,
      },
    })

  const createWatermarkStyles = () =>
    StyleSheet.create({
      watermarkContainer: {
        position: 'absolute',
        top: 0,
        right: 0,
        left: 0,
        bottom: 0,
        overflow: 'hidden',
        /**
         * Note Vini 2025-04-09: There is a bug in React-PDF, setting negative here
         * because z-index is working in an opposite way to what you'd expect.
         * @see https://github.com/diegomura/react-pdf/issues/1721
         */
        zIndex: -10,
        alignItems: 'center',
        justifyContent: 'center',
      },
    })

  const StatementExampleWatermark = ({ watermarkText }: { watermarkText: string }) => (
    <Text
      style={{
        fontSize: 96,
        fontWeight: 'bold',
        color: getColor('neutral.600'),
        opacity: 0.15,
        transform: 'rotate(-60deg)',
        textAlign: 'center',
      }}
    >
      {watermarkText}
    </Text>
  )

  const CalendarIcon = () => (
    <Svg width="33" height="33" viewBox="0 0 33 33" fill="none">
      <G clipPath="url(#clip0_1179_53756)">
        <Path
          d="M1.52051 12.7637C3.58235 4.48892 11.9622 -0.547114 20.2344 1.51562C28.5086 3.57838 33.5432 11.96 31.4805 20.2344C29.4177 28.5081 21.0375 33.5437 12.7627 31.4805C4.62077 29.4498 -0.385491 21.2971 1.42871 13.1514L1.52051 12.7637Z"
          fill="#F8FAFC"
          stroke="#E2E8F0"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <Path
          d="M13.1671 8.16479V11.4981"
          stroke="#CBD5E1"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M19.8334 8.16479V11.4981"
          stroke="#CBD5E1"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="#F8FAFC"
        />
        <Path
          stroke="#CBD5E1"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M22.3336 9.83154H10.6669C9.74644 9.83154 9.00024 10.5777 9.00024 11.4982V23.1649C9.00024 24.0854 9.74644 24.8315 10.6669 24.8315H22.3336C23.2541 24.8315 24.0002 24.0854 24.0002 23.1649V11.4982C24.0002 10.5777 23.2541 9.83154 22.3336 9.83154Z"
          fill="#F8FAFC"
        />
        <Path
          d="M9.00024 14.8315H24.0002"
          stroke="#CBD5E1"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="#F8FAFC"
        />
        <Path
          d="M18.1667 18.1648L14.8334 21.4981"
          stroke="#CBD5E1"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="#F8FAFC"
        />
        <Path
          d="M14.8334 18.1648L18.1667 21.4981"
          stroke="#CBD5E1"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="#F8FAFC"
        />
      </G>
      <Defs>
        <LinearGradient
          id="paint0_linear_1179_53756"
          x1="26.1411"
          y1="2.9745"
          x2="16.5002"
          y2="32.4984"
          gradientUnits="userSpaceOnUse"
        >
          <Stop stopColor="#F1F5F9" offset="0" />
          <Stop offset="1" stopColor="#F9F9F9" />
        </LinearGradient>
        <LinearGradient
          id="paint1_linear_1179_53756"
          x1="26.2017"
          y1="3.25021"
          x2="16.5002"
          y2="32.4984"
          gradientUnits="userSpaceOnUse"
        >
          <Stop stopColor="#E2E8F0" offset="0" />
          <Stop offset="1" stopColor="#F9F9F9" />
        </LinearGradient>
        <ClipPath id="clip0_1179_53756">
          <Rect width="32" height="32" fill="white" transform="translate(0.5 0.5)" />
        </ClipPath>
      </Defs>
    </Svg>
  )

  const styles = StyleSheet.create({
    ...createBaseStyles(),
    ...createWatermarkStyles(),

    headerRow: {
      width: '100%',
      minHeight: 85,
      paddingLeft: tokens.spacing.md,
      paddingRight: tokens.spacing.md,
      paddingBottom: tokens.spacing.xxl,
    },
    accountTitle: {
      fontSize: tokens.typography.fontSize.xs,
      fontWeight: tokens.typography.fontWeights.medium,
      color: getColor('neutral.900'),
      marginBottom: tokens.spacing.xs,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    transactionRowText: {
      fontSize: tokens.typography.fontSize.xs,
      color: getColor('neutral.900'),
      fontFamily: tokens.typography.fontFamilyMono,
      fontWeight: tokens.typography.fontWeights.medium,
    },
    proofInfoContainer: {
      flex: 1,
      flexDirection: 'column',
      alignItems: 'flex-end',
    },
    logoContainer: {
      marginBottom: tokens.spacing.sm,
    },
    headerSecondRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    headerContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      width: '100%',
      gap: tokens.spacing.md,
    },
    leftColumn: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: tokens.spacing.lg,
      flex: 1,
    },
    rightColumn: {
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: tokens.spacing.xl,
      flex: 1,
    },
    contactInfo: {
      flexDirection: 'column',
      gap: tokens.spacing.md,
    },
    dateRange: {
      marginTop: tokens.spacing.md,
      fontSize: tokens.typography.fontSize.base,
      color: getColor('neutral.900'),
      fontWeight: tokens.typography.fontWeights.medium,
      textAlign: 'right',
    },
    totalContainer: {
      backgroundColor: getColor('neutral.100'),
      borderRadius: tokens.radius.sm,
      borderWidth: 1,
      borderColor: getColor('neutral.300'),
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
      minWidth: 243,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      minWidth: '100%', // width wasn't working
      marginBottom: tokens.spacing.xxs,
    },
    totalLabel: {
      fontSize: tokens.typography.fontSize.base,
      color: getColor('neutral.900'),
      fontWeight: tokens.typography.fontWeights.semibold,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    totalBtcValue: {
      fontSize: tokens.typography.fontSize.base,
      color: getColor('neutral.900'),
      fontWeight: tokens.typography.fontWeights.regular,
      fontFamily: tokens.typography.fontFamilyMono,
    },
    totalQuoteLabel: {
      fontSize: tokens.typography.fontSize.xs,
      color: getColor('neutral.900'),
      fontWeight: tokens.typography.fontWeights.medium,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    totalQuoteValue: {
      fontSize: tokens.typography.fontSize.xs,
      color: getColor('neutral.900'),
      fontWeight: tokens.typography.fontWeights.regular,
      fontFamily: tokens.typography.fontFamilyMono,
    },
    contactContainer: {
      flexDirection: 'column',
      gap: tokens.spacing.xs,
    },
    nameText: {
      fontSize: tokens.typography.fontSize.base,
      fontWeight: tokens.typography.fontWeights.medium,
      color: getColor('neutral.900'),
    },
    emailText: {
      fontSize: tokens.typography.fontSize.base,
      fontWeight: tokens.typography.fontWeights.medium,
      color: getColor('neutral.600'),
    },
    addressText: {
      fontSize: tokens.typography.fontSize.base,
      fontWeight: tokens.typography.fontWeights.medium,
      color: getColor('neutral.600'),
    },
    providedByLabel: {
      fontSize: tokens.typography.fontSize.xs,
      fontWeight: tokens.typography.fontWeights.medium,
      color: getColor('neutral.900'),
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: tokens.spacing.sm,
    },
    statementNumber: {
      fontSize: tokens.typography.fontSize.sm,
      fontWeight: tokens.typography.fontWeights.regular,
      color: getColor('neutral.900'),
    },
    generatedWith: {
      fontSize: tokens.typography.fontSize.sm,
      fontWeight: tokens.typography.fontWeights.regular,
      color: getColor('neutral.600'),
    },
    ownershipProvenText: {
      fontFamily: tokens.typography.fontFamily,
      fontSize: tokens.typography.fontSize.xxs,
      color: getColor('neutral.500'),
      marginTop: tokens.spacing.xxs,
    },
    summaryPageHeader: {
      width: '100%',
      minHeight: 103,
      paddingLeft: tokens.spacing.md,
      paddingRight: tokens.spacing.md,
    },
    summaryPageHeaderContent: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      width: '100%',
      gap: tokens.spacing.md,
    },
    summaryLeftColumn: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: tokens.spacing.lg,
      flex: 1,
    },
    summaryRightColumn: {
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: tokens.spacing.xl,
      flex: 1,
    },
  })

  const amountStyles = StyleSheet.create({
    container: {
      paddingBottom: 0,
    },
    btcAmount: {
      fontSize: tokens.typography.fontSize.xs,
      color: getColor('neutral.900'),
      fontFamily: tokens.typography.fontFamilyMono,
      fontWeight: tokens.typography.fontWeights.medium,
      lineHeight: 1.5,
    },
    quoteAmount: {
      fontSize: tokens.typography.fontSize.xs,
      color: getColor('neutral.500'),
      fontFamily: tokens.typography.fontFamilyMono,
      fontWeight: tokens.typography.fontWeights.medium,
      lineHeight: 1.5,
      marginTop: 0,
    },
  })

  const footerStyles = StyleSheet.create({
    container: {
      position: 'absolute',
      bottom: tokens.spacing.xxl,
      left: tokens.spacing.md,
      right: tokens.spacing.md,
    },
    innerContainer: {
      backgroundColor: getColor('neutral.50'),
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      gap: tokens.spacing.sm,
    },
    leftColumn: {
      flexDirection: 'column',
      gap: tokens.spacing.xxs,
    },
    centerColumn: {
      flex: 1,
      marginLeft: tokens.spacing.md,
    },
    rightColumn: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      marginLeft: tokens.spacing.md,
    },
    rightColumnContent: {
      width: 82,
      display: 'flex',
      alignItems: 'flex-start',
    },
    title: {
      fontSize: tokens.typography.fontSize.xxs,
      fontWeight: tokens.typography.fontWeights.medium,
      marginBottom: tokens.spacing.xxs,
      color: getColor('neutral.900'),
    },
    subtitle: {
      fontSize: tokens.typography.fontSize.xxs,
      color: getColor('neutral.600'),
      lineHeight: 1.2,
    },
    instructionsTitle: {
      fontSize: tokens.typography.fontSize.xxs,
      fontWeight: tokens.typography.fontWeights.medium,
      marginBottom: tokens.spacing.xxs,
      color: getColor('neutral.900'),
    },
    instructionsTextBlock: {
      marginBottom: tokens.spacing.xxs,
    },
    footerText: {
      fontSize: tokens.typography.fontSize.xxs,
      color: getColor('neutral.600'),
    },
    instructionsText: {
      fontSize: tokens.typography.fontSize.xxs,
      color: getColor('neutral.600'),
      lineHeight: 1.2,
    },
    attributionText: {
      fontSize: tokens.typography.fontSize.xxs,
      color: getColor('neutral.600'),
      marginTop: tokens.spacing.sm,
    },
    link: {
      fontSize: tokens.typography.fontSize.xxs,
      color: getColor('neutral.900'),
      fontWeight: tokens.typography.fontWeights.medium,
      textDecoration: 'none',
    },
    linksContainer: {
      width: '100%',
      alignItems: 'flex-start',
      gap: tokens.spacing.xxs,
    },
    qrCode: {
      width: 32,
      height: 32,
      marginTop: tokens.spacing.xs,
      alignSelf: 'flex-start',
    },
    pageNumber: {
      fontSize: tokens.typography.fontSize.xxs,
      color: getColor('neutral.900'),
      textAlign: 'right',
      marginTop: tokens.spacing.sm,
      position: 'absolute',
      bottom: -24,
      right: 0,
    },
  })

  const Logo = () => (
    <Svg width="89" height="26" viewBox="0 0 89 26" fill="none">
      <Rect width="27.1107" height="25.5395" rx="1.3388" fill="black" />
      <Path
        d="M11.7158 20.1841H10.7103C9.60125 20.1841 8.70215 19.285 8.70215 18.1759V7.36318C8.70215 6.25408 9.60125 5.35498 10.7104 5.35498H11.7354V11.4266C12.342 10.586 13.4575 10.0973 14.7295 10.0973C17.0582 10.0973 18.4085 11.5829 18.4085 14.1437V20.1841H15.3948V14.867C15.3948 13.6355 14.7099 12.834 13.6727 12.834C12.479 12.834 11.7158 13.6159 11.7158 14.8279V20.1841Z"
        fill="white"
      />
      <Path
        d="M34.3081 20.2202H33.3026C32.1935 20.2202 31.2944 19.3211 31.2944 18.212V7.39931C31.2944 6.29021 32.1935 5.39111 33.3026 5.39111H34.3277V11.4627C34.9343 10.6221 36.0497 10.1334 37.3217 10.1334C39.6505 10.1334 41.0007 11.6191 41.0007 14.1799V20.2202H37.9871V14.9031C37.9871 13.6716 37.3022 12.8701 36.265 12.8701C35.0713 12.8701 34.3081 13.6521 34.3081 14.864V20.2202Z"
        fill="black"
      />
      <Path
        d="M41.8374 15.0224C41.8374 11.9 44.1298 9.80518 47.2918 9.80518C50.434 9.80518 52.7264 11.9 52.7264 15.0224C52.7264 18.1449 50.434 20.2199 47.2918 20.2199C44.1298 20.2199 41.8374 18.1449 41.8374 15.0224ZM44.9006 15.0027C44.9006 16.5046 45.8689 17.4927 47.2918 17.4927C48.6949 17.4927 49.6633 16.5046 49.6633 15.0027C49.6633 13.5205 48.6949 12.5324 47.2918 12.5324C45.8689 12.5324 44.9006 13.5205 44.9006 15.0027Z"
        fill="black"
      />
      <Path
        d="M53.5632 16.8405H56.4485C56.488 17.5322 57.0019 17.9472 57.9307 17.9472C58.8793 17.9472 59.3141 17.6112 59.3141 17.0974C59.3141 16.801 59.156 16.4848 58.4248 16.3267L56.6066 15.9315C54.7885 15.5362 53.8992 14.7457 53.8992 13.0066C53.8992 10.9514 55.658 9.76562 58.0295 9.76562C60.3219 9.76562 61.9227 11.1095 61.9227 13.1054H59.0374C59.0374 12.4335 58.6224 11.979 57.8912 11.979C57.1995 11.979 56.7647 12.3347 56.7647 12.8683C56.7647 13.3228 57.1402 13.5797 57.8319 13.7378L59.6698 14.1331C61.2903 14.4888 62.1796 15.2398 62.1796 16.8208C62.1796 18.9353 60.3812 20.2199 57.8121 20.2199C55.2035 20.2199 53.5632 18.8365 53.5632 16.8405Z"
        fill="black"
      />
      <Path
        d="M68.1348 20.2199C65.1507 20.2199 63.0164 18.046 63.0164 15.0026C63.0164 11.9197 65.0914 9.76562 68.0755 9.76562C71.1782 9.76562 73.1149 11.8011 73.1149 15.0224V15.7931L65.9412 15.8326C66.119 17.137 66.8502 17.7496 68.1941 17.7496C69.3403 17.7496 70.1505 17.3346 70.3679 16.6231H73.1544C72.7987 18.8167 70.8422 20.2199 68.1348 20.2199ZM68.0953 12.2359C66.8898 12.2359 66.2178 12.7695 65.9807 13.9552H70.0913C70.0913 12.9078 69.3205 12.2359 68.0953 12.2359Z"
        fill="black"
      />
      <Path
        d="M77.0346 20.2201H73.9912V5.31934H77.0346V13.8962L80.2361 10.339H84.0502L80.3349 14.2519L83.9316 20.2201H80.4139L78.2006 16.5245L77.0346 17.7498V20.2201Z"
        fill="black"
      />
      <Path
        d="M86.626 8.79727C85.6577 8.79727 84.887 8.02654 84.887 7.05818C84.887 6.08983 85.6577 5.33887 86.626 5.33887C87.5746 5.33887 88.3454 6.08983 88.3454 7.05818C88.3454 8.02654 87.5746 8.79727 86.626 8.79727ZM85.1241 20.2199V10.3387H88.1675V18.2117C88.1675 19.3208 87.2684 20.2199 86.1593 20.2199H85.1241Z"
        fill="black"
      />
    </Svg>
  )

  const LogoWithoutRectangle = () => (
    <Svg width="58" height="15" viewBox="0 0 58 15" fill="none">
      <Path
        d="M3.01365 14.9009H2.0082C0.899102 14.9009 0 14.0018 0 12.8927V2.07998C0 0.970878 0.899103 0.0717773 2.0082 0.0717773H3.03322V6.14335C3.63987 5.30278 4.75531 4.81408 6.02731 4.81408C8.35604 4.81408 9.70631 6.29973 9.70631 8.86052V14.9009H6.69266V9.5838C6.69266 8.35228 6.00774 7.55081 4.97057 7.55081C3.77685 7.55081 3.01365 8.33273 3.01365 9.5447V14.9009Z"
        fill="black"
      />
      <Path
        d="M10.543 9.70308C10.543 6.58064 12.8354 4.48584 15.9974 4.48584C19.1396 4.48584 21.432 6.58064 21.432 9.70308C21.432 12.8255 19.1396 14.9006 15.9974 14.9006C12.8354 14.9006 10.543 12.8255 10.543 9.70308ZM13.6061 9.68332C13.6061 11.1853 14.5745 12.1734 15.9974 12.1734C17.4005 12.1734 18.3688 11.1853 18.3688 9.68332C18.3688 8.20115 17.4005 7.21303 15.9974 7.21303C14.5745 7.21303 13.6061 8.20115 13.6061 9.68332Z"
        fill="black"
      />
      <Path
        d="M22.2688 11.5212H25.1541C25.1936 12.2129 25.7074 12.6279 26.6363 12.6279C27.5848 12.6279 28.0196 12.2919 28.0196 11.7781C28.0196 11.4817 27.8615 11.1655 27.1303 11.0074L25.3122 10.6121C23.4941 10.2169 22.6048 9.42638 22.6048 7.6873C22.6048 5.63203 24.3636 4.44629 26.7351 4.44629C29.0275 4.44629 30.6282 5.79012 30.6282 7.78611H27.7429C27.7429 7.1142 27.3279 6.65966 26.5967 6.65966C25.9051 6.65966 25.4703 7.01539 25.4703 7.54897C25.4703 8.0035 25.8458 8.26041 26.5374 8.41851L28.3753 8.81375C29.9958 9.16947 30.8851 9.92044 30.8851 11.5014C30.8851 13.616 29.0868 14.9005 26.5177 14.9005C23.9091 14.9005 22.2688 13.5172 22.2688 11.5212Z"
        fill="black"
      />
      <Path
        d="M36.8404 14.9005C33.8562 14.9005 31.7219 12.7267 31.7219 9.68329C31.7219 6.60038 33.797 4.44629 36.7811 4.44629C39.8837 4.44629 41.8204 6.4818 41.8204 9.70305V10.4738L34.6467 10.5133C34.8246 11.8176 35.5558 12.4302 36.8996 12.4302C38.0459 12.4302 38.8561 12.0152 39.0735 11.3038H41.86C41.5043 13.4974 39.5478 14.9005 36.8404 14.9005ZM36.8008 6.91657C35.5953 6.91657 34.9234 7.45015 34.6863 8.63589H38.7968C38.7968 7.58849 38.0261 6.91657 36.8008 6.91657Z"
        fill="black"
      />
      <Path
        d="M45.7402 14.9008H42.6968V0H45.7402V8.57683L48.9417 5.01962H52.7558L49.0405 8.93255L52.6372 14.9008H49.1195L46.9061 11.2052L45.7402 12.4305V14.9008Z"
        fill="black"
      />
      <Path
        d="M55.3316 3.47793C54.3633 3.47793 53.5925 2.7072 53.5925 1.73885C53.5925 0.770497 54.3633 0.0195312 55.3316 0.0195312C56.2802 0.0195312 57.0509 0.770497 57.0509 1.73885C57.0509 2.7072 56.2802 3.47793 55.3316 3.47793ZM53.8297 14.9005V5.01939H56.8731V12.8923C56.8731 14.0014 55.974 14.9005 54.8649 14.9005H53.8297Z"
        fill="black"
      />
    </Svg>
  )
  interface TextProps {
    children: React.ReactNode
    style?: ViewProps['style']
  }

  const SectionTitle: React.FC<TextProps> = ({ children, style }) => (
    <Text style={style ? [styles.sectionTitle, ...(Array.isArray(style) ? style : [style])] : styles.sectionTitle}>
      {children}
    </Text>
  )

  // Define column names as const objects
  const TransactionColumn = {
    Date: 'Date',
    MoneyOut: 'Money Out',
    MoneyIn: 'Money In',
    ClosingBalance: 'Closing Balance',
  } as const

  const SummaryColumn = {
    Account: 'Account',
    OpeningBalance: 'Opening Balance',
    MoneyOut: 'Money Out',
    MoneyIn: 'Money In',
    ClosingBalance: 'Closing Balance',
  } as const

  // Type for column widths
  type ColumnWidths = Record<string, number>

  // Define column widths using the const objects
  const TRANSACTION_COLUMN_WIDTHS = {
    [TransactionColumn.Date]: 260,
    [TransactionColumn.MoneyOut]: 105,
    [TransactionColumn.MoneyIn]: 105,
    [TransactionColumn.ClosingBalance]: 120,
  } satisfies ColumnWidths

  const SUMMARY_COLUMN_WIDTHS = {
    [SummaryColumn.Account]: 130,
    [SummaryColumn.OpeningBalance]: 125,
    [SummaryColumn.MoneyOut]: 100,
    [SummaryColumn.MoneyIn]: 100,
    [SummaryColumn.ClosingBalance]: 120,
  } satisfies ColumnWidths

  const CoverPageColumn = {
    Account: 'Account',
    Currency: 'Currency',
    Amount: 'Amount',
    Rate: 'Rate',
    Value: 'Value',
  } as const

  const COVER_PAGE_COLUMN_WIDTHS = {
    [CoverPageColumn.Account]: 120,
    [CoverPageColumn.Currency]: 100,
    [CoverPageColumn.Amount]: 100,
    [CoverPageColumn.Rate]: 100,
    [CoverPageColumn.Value]: 120,
  } satisfies ColumnWidths

  interface TableHeaderProps {
    columns: string[]
    columnWidths: ColumnWidths
  }

  const TableHeader: React.FC<TableHeaderProps> = ({ columns, columnWidths }) => (
    <View style={styles.tableHeader}>
      {columns.map((column, index) => {
        const width = columnWidths[column]
        if (width === undefined || width === 0 || Number.isNaN(width)) {
          throw new Error(`Column width not found for column key: ${column}`)
        }
        return (
          <View key={index} style={[styles.cell, { width }]}>
            <Text style={styles.tableHeaderText}>{column}</Text>
          </View>
        )
      })}
    </View>
  )

  interface TableProps<T> {
    data: T[]
    columns: string[]
    columnWidths: ColumnWidths
    RowComponent: React.FC<{ item: T; index: number }>
    rowsPerPage?: number
  }

  const Table = <T,>({ data, columns, columnWidths, RowComponent, rowsPerPage }: TableProps<T>) => {
    return (
      <View>
        <View>
          {data.length === 0 ? (
            <View
              style={{
                paddingTop: 112,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: tokens.spacing.sm,
              }}
            >
              <CalendarIcon />
              <View
                style={{
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: tokens.spacing.xs,
                }}
              >
                <Text
                  style={{
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: tokens.typography.fontWeights.medium,
                    color: getColor('neutral.500'),
                    textAlign: 'center',
                  }}
                >
                  No Transactions to Display
                </Text>
                <Text
                  style={{
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: tokens.typography.fontWeights.regular,
                    color: getColor('neutral.500'),
                    textAlign: 'center',
                  }}
                >
                  There were no transactions or balance changes during this period.
                </Text>
              </View>
            </View>
          ) : (
            <>
              <TableHeader columns={columns} columnWidths={columnWidths} />
              {data.map((item, rowIndex) => {
                const originalIndex =
                  rowsPerPage !== undefined && rowsPerPage !== 0 && !Number.isNaN(rowsPerPage)
                    ? rowIndex * rowsPerPage + rowIndex
                    : rowIndex
                return <RowComponent key={originalIndex} item={item} index={originalIndex} />
              })}
            </>
          )}
        </View>
      </View>
    )
  }

  interface TableRowProps {
    children: React.ReactNode
    index: number
    isAlternate?: boolean
  }

  const TableRow: React.FC<TableRowProps> = ({ children, index, isAlternate }) => (
    <View style={[styles.tableRow, ...(isAlternate === true || index % 2 === 1 ? [styles.tableRowAlternate] : [])]}>
      {children}
    </View>
  )

  interface CellProps {
    children: React.ReactNode
    columnName: string
    columnWidths: ColumnWidths
  }

  const Cell: React.FC<CellProps> = ({ children, columnName, columnWidths }) => {
    const columnWidth = columnWidths[columnName] ?? 0
    const width = columnWidth === 0 || Number.isNaN(columnWidth) ? 120 : columnWidth

    return <View style={[styles.cell, { width }]}>{children}</View>
  }

  // Amount Related Components
  interface AmountDisplayProps {
    minorUnits: bigint
    quoteAmount: Decimal | null
    quoteCurrency: StatementQuoteCurrency
    currency: CurrencyCode
    isEmphasized?: boolean
    /** Nominal width of the amount's column. */
    columnWidth: number
  }

  const AmountDisplay: React.FC<AmountDisplayProps> = ({
    minorUnits,
    quoteAmount,
    currency,
    quoteCurrency,
    isEmphasized = false,
    columnWidth,
  }) => {
    const fontWeight = isEmphasized ? 'semibold' : 'normal'
    const btc = formatMinorToMajor(minorUnits, currency)
    const quote = formatQuote(quoteAmount, quoteCurrency)
    return (
      <View style={amountStyles.container}>
        <Text
          style={{
            ...amountStyles.btcAmount,
            fontSize: fitFontSize(btc, amountStyles.btcAmount.fontSize, columnWidth),
            fontWeight,
          }}
        >
          {btc}
        </Text>
        <Text
          style={{
            ...amountStyles.quoteAmount,
            fontSize: fitFontSize(quote, amountStyles.quoteAmount.fontSize, columnWidth),
            fontWeight,
          }}
        >
          {quote}
        </Text>
      </View>
    )
  }

  interface HosekiHeaderProps {
    proofNumber: number
  }

  const HosekiHeader: React.FC<HosekiHeaderProps> = ({ proofNumber }) => {
    return (
      <View fixed style={styles.headerRow}>
        <View style={styles.headerContent}>
          <View style={styles.leftColumn}>
            <Text style={styles.generatedWith}>Generated with Bitcoin Control Center</Text>
            <Text style={styles.statementNumber}>{`Statement #${proofNumber}`}</Text>
          </View>

          <View style={styles.rightColumn}>
            <Logo />
          </View>
        </View>
      </View>
    )
  }

  interface SummaryPageHeaderProps {
    user: {
      name: string | null
      email: string | null
      address: string | null
    }
    dateRange: string
    totalAmountMinorUnits: bigint
    totalQuoteAmount: string
    quoteCurrency: StatementQuoteCurrency
    currency: CurrencyCode
  }

  const SummaryPageHeader: React.FC<SummaryPageHeaderProps> = ({
    user,
    dateRange,
    totalAmountMinorUnits,
    totalQuoteAmount,
    currency,
    quoteCurrency,
  }) => {
    const hasName = user.name != null && user.name.trim() !== ''
    const hasAddress = user.address != null && user.address.trim() !== ''

    return (
      <View style={styles.summaryPageHeader}>
        <View style={styles.summaryPageHeaderContent}>
          {/* Left Column - Provided by the requester */}
          <View style={[styles.summaryLeftColumn, { gap: 0 }]}>
            <Text style={styles.providedByLabel}>Provided by user</Text>
            <View style={styles.contactContainer}>
              {hasName && <Text style={styles.nameText}>{user.name}</Text>}
              {user.email != null && user.email !== '' && <Text style={styles.emailText}>{user.email}</Text>}
              {hasAddress && <Text style={styles.addressText}>{user.address}</Text>}
            </View>
          </View>

          {/* Right Column - Date Range and Total */}
          <View style={styles.summaryRightColumn}>
            <Text style={styles.dateRange}>{dateRange}</Text>
            <View style={styles.totalContainer}>
              {currency === 'USD' ? (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>TOTAL:</Text>
                  <Text style={styles.totalBtcValue}>{formatMinorToMajor(totalAmountMinorUnits, currency)}</Text>
                </View>
              ) : (
                <>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>TOTAL:</Text>
                    <Text style={styles.totalBtcValue}>{formatMinorToMajor(totalAmountMinorUnits, currency)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalQuoteLabel}>APPROX. {quoteCurrency} VALUE:</Text>
                    <Text style={styles.totalQuoteValue}>{totalQuoteAmount}</Text>
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
      </View>
    )
  }

  interface HosekiFooterProps {
    quoteCurrency: StatementQuoteCurrency
    provider: string
    providerUrl?: string
    providerUrls?: string[]
    qrCodeSrc: string
  }

  const RightColumnContent: React.FC<Pick<HosekiFooterProps, 'qrCodeSrc'>> = ({ qrCodeSrc }) => (
    <View style={footerStyles.rightColumnContent}>
      <Text style={footerStyles.instructionsTitle}>Contact</Text>
      <View style={footerStyles.linksContainer}>
        <Text style={footerStyles.footerText}>support@hoseki.app</Text>
        <Text style={footerStyles.link}>www.hoseki.app</Text>
      </View>
      {qrCodeSrc && <Image src={qrCodeSrc} style={footerStyles.qrCode} />}
    </View>
  )

  const HosekiFooter: React.FC<HosekiFooterProps> = ({
    qrCodeSrc,
    quoteCurrency,
    provider,
    providerUrl,
    providerUrls,
  }) => {
    // Only the public instance is linked; every self-hosted address, which can reveal a home
    // network or onion service, collapses into one plain label.
    const sources = [
      ...new Set(
        (providerUrls ?? (providerUrl !== undefined ? [providerUrl] : [])).map((url) =>
          url === PUBLIC_MEMPOOL_URL ? url : provider === 'mempool' ? 'configured mempool' : provider,
        ),
      ),
    ]
    return (
      <View style={footerStyles.container} fixed>
        <View style={footerStyles.innerContainer}>
          <View style={footerStyles.row}>
            {/* Left Column */}
            <View style={footerStyles.leftColumn}>
              <LogoWithoutRectangle />
              <View style={footerStyles.subtitle}>
                <Text>Proving Ownership{'\n'}for Digital Assets</Text>
              </View>
            </View>

            {/* Center Column */}
            <View style={footerStyles.centerColumn}>
              <Text style={footerStyles.instructionsTitle}>About This Statement</Text>
              <View style={footerStyles.instructionsTextBlock}>
                <Text style={footerStyles.instructionsText}>
                  This statement shows your Bitcoin holdings for the specified period. Wallet balances and transactions
                  come from the Bitcoin blockchain, and each included wallet passed a proof-of-control signature in
                  Bitcoin Control Center. {quoteCurrency} values are approximate, using saved Bitcoin-to-{quoteCurrency}{' '}
                  rates from{' '}
                  {sources.length > 0
                    ? sources.map((source, index) => (
                        <React.Fragment key={source}>
                          {index > 0 && ' and '}
                          {source === PUBLIC_MEMPOOL_URL ? <Link src={source}>mempool.space</Link> : source}
                        </React.Fragment>
                      ))
                    : provider}
                  .
                  {provider === 'mempool' &&
                    ' The saved historical price may be from before or after the valuation day.'}{' '}
                  For questions or discrepancies, please contact support@hoseki.app.
                </Text>
              </View>
            </View>

            {/* Right Column */}
            <View style={footerStyles.rightColumn}>
              <RightColumnContent qrCodeSrc={qrCodeSrc} />
            </View>
          </View>
        </View>

        <Text
          style={footerStyles.pageNumber}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    )
  }

  type SummaryRowDisplayData = Omit<StatementEntry, 'transactions'>

  interface SummaryTableRowProps {
    item: SummaryRowDisplayData
    index: number
    quoteCurrency: StatementQuoteCurrency
    currency: CurrencyCode
    timezone: string
  }

  const SummaryTableRow: React.FC<SummaryTableRowProps> = ({
    item: tableRow,
    index,
    currency,
    quoteCurrency,
    timezone,
  }) => (
    <TableRow key={index} index={index}>
      <Cell columnName={SummaryColumn.Account} columnWidths={SUMMARY_COLUMN_WIDTHS}>
        <Text
          style={{
            ...styles.transactionRowText,
            fontWeight: tableRow.displayName === 'Total' ? 'bold' : 'normal',
          }}
        >
          {tableRow.displayName}
        </Text>
        {tableRow.ownershipProvenAt && (
          <Text style={styles.ownershipProvenText}>
            {`Ownership proven ${formatTzDate(tableRow.ownershipProvenAt, 'MMM d, yyyy', timezone)}`}
          </Text>
        )}
      </Cell>
      <Cell columnName={SummaryColumn.OpeningBalance} columnWidths={SUMMARY_COLUMN_WIDTHS}>
        <AmountDisplay
          columnWidth={SUMMARY_COLUMN_WIDTHS[SummaryColumn.OpeningBalance]}
          minorUnits={tableRow.openingBalance.sats}
          quoteAmount={tableRow.openingBalance.quoteValue}
          currency={currency}
          quoteCurrency={quoteCurrency}
          isEmphasized={tableRow.displayName === 'Total'}
        />
      </Cell>
      <Cell columnName={SummaryColumn.MoneyOut} columnWidths={SUMMARY_COLUMN_WIDTHS}>
        <AmountDisplay
          columnWidth={SUMMARY_COLUMN_WIDTHS[SummaryColumn.MoneyOut]}
          minorUnits={tableRow.moneyOut.sats}
          quoteAmount={tableRow.moneyOut.quoteValue}
          currency={currency}
          quoteCurrency={quoteCurrency}
          isEmphasized={tableRow.displayName === 'Total'}
        />
      </Cell>
      <Cell columnName={SummaryColumn.MoneyIn} columnWidths={SUMMARY_COLUMN_WIDTHS}>
        <AmountDisplay
          columnWidth={SUMMARY_COLUMN_WIDTHS[SummaryColumn.MoneyIn]}
          minorUnits={tableRow.moneyIn.sats}
          quoteAmount={tableRow.moneyIn.quoteValue}
          currency={currency}
          quoteCurrency={quoteCurrency}
          isEmphasized={tableRow.displayName === 'Total'}
        />
      </Cell>
      <Cell columnName={SummaryColumn.ClosingBalance} columnWidths={SUMMARY_COLUMN_WIDTHS}>
        <AmountDisplay
          columnWidth={SUMMARY_COLUMN_WIDTHS[SummaryColumn.ClosingBalance]}
          minorUnits={tableRow.closingBalance.sats}
          quoteAmount={tableRow.closingBalance.quoteValue}
          currency={currency}
          quoteCurrency={quoteCurrency}
          isEmphasized={tableRow.displayName === 'Total'}
        />
      </Cell>
    </TableRow>
  )

  type CoverPageRowData = {
    displayName: string
    currency: CurrencyCode
    closingBalance: { sats: bigint; quoteValue: Decimal }
  }

  interface CoverPageTableRowProps {
    item: CoverPageRowData
    index: number
  }

  const CoverPageTableRow: React.FC<CoverPageTableRowProps> = ({ item: tableRow, index }) => {
    // Calculate rate: USD value / major units
    const currencyObj = currencies[tableRow.currency]
    const majorUnits = Money.fromMinor(currencyObj, tableRow.closingBalance.sats).toMajorAmount()
    const rate = majorUnits.isZero() ? new Decimal(0) : tableRow.closingBalance.quoteValue.div(majorUnits)

    return (
      <TableRow key={index} index={index}>
        <Cell columnName={CoverPageColumn.Account} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={styles.transactionRowText}>{tableRow.displayName}</Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Currency} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={styles.transactionRowText}>{tableRow.currency}</Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Rate} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={{ ...styles.transactionRowText }}>${rate.toFixed(2)}</Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Amount} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={styles.transactionRowText}>{majorUnits.toFixed(6)}</Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Value} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={{ ...styles.transactionRowText }}>{formatQuote(tableRow.closingBalance.quoteValue)}</Text>
        </Cell>
      </TableRow>
    )
  }

  interface CoverPageFooterRowProps {
    totalQuoteValue: Decimal
  }

  const CoverPageFooterRow: React.FC<CoverPageFooterRowProps> = ({ totalQuoteValue }) => {
    return (
      <TableRow index={-1}>
        <Cell columnName={CoverPageColumn.Account} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={{ ...styles.transactionRowText, fontWeight: 'semibold' }}>Total</Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Currency} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={styles.transactionRowText}></Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Amount} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={styles.transactionRowText}></Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Rate} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={styles.transactionRowText}></Text>
        </Cell>
        <Cell columnName={CoverPageColumn.Value} columnWidths={COVER_PAGE_COLUMN_WIDTHS}>
          <Text style={{ ...styles.transactionRowText, fontWeight: 'semibold' }}>{formatQuote(totalQuoteValue)}</Text>
        </Cell>
      </TableRow>
    )
  }

  type SummaryTableProps =
    | {
        statement: CustomPdfStatement
        dateRange: string
        format: 'custom'
        monthlySummary?: never
      }
    | {
        statement: MonthlyPdfStatement
        format: 'monthly'
        monthlySummary: {
          entries: SummaryEntry[]
          monthOpeningDate: Date
          monthClosingDate: Date
        }
        dateRange?: never
      }

  const SummaryTable: React.FC<SummaryTableProps> = (props) => {
    const columns = [
      SummaryColumn.Account,
      SummaryColumn.OpeningBalance,
      SummaryColumn.MoneyOut,
      SummaryColumn.MoneyIn,
      SummaryColumn.ClosingBalance,
    ]

    const currency = props.statement.currency
    const quoteCurrency = props.statement.quoteCurrency

    // Create a wrapper component that captures currency
    const RowComponentWithCurrency: React.FC<{ item: SummaryRowDisplayData; index: number }> = ({ item, index }) => (
      <SummaryTableRow
        item={item}
        index={index}
        currency={currency}
        quoteCurrency={quoteCurrency}
        timezone={props.statement.timezone}
      />
    )

    if (props.format === 'custom') {
      // Custom format behavior: single summary table for entire period
      const tableRows = props.statement.summary.entries.concat([
        {
          ...props.statement.summary,
          displayName: 'Total',
        },
      ])

      return (
        <View>
          <SectionTitle>{`Summary: ${props.dateRange}`}</SectionTitle>
          <Table
            data={tableRows}
            columns={columns}
            columnWidths={SUMMARY_COLUMN_WIDTHS}
            RowComponent={RowComponentWithCurrency}
            rowsPerPage={MAX_ROWS_PER_PAGE}
          />
        </View>
      )
    }

    const dateRange = formatDateRange(
      props.monthlySummary.monthOpeningDate,
      props.monthlySummary.monthClosingDate,
      props.statement.timezone,
    )

    return (
      <View>
        <SectionTitle>{`Summary: ${dateRange}`}</SectionTitle>
        <Table
          data={props.monthlySummary.entries}
          columns={columns}
          columnWidths={SUMMARY_COLUMN_WIDTHS}
          RowComponent={RowComponentWithCurrency}
          rowsPerPage={MAX_ROWS_PER_PAGE}
        />
      </View>
    )
  }

  interface CoverPageTableProps {
    entries: CoverPageRowData[]
    dateRange: string
  }

  const CoverPageTable: React.FC<CoverPageTableProps> = ({ entries, dateRange }) => {
    const columns = [
      CoverPageColumn.Account,
      CoverPageColumn.Currency,
      CoverPageColumn.Rate,
      CoverPageColumn.Amount,
      CoverPageColumn.Value,
    ]

    // Calculate total USD value
    const totalQuoteValue = entries.reduce((sum, entry) => sum.plus(entry.closingBalance.quoteValue), new Decimal(0))

    const RowComponent: React.FC<{ item: CoverPageRowData; index: number }> = ({ item, index }) => (
      <CoverPageTableRow item={item} index={index} />
    )

    return (
      <View>
        <SectionTitle>{`Summary: ${dateRange}`}</SectionTitle>
        <Table
          data={entries}
          columns={columns}
          columnWidths={COVER_PAGE_COLUMN_WIDTHS}
          RowComponent={RowComponent}
          rowsPerPage={MAX_ROWS_PER_PAGE}
        />
        <View style={{ marginTop: 8 }}>
          <CoverPageFooterRow totalQuoteValue={totalQuoteValue} />
        </View>
      </View>
    )
  }

  interface TransactionTableRowProps {
    item: StatementTransaction
    index: number
    timezone: string
    quoteCurrency: StatementQuoteCurrency
    currency: CurrencyCode
  }

  const TransactionTableRow: React.FC<TransactionTableRowProps> = ({
    item: transaction,
    index,
    timezone,
    currency,
    quoteCurrency,
  }) => {
    const rowKey = `tx-${index}`
    return (
      <TableRow key={rowKey} index={index}>
        <Cell columnName={TransactionColumn.Date} columnWidths={TRANSACTION_COLUMN_WIDTHS}>
          <Text style={styles.transactionRowText}>
            {(transaction.blockHeight !== null &&
              transaction.blockHeight !== 0 &&
              !Number.isNaN(transaction.blockHeight)) ||
            transaction.confirmed
              ? formatTzDate(transaction.date, 'yyyy-MM-dd HH:mm:ss', timezone)
              : 'PENDING'}
          </Text>
        </Cell>
        <Cell columnName={TransactionColumn.MoneyOut} columnWidths={TRANSACTION_COLUMN_WIDTHS}>
          {transaction.amount.sats < 0n && (
            <AmountDisplay
              columnWidth={TRANSACTION_COLUMN_WIDTHS[TransactionColumn.MoneyOut]}
              minorUnits={transaction.amount.sats}
              quoteAmount={transaction.amount.quoteValue}
              currency={currency}
              quoteCurrency={quoteCurrency}
            />
          )}
        </Cell>
        <Cell columnName={TransactionColumn.MoneyIn} columnWidths={TRANSACTION_COLUMN_WIDTHS}>
          {transaction.amount.sats > 0n && (
            <AmountDisplay
              columnWidth={TRANSACTION_COLUMN_WIDTHS[TransactionColumn.MoneyIn]}
              minorUnits={transaction.amount.sats}
              quoteAmount={transaction.amount.quoteValue}
              currency={currency}
              quoteCurrency={quoteCurrency}
            />
          )}
        </Cell>
        <Cell columnName={TransactionColumn.ClosingBalance} columnWidths={TRANSACTION_COLUMN_WIDTHS}>
          <AmountDisplay
            columnWidth={TRANSACTION_COLUMN_WIDTHS[TransactionColumn.ClosingBalance]}
            minorUnits={transaction.balance.sats}
            quoteAmount={transaction.balance.quoteValue}
            currency={currency}
            quoteCurrency={quoteCurrency}
          />
        </Cell>
      </TableRow>
    )
  }

  interface TransactionTableProps {
    data: StatementTransaction[]
    columns: string[]
    columnWidths: ColumnWidths
    title: React.ReactNode | null
    timezone: string
    quoteCurrency: StatementQuoteCurrency
    currency: CurrencyCode
  }

  const TransactionTable: React.FC<TransactionTableProps> = ({
    data,
    columns,
    columnWidths,
    title,
    timezone,
    currency,
    quoteCurrency,
  }) => {
    const ActualRowComponent: React.FC<{ item: StatementTransaction; index: number }> = ({ item, index }) => (
      <TransactionTableRow
        item={item}
        index={index}
        timezone={timezone}
        currency={currency}
        quoteCurrency={quoteCurrency}
      />
    )

    return (
      <View>
        {title}
        <Table data={data} columns={columns} columnWidths={columnWidths} RowComponent={ActualRowComponent} />
      </View>
    )
  }

  interface TransactionsPagesProps {
    statementEntry: StatementEntry
    dateRange: string
    timezone: string
    proofNumber: number
    qrCodeSrc: string
    watermarkText: string
    quoteCurrency: StatementQuoteCurrency
    currency: CurrencyCode
    quoteProviderUrl?: string
    quoteProviderUrls?: string[]
    quoteProvider: string
  }

  const TransactionsPages: React.FC<TransactionsPagesProps> = ({
    statementEntry,
    dateRange,
    timezone,
    proofNumber,
    qrCodeSrc,
    watermarkText,
    currency,
    quoteCurrency,
    quoteProviderUrl,
    quoteProviderUrls,
    quoteProvider,
  }) => {
    const transactions = statementEntry.transactions

    // Always show at least one page, even if there are no transactions
    const chunks: StatementTransaction[][] = []
    if (transactions.length === 0) {
      // Create one empty chunk for accounts with no transactions
      chunks.push([])
    } else {
      for (let i = 0; i < transactions.length; i += MAX_ROWS_PER_PAGE) {
        chunks.push(transactions.slice(i, i + MAX_ROWS_PER_PAGE))
      }
    }

    const title = (
      <SectionTitle style={styles.accountTitle}>{`${statementEntry.displayName}: ${dateRange}`}</SectionTitle>
    )

    return chunks.map((chunk, chunkIndex) => (
      <Page size="A4" style={styles.page} key={`entry-${statementEntry.displayName}-chunk-${chunkIndex}`}>
        <View style={styles.headerAndMainContainer}>
          <HosekiHeader proofNumber={proofNumber} />

          <View style={styles.mainContentContainer}>
            <View style={styles.contentWrapper}>
              <TransactionTable
                data={chunk}
                columns={[
                  TransactionColumn.Date,
                  TransactionColumn.MoneyOut,
                  TransactionColumn.MoneyIn,
                  TransactionColumn.ClosingBalance,
                ]}
                columnWidths={TRANSACTION_COLUMN_WIDTHS}
                title={chunkIndex === 0 ? title : null}
                timezone={timezone}
                currency={currency}
                quoteCurrency={quoteCurrency}
              />
            </View>
          </View>
        </View>
        <HosekiFooter
          qrCodeSrc={qrCodeSrc}
          quoteCurrency={quoteCurrency}
          provider={quoteProvider}
          providerUrl={quoteProviderUrl}
          providerUrls={quoteProviderUrls}
        />
        {watermarkText && (
          <View style={styles.watermarkContainer}>
            <StatementExampleWatermark watermarkText={watermarkText} />
          </View>
        )}
      </Page>
    ))
  }

  const CustomStatementDocument = ({ input, qrCode }: { input: DocumentInput; qrCode: string }) => {
    const statement = input.statement
    if (statement.format !== 'custom') {
      return null
    }

    const timezone = statement.timezone
    const proofNum = statement.counter

    // Custom format behavior: single summary + all transactions
    const customStatement = statement
    const totalQuoteValue = formatQuote(customStatement.summary.closingBalance.quoteValue, statement.quoteCurrency)
    const totalBtcSats = customStatement.summary.closingBalance.sats
    const { openingDate, closingDate } = customStatement.summary
    const dateRange = formatDateRange(openingDate, closingDate, timezone)

    return (
      <Document>
        <Page size="A4" style={styles.page}>
          <View style={styles.headerAndMainContainer}>
            <HosekiHeader proofNumber={proofNum} />
            <SummaryPageHeader
              user={statement.user}
              dateRange={dateRange}
              totalAmountMinorUnits={totalBtcSats}
              totalQuoteAmount={totalQuoteValue}
              currency={statement.currency}
              quoteCurrency={statement.quoteCurrency}
            />
            <View style={styles.mainContentContainer}>
              <View style={styles.contentWrapper}>
                <SummaryTable statement={customStatement} dateRange={dateRange} format="custom" />
              </View>
            </View>
          </View>
          <HosekiFooter
            qrCodeSrc={qrCode}
            quoteCurrency={statement.quoteCurrency}
            provider={customStatement.summary.closingBalance.provider}
            providerUrl={statement.quoteProviderUrl}
            providerUrls={statement.quoteProviderUrls}
          />
          {input.watermarkText && (
            <View style={styles.watermarkContainer}>
              <StatementExampleWatermark watermarkText={input.watermarkText} />
            </View>
          )}
        </Page>

        {customStatement.statementEntries.map((statementEntry, idx) => (
          <TransactionsPages
            key={`transactions-${idx}`}
            statementEntry={statementEntry}
            quoteProvider={customStatement.summary.closingBalance.provider}
            quoteProviderUrl={statement.quoteProviderUrl}
            quoteProviderUrls={statement.quoteProviderUrls}
            dateRange={dateRange}
            timezone={timezone}
            proofNumber={proofNum}
            qrCodeSrc={qrCode}
            watermarkText={input.watermarkText}
            currency={statement.currency}
            quoteCurrency={statement.quoteCurrency}
          />
        ))}
      </Document>
    )
  }

  const formatPeriod = (monthOpeningDate: Date, monthClosingDate: Date, timezone: string): string => {
    const startTz = new TZDate(monthOpeningDate, timezone)
    const endTz = new TZDate(monthClosingDate, timezone)

    // Check if this is a full calendar month
    if (isSameMonth(startTz, endTz) && isFirstDayOfMonth(startTz) && isLastDayOfMonth(endTz)) {
      // Full calendar month - show just "Month Year"
      return format(startTz, 'MMMM yyyy')
    } else {
      // Partial month - show date range
      return formatDateRange(startTz, endTz, timezone)
    }
  }

  const MonthlyStatementDocument = ({ input, qrCode }: { input: DocumentInput; qrCode: string }) => {
    const statement = input.statement
    if (statement.format !== 'monthly') {
      return null
    }

    const pages: React.ReactElement[] = []
    const timezone = statement.timezone
    const proofNum = statement.counter
    const monthlyStatement = statement

    for (const month of monthlyStatement.months) {
      // Add 1 summary page for each month
      const monthDateRange = formatPeriod(month.summary.openingDate, month.summary.closingDate, timezone)
      pages.push(
        <Page size="A4" style={styles.page} key={`${statement.id}-month-${month.summary.openingDate.toISOString()}`}>
          <View style={styles.headerAndMainContainer}>
            <HosekiHeader proofNumber={proofNum} />
            <SummaryPageHeader
              user={statement.user}
              dateRange={monthDateRange}
              totalAmountMinorUnits={month.summary.closingBalance.sats}
              totalQuoteAmount={formatQuote(month.summary.closingBalance.quoteValue, statement.quoteCurrency)}
              currency={statement.currency}
              quoteCurrency={statement.quoteCurrency}
            />
            <View style={styles.mainContentContainer}>
              <View style={styles.contentWrapper}>
                <SummaryTable
                  statement={monthlyStatement}
                  format="monthly"
                  monthlySummary={{
                    ...month.summary,
                    monthOpeningDate: month.summary.openingDate,
                    monthClosingDate: month.summary.closingDate,
                  }}
                />
              </View>
            </View>
          </View>
          <HosekiFooter
            qrCodeSrc={qrCode}
            quoteCurrency={statement.quoteCurrency}
            provider={month.summary.closingBalance.provider}
            providerUrl={statement.quoteProviderUrl}
            providerUrls={statement.quoteProviderUrls}
          />
          {input.watermarkText && (
            <View style={styles.watermarkContainer}>
              <StatementExampleWatermark watermarkText={input.watermarkText} />
            </View>
          )}
        </Page>,
      )

      // adding 1 chunk of transactions pages for each account
      for (const statementEntry of month.statementEntries) {
        pages.push(
          <TransactionsPages
            key={`${statement.id}-transactions-${statementEntry.displayName}-${month.summary.openingDate.toISOString()}`}
            statementEntry={statementEntry}
            quoteProvider={month.summary.closingBalance.provider}
            quoteProviderUrl={statement.quoteProviderUrl}
            quoteProviderUrls={statement.quoteProviderUrls}
            dateRange={formatDateRange(month.summary.openingDate, month.summary.closingDate, timezone)}
            timezone={timezone}
            proofNumber={proofNum}
            qrCodeSrc={qrCode}
            watermarkText={input.watermarkText}
            currency={statement.currency}
            quoteCurrency={statement.quoteCurrency}
          />,
        )
      }
    }

    return <Document>{pages}</Document>
  }

  const EnvelopeDocument = ({ input, qrCode }: { input: EnvelopeDocumentInput; qrCode: string }) => {
    if (input.statements.some((statement) => statement.quoteCurrency !== 'USD')) {
      throw new Error('Combined envelopes require USD statements. Render other currencies individually.')
    }
    // Check if cover page is needed (multiple currencies)
    const needsCoverPage = input.statements.length > 1

    // Aggregate data from all statements for cover page
    let coverPageEntries: CoverPageRowData[] = []
    let coverPageDateRange = ''
    let grandTotalUsd = new Decimal(0)
    let firstStatement: PdfStatement | null = null

    if (needsCoverPage) {
      const potentialFirstStatement = input.statements[0]
      if (!potentialFirstStatement) {
        throw new Error('Cover page requires at least one statement')
      }
      firstStatement = potentialFirstStatement
      const allEntries: CoverPageRowData[] = []

      // Calculate date range from first statement
      const firstCustomStatement = firstStatement.format === 'custom' ? firstStatement : null
      if (firstCustomStatement) {
        coverPageDateRange = formatDateRange(
          firstCustomStatement.summary.openingDate,
          firstCustomStatement.summary.closingDate,
          firstStatement.timezone,
        )
      }

      // Collect entries from all statements
      for (const statement of input.statements) {
        if (statement.format !== 'custom') {
          continue
        }
        const customStatement = statement
        const currency = statement.currency

        // Add each entry with its currency
        for (const entry of customStatement.summary.entries) {
          allEntries.push({
            displayName: entry.displayName,
            currency: currency,
            closingBalance: entry.closingBalance,
          })
        }
      }

      // Calculate grand total (USD only) - sum of all closing balances
      grandTotalUsd = allEntries.reduce((sum, entry) => sum.plus(entry.closingBalance.quoteValue), new Decimal(0))

      coverPageEntries = allEntries
    }

    return (
      <Document>
        {needsCoverPage && firstStatement && (
          <Page size="A4" style={styles.page}>
            <View style={styles.headerAndMainContainer}>
              <HosekiHeader proofNumber={firstStatement.counter} />
              <SummaryPageHeader
                user={firstStatement.user}
                dateRange={coverPageDateRange}
                totalAmountMinorUnits={BigInt(USD.fromDollars(grandTotalUsd).amount.toFixed(0))}
                totalQuoteAmount={formatQuote(grandTotalUsd)}
                currency="USD"
                quoteCurrency="USD"
              />
              <View style={styles.mainContentContainer}>
                <View style={styles.contentWrapper}>
                  <CoverPageTable entries={coverPageEntries} dateRange={coverPageDateRange} />
                </View>
              </View>
            </View>
            {/* No footer for cover page */}
          </Page>
        )}
        {input.statements.map((statement, statementIdx) => {
          if (statement.format !== 'custom') {
            return null
          }

          const timezone = statement.timezone
          const proofNum = statement.counter

          // Custom format behavior: single summary + all transactions
          const customStatement = statement
          const totalQuoteValue = formatQuote(
            customStatement.summary.closingBalance.quoteValue,
            statement.quoteCurrency,
          )
          const totalBtcSats = customStatement.summary.closingBalance.sats
          const { openingDate, closingDate } = customStatement.summary
          const dateRange = formatDateRange(openingDate, closingDate, timezone)

          return (
            <React.Fragment key={`statement-${statementIdx}`}>
              <Page size="A4" style={styles.page}>
                <View style={styles.headerAndMainContainer}>
                  <HosekiHeader proofNumber={proofNum} />
                  <SummaryPageHeader
                    user={statement.user}
                    dateRange={dateRange}
                    totalAmountMinorUnits={totalBtcSats}
                    totalQuoteAmount={totalQuoteValue}
                    currency={statement.currency}
                    quoteCurrency={statement.quoteCurrency}
                  />
                  <View style={styles.mainContentContainer}>
                    <View style={styles.contentWrapper}>
                      <SummaryTable statement={customStatement} dateRange={dateRange} format="custom" />
                    </View>
                  </View>
                </View>
                <HosekiFooter
                  qrCodeSrc={qrCode}
                  quoteCurrency={statement.quoteCurrency}
                  provider={customStatement.summary.closingBalance.provider}
                  providerUrl={statement.quoteProviderUrl}
                  providerUrls={statement.quoteProviderUrls}
                />
                {input.watermarkText && (
                  <View style={styles.watermarkContainer}>
                    <StatementExampleWatermark watermarkText={input.watermarkText} />
                  </View>
                )}
              </Page>

              {customStatement.statementEntries.map((statementEntry, idx) => (
                <TransactionsPages
                  key={`statement-${statementIdx}-transactions-${idx}`}
                  statementEntry={statementEntry}
                  quoteProvider={customStatement.summary.closingBalance.provider}
                  quoteProviderUrl={statement.quoteProviderUrl}
                  quoteProviderUrls={statement.quoteProviderUrls}
                  dateRange={dateRange}
                  timezone={timezone}
                  proofNumber={proofNum}
                  qrCodeSrc={qrCode}
                  watermarkText={input.watermarkText}
                  currency={statement.currency}
                  quoteCurrency={statement.quoteCurrency}
                />
              ))}
            </React.Fragment>
          )
        })}
      </Document>
    )
  }

  return { CustomStatementDocument, MonthlyStatementDocument, EnvelopeDocument }
}
