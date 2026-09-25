import {
  Box,
  type BoxProps,
  HStack,
  type UseRadioGroupProps,
  type UseRadioProps,
  useRadio,
  useRadioGroup,
} from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { primaryVariant } from '../theme/button-theme'

export function RadioCardGroup(
  props: {
    options: string[]
    onChange?: (value: string) => void
  } & Omit<UseRadioGroupProps, 'onChange'>,
): JSX.Element {
  const { options, ...groupProps } = props
  const { getRootProps, getRadioProps } = useRadioGroup(groupProps)

  const group = getRootProps()

  return (
    <HStack {...group} align="stretch" flexWrap="wrap">
      {options.map((value) => {
        const radio = getRadioProps({ value })
        return (
          <RadioCard flex={1} minW="fit-content" key={value} radioProps={radio}>
            {value}
          </RadioCard>
        )
      })}
    </HStack>
  )
}

export function RadioCard({
  radioProps,
  children,
  ...props
}: { radioProps?: UseRadioProps; children: ReactNode } & BoxProps): JSX.Element {
  const { getInputProps, getRadioProps } = useRadio(radioProps)

  const input = getInputProps()
  const checkbox = getRadioProps()

  return (
    <Box as="label" textAlign="center" {...props}>
      <input {...input} />
      <Box
        {...checkbox}
        cursor="pointer"
        borderWidth="1px"
        borderRadius="md"
        borderColor="neutral.200"
        fontWeight="medium"
        bg="neutral.50"
        color="neutral.700"
        minH="44px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' }}
        _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
        _checked={primaryVariant}
        _hover={{ bg: 'neutral.100' }}
        px={3}
        py={2}
        textStyle="text/sm"
      >
        {children}
      </Box>
    </Box>
  )
}
