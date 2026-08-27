import { Skeleton, type SkeletonProps } from '@chakra-ui/react'

/**
 * A skeleton that keeps the same height as the text it's replacing, regardless of the font size.
 */
export function LoadingTextSkeleton(props: SkeletonProps): JSX.Element {
  return (
    <Skeleton
      as="span"
      display="inline-block"
      sx={{
        // inline-block increases the height of the element a bit, so we need 0.8 instead of 1
        height: '0.8em',
        '@supports(height: 0.8lh)': {
          height: '0.8lh',
        },
      }}
      {...props}
    />
  )
}
