import { Image, type ImageProps } from '@chakra-ui/react'

export function Base64Image({ src, ...props }: ImageProps): JSX.Element {
  return <Image src={`data:image/png;base64,${src}`} {...props} />
}
