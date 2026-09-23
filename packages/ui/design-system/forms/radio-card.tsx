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
  } & UseRadioGroupProps,
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
        borderColor="border.subtle"
        fontWeight="medium"
        bg="surface.subtle"
        color="text.secondary"
        minH="44px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' }}
        _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
        _checked={primaryVariant}
        _hover={{ bg: 'surface.muted' }}
        px={3}
        py={2}
        textStyle="text/sm"
      >
        {children}
      </Box>
    </Box>
  )
}
