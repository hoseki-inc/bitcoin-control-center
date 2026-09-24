import { Badge, Box, Button, HStack, Icon, Input, Stack, Text, chakra } from '@chakra-ui/react'
import { motion } from 'framer-motion'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, XIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { HOSEKI_ASSETS_CDN_URL } from '../../constants'
import { opacityReveal } from '../design-system/animations/motion'
import { formatUsd, toBitcoinAmountDisplayValue, toXpubDisplayValue } from '../utils'
import type { HardwareWallet } from './types'

const CHECKMARK_DISPLAY_DURATION = 2000

function splitXpubIntoTwoLines(displayValue: string): string {
  const spaces: number[] = []
  for (let i = 0; i < displayValue.length; i++) {
    if (displayValue[i] === ' ') {
      spaces.push(i)
    }
  }

  if (spaces.length === 0) {
    return displayValue
  }

  const middleSpaceIndex = spaces[Math.floor(spaces.length / 2)]
  if (middleSpaceIndex === undefined) {
    return displayValue
  }

  return `${displayValue.substring(0, middleSpaceIndex)}\n${displayValue.substring(middleSpaceIndex + 1)}`
}

function isValidDisplayName(name: string): boolean {
  return name.length > 0 && name.length < 255
}

export function HardwareWalletCard({
  wallet,
  isSelected,
  onUpdateDisplayName,
  onClick,
  isDefaultExpanded = false,
}: {
  wallet: HardwareWallet
  isSelected: boolean
  onUpdateDisplayName: (newDisplayName: string) => void
  onClick?: (wallet: HardwareWallet) => void
  isDefaultExpanded?: boolean
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(isDefaultExpanded)
  const [revealDetails, setRevealDetails] = useState(false)
  const [isMasked, setIsMasked] = useState(true)
  const [isDisplayNameValid, setIsDisplayNameValid] = useState(true)
  const [showCheckmark, setShowCheckmark] = useState(false)

  const handleDisplayNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDisplayName = e.target.value.trim()
    const isValid = isValidDisplayName(newDisplayName)
    setIsDisplayNameValid(isValid)

    if (isValid) {
      onUpdateDisplayName(newDisplayName)
    }
  }

  const handleDisplayNameBlur = () => {
    if (isDisplayNameValid) {
      setShowCheckmark(true)
      setTimeout(() => {
        setShowCheckmark(false)
      }, CHECKMARK_DISPLAY_DURATION)
    }
  }

  const isClickable = !isSelected && Boolean(onClick)

  return (
    <HStack
      position="relative"
      textAlign="center"
      alignItems="center"
      border="1px solid"
      borderColor="border.subtle"
      bgColor={isSelected ? 'surface.subtle' : 'surface.raised'}
      borderRadius="md"
      p={4}
      w="fit-content"
      maxW="full"
      cursor={isClickable ? 'pointer' : 'default'}
      _hover={isClickable ? { bgColor: 'surface.subtle' } : undefined}
      gap={0}
    >
      {isClickable && (
        <Box
          as="button"
          type="button"
          aria-label={`Select ${wallet.label}`}
          position="absolute"
          inset={0}
          zIndex={1}
          borderRadius="inherit"
          _focusVisible={{ boxShadow: 'outline' }}
          onClick={() => onClick?.(wallet)}
        />
      )}
      {isSelected && (
        <Box position="absolute" left={0} top={0} bottom={0} width="4px" bg="surface.inverse" borderRadius="md" />
      )}
      <Stack minW="164px" w="164px" gap={1} flexShrink={0}>
        <chakra.img src={`${HOSEKI_ASSETS_CDN_URL}/bitcoin-medium.svg`} alt="Wallet" w="32px" mx="auto" mb={1} />
        <Text textStyle="label/md" fontWeight="medium" color="text.secondary">
          {wallet.label}
        </Text>
        <Stack gap={0}>
          <Text textStyle="label/md" fontWeight="medium" color="text.primary">
            {toBitcoinAmountDisplayValue(wallet.btcBalance.toString())}
          </Text>
          {wallet.usdBalance && (
            <Text textStyle="label/md" fontWeight="medium" color="status.success.fg">
              {formatUsd(wallet.usdBalance.toFixed(2))}
            </Text>
          )}
        </Stack>
      </Stack>

      {isSelected && (
        <HStack justifyContent="flex-end" minW={0}>
          {isExpanded && (
            <Box minW={0} overflow="hidden" sx={revealDetails ? opacityReveal : undefined}>
              <HStack spacing={4} pl={8} alignItems="center" minW={0}>
                <Stack textAlign="left" gap={1} minW={0}>
                  <HStack spacing={2} overflowX="auto">
                    <Input
                      defaultValue={wallet.displayName}
                      bgColor={isDisplayNameValid ? 'surface.muted' : 'status.error.bg'}
                      borderColor={isDisplayNameValid ? 'border.subtle' : 'status.error.solid'}
                      fontSize="14px"
                      fontWeight={500}
                      color="text.primary"
                      p={2}
                      minW="100px"
                      onChange={handleDisplayNameChange}
                      onBlur={handleDisplayNameBlur}
                    />
                    <Badge
                      color="text.secondary"
                      bgColor="surface.muted"
                      py={0.5}
                      px={1.5}
                      fontWeight={500}
                      fontSize="12px"
                      borderRadius="24px"
                      flexShrink={0}
                    >
                      {wallet.account.scriptType}
                    </Badge>
                    <Box width="28px" display="flex" alignItems="center" justifyContent="center" flexShrink={0}>
                      <ValidationIcon isValid={isDisplayNameValid} showSuccess={showCheckmark} />
                    </Box>
                  </HStack>
                  <chakra.code
                    color="text.secondary"
                    fontSize="xs"
                    display="block"
                    whiteSpace="pre"
                    overflowX="auto"
                    w="full"
                    pb={1}
                  >
                    {splitXpubIntoTwoLines(toXpubDisplayValue(wallet.account.xpub.toString(), isMasked))}
                  </chakra.code>
                </Stack>
                <Button
                  aria-label={isMasked ? 'Show extended public key' : 'Hide extended public key'}
                  variant="plain"
                  onClick={() => {
                    setIsMasked((prev) => !prev)
                  }}
                  p={2}
                  flexShrink={0}
                >
                  <Icon as={isMasked ? EyeOffIcon : EyeIcon} color="text.secondary" boxSize="20px" />
                </Button>
              </HStack>
            </Box>
          )}
          <Button
            onClick={(event) => {
              setRevealDetails(event.detail > 0)
              setIsExpanded((prev) => !prev)
            }}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Hide wallet details' : 'Show wallet details'}
            variant="outline"
            size="sm"
            p={0}
            flexShrink={0}
            _hover={{ bg: 'surface.muted' }}
          >
            {isExpanded ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </Button>
        </HStack>
      )}
    </HStack>
  )
}

function AnimatedIcon({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      style={{ display: 'flex', alignItems: 'center' }}
    >
      {children}
    </motion.div>
  )
}

function ValidationIcon({ isValid, showSuccess }: { isValid: boolean; showSuccess: boolean }) {
  if (showSuccess && isValid) {
    return (
      <AnimatedIcon>
        <CheckIcon color="green" size={16} />
      </AnimatedIcon>
    )
  }

  if (!isValid) {
    return (
      <AnimatedIcon>
        <XIcon color="red" size={16} />
      </AnimatedIcon>
    )
  }

  return null
}
