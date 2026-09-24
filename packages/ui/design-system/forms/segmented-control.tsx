import { Box, Flex, VisuallyHidden } from '@chakra-ui/react'
import { LayoutGroup, motion } from 'framer-motion'
import { type ReactNode, useId } from 'react'
import { springs } from '../animations/motion'

const MotionBox = motion.create(Box)

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string
}

/**
 * A pill track of options where the selection is a pill that slides between them.
 * Built on native radio inputs, so arrow keys, forms and screen readers work as usual.
 */
export function SegmentedControl<T extends string>({
  name,
  value,
  options,
  onChange,
  ariaLabel,
  ariaDescribedBy,
  isDisabled = false,
  size = 'md',
  fullWidth = false,
}: {
  name: string
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  ariaLabel?: string
  ariaDescribedBy?: string
  isDisabled?: boolean
  size?: 'sm' | 'md'
  fullWidth?: boolean
}): JSX.Element {
  const layoutId = useId()
  return (
    <LayoutGroup id={layoutId}>
      <Flex
        role="radiogroup"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-disabled={isDisabled || undefined}
        display={fullWidth ? 'flex' : 'inline-flex'}
        w={fullWidth ? '100%' : 'auto'}
        p="4px"
        gap="2px"
        borderRadius="full"
        bg="var(--segment-track)"
        boxShadow="inset 0 1px 2px rgb(0 0 0 / 0.06)"
        opacity={isDisabled ? 0.6 : 1}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <Box
              as="label"
              key={option.value}
              position="relative"
              flex={fullWidth ? 1 : undefined}
              display="flex"
              alignItems="center"
              justifyContent="center"
              minH={size === 'sm' ? '32px' : '36px'}
              px={size === 'sm' ? 3 : 4}
              borderRadius="full"
              cursor={isDisabled ? 'default' : 'pointer'}
              textStyle={size === 'sm' ? 'text/xs' : 'text/sm'}
              fontWeight="medium"
              color={selected ? 'text.primary' : 'text.secondary'}
              whiteSpace="nowrap"
              transition="color 150ms"
              _hover={isDisabled ? undefined : { color: 'text.primary' }}
              sx={{
                '&:has(input:focus-visible)': {
                  outline: '2px solid',
                  outlineColor: 'focus.ring',
                  outlineOffset: '2px',
                },
              }}
            >
              <VisuallyHidden
                as="input"
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={isDisabled}
                aria-label={option.ariaLabel}
                onChange={() => {
                  onChange(option.value)
                }}
              />
              {selected && (
                <MotionBox
                  layoutId="segment-pill"
                  position="absolute"
                  inset={0}
                  borderRadius="full"
                  bg="var(--segment-pill)"
                  boxShadow="var(--segment-pill-shadow)"
                  transition={springs.pill}
                />
              )}
              <Box as="span" position="relative" zIndex={1}>
                {option.label}
              </Box>
            </Box>
          )
        })}
      </Flex>
    </LayoutGroup>
  )
}
