import {
  Box,
  Flex,
  HStack,
  SimpleGrid,
  Spinner,
  Text,
  type UseRadioProps,
  useRadio,
  useRadioGroup,
} from '@chakra-ui/react'
import type { SingleSigAccountScriptType } from '@hoseki/packages/bitcoin'
import { getRecordValue } from '@hoseki/packages/lib'
import { useId } from 'react'
import { encodingsToLabels, labelsToEncodings, singlesigEncodings, toBitcoinAmountDisplayValue } from '../../utils'
import { primaryVariant } from '../theme/button-theme'

export type ScriptTypeBalanceState =
  | { status: 'loading'; balanceSats?: bigint }
  | { status: 'loaded'; balanceSats: bigint }
  | { status: 'error' }

export type ScriptTypeBalances = Partial<Record<SingleSigAccountScriptType, ScriptTypeBalanceState>>

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

const mainnetPrefixes: Record<SingleSigAccountScriptType, string> = {
  p2pkh: '1…',
  'p2sh-p2wpkh': '3…',
  p2wpkh: 'bc1q…',
  p2tr: 'bc1p…',
}

const testnetPrefixes: Record<SingleSigAccountScriptType, string> = {
  p2pkh: 'm…/n…',
  'p2sh-p2wpkh': '2…',
  p2wpkh: 'tb1q…',
  p2tr: 'tb1p…',
}

export function RollingBtcAmount({
  balanceSats,
  isChecked = false,
  color,
}: {
  balanceSats: bigint
  isChecked?: boolean
  color?: string
}): JSX.Element {
  const displayValue = toBitcoinAmountDisplayValue(balanceSats.toString())
  const chars = Array.from(displayValue)
  const resolvedColor = color ?? (isChecked ? 'success.300' : 'success.700')

  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      textStyle="label/sm"
      fontWeight="semibold"
      color={resolvedColor}
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <Box as="span" srOnly>
        {displayValue}
      </Box>
      <Flex as="span" aria-hidden="true" align="center" display="inline-flex">
        {chars.map((char, index) => {
          const placeKey = chars.length - 1 - index
          if (char >= '0' && char <= '9') {
            const digit = Number(char)
            return (
              <Box
                key={`d-${placeKey}`}
                as="span"
                display="inline-block"
                h="1.25em"
                overflow="hidden"
                position="relative"
              >
                <Box
                  as="span"
                  display="flex"
                  flexDirection="column"
                  style={{ transform: `translateY(-${digit * 1.25}em)` }}
                  sx={{
                    transition: 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)',
                    willChange: 'transform',
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  }}
                >
                  {DIGITS.map((item) => (
                    <Box key={item} as="span" h="1.25em" display="flex" alignItems="center" justifyContent="center">
                      {item}
                    </Box>
                  ))}
                </Box>
              </Box>
            )
          }
          return (
            <Box
              key={`c-${placeKey}-${char}`}
              as="span"
              h="1.25em"
              display="inline-flex"
              alignItems="center"
              whiteSpace="pre"
            >
              {char}
            </Box>
          )
        })}
      </Flex>
    </Box>
  )
}

export function getUniqueFundedScriptType(balances?: ScriptTypeBalances): SingleSigAccountScriptType | null {
  if (balances === undefined) {
    return null
  }
  const funded: SingleSigAccountScriptType[] = []
  for (const scriptType of singlesigEncodings) {
    const entry = balances[scriptType]
    if (entry?.status !== 'loaded') {
      return null
    }
    if (entry.balanceSats > 0n) {
      funded.push(scriptType)
    }
  }
  return funded.length === 1 ? (funded[0] ?? null) : null
}

function ScriptTypeCard({
  label,
  prefix,
  balance,
  radioProps,
}: {
  label: string
  prefix: string
  balance?: ScriptTypeBalanceState
  radioProps: UseRadioProps
}): JSX.Element {
  const idPrefix = useId()
  const labelId = `${idPrefix}-label`
  const prefixId = `${idPrefix}-prefix`
  const statusId = `${idPrefix}-status`
  const describedBy = balance !== undefined ? `${prefixId} ${statusId}` : prefixId

  const { state, getInputProps, getRadioProps } = useRadio(radioProps)
  const input = getInputProps()
  const card = { ...getRadioProps(), 'aria-hidden': undefined }
  const visibleSats = balance?.status === 'loaded' || balance?.status === 'loading' ? (balance.balanceSats ?? 0n) : 0n
  const isFunded = visibleSats > 0n

  return (
    <Box as="label" textAlign="left" display="block">
      <input {...input} aria-labelledby={labelId} aria-describedby={describedBy} />
      <Box
        {...card}
        cursor="pointer"
        borderWidth="1px"
        borderRadius="md"
        borderColor={isFunded ? 'success.300' : 'neutral.200'}
        bg={isFunded ? 'success.50' : 'neutral.50'}
        color="neutral.700"
        minH="44px"
        display="flex"
        flexDirection="column"
        justifyContent="center"
        gap={1.5}
        _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' }}
        _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
        _checked={primaryVariant}
        _hover={{ bg: isFunded ? 'success.100' : 'neutral.100' }}
        px={3}
        py={2.5}
      >
        <Flex align="center" justify="space-between" gap={2} w="full">
          <Text id={labelId} textStyle="text/sm" fontWeight="medium">
            {label}
          </Text>
          <Text
            id={prefixId}
            textStyle="label/xs"
            fontFamily="'Geist Mono', monospace"
            color={state.isChecked ? 'neutral.300' : 'neutral.500'}
            flexShrink={0}
          >
            {prefix}
          </Text>
        </Flex>

        {balance !== undefined && (
          <HStack id={statusId} spacing={1.5} minH="16px">
            {balance.status === 'loading' && (
              <Spinner
                aria-hidden="true"
                label=""
                size="xs"
                color={state.isChecked ? 'neutral.50' : isFunded ? 'success.600' : 'neutral.700'}
                emptyColor={state.isChecked ? 'neutral.700' : 'neutral.200'}
              />
            )}
            {balance.status === 'loaded' && isFunded && (
              <Box
                aria-hidden="true"
                w="6px"
                h="6px"
                borderRadius="full"
                bg={state.isChecked ? 'success.300' : 'success.600'}
                flexShrink={0}
              />
            )}
            {isFunded ? (
              <>
                <RollingBtcAmount balanceSats={visibleSats} isChecked={state.isChecked} />
                {balance.status === 'loading' && (
                  <Box as="span" srOnly>
                    {' '}
                    Scanning…
                  </Box>
                )}
              </>
            ) : balance.status === 'loading' ? (
              <Text textStyle="label/xs" color={state.isChecked ? 'neutral.300' : 'neutral.500'}>
                Scanning…
              </Text>
            ) : balance.status === 'loaded' ? (
              <Text textStyle="label/xs" color={state.isChecked ? 'neutral.400' : 'neutral.500'}>
                0 BTC
              </Text>
            ) : (
              <Text textStyle="label/xs" color={state.isChecked ? 'neutral.400' : 'neutral.500'}>
                Balance unavailable
              </Text>
            )}
          </HStack>
        )}
      </Box>
    </Box>
  )
}

export function ScriptTypeRadioGroup({
  name,
  value,
  onChange,
  balances,
  isTestnet = false,
}: {
  name: string
  value: SingleSigAccountScriptType | null
  onChange: (scriptType: SingleSigAccountScriptType) => void
  balances?: ScriptTypeBalances
  isTestnet?: boolean
}): JSX.Element {
  const { getRootProps, getRadioProps } = useRadioGroup({
    name,
    value: value === null ? '' : encodingsToLabels[value],
    onChange: (label: string) => {
      const mapped = getRecordValue(labelsToEncodings, label)
      if (mapped !== undefined) {
        onChange(mapped)
      }
    },
  })

  const prefixes = isTestnet ? testnetPrefixes : mainnetPrefixes

  return (
    <SimpleGrid {...getRootProps()} aria-label="Script type" columns={{ base: 1, sm: 2 }} spacing={2}>
      {singlesigEncodings.map((scriptType) => {
        const label = encodingsToLabels[scriptType]
        return (
          <ScriptTypeCard
            key={scriptType}
            label={label}
            prefix={prefixes[scriptType]}
            balance={balances?.[scriptType]}
            radioProps={getRadioProps({ value: label })}
          />
        )
      })}
    </SimpleGrid>
  )
}
