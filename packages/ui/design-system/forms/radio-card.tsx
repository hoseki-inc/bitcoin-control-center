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
  const { getRootProps, getRadioProps } = useRadioGroup({
    name: props.name,
    defaultValue: props.defaultValue,
    onChange: props.onChange,
  })

  const group = getRootProps()

  return (
    <HStack {...group}>
      {props.options.map((value) => {
        const radio = getRadioProps({ value })
        return (
          <RadioCard flex={1} key={value} radioProps={radio}>
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
        _checked={primaryVariant}
        _hover={{ bg: 'neutral.100' }}
        px={3}
        py={2}
        fontSize="12px"
      >
        {children}
      </Box>
    </Box>
  )
}
