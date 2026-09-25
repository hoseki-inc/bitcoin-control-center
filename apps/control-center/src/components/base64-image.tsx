import { Image, type ImageProps } from '@chakra-ui/react'

export function Base64Image({ src, alt, ...props }: ImageProps): JSX.Element {
  return <Image alt={alt} src={`data:image/png;base64,${src}`} {...props} />
}
