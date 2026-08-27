import { FormErrorMessage as ChakraFormErrorMessage, type FormErrorMessageProps } from '@chakra-ui/react'

export function FormErrorMessage(props: FormErrorMessageProps): JSX.Element {
  return <ChakraFormErrorMessage mt={0.5} {...props} />
}
