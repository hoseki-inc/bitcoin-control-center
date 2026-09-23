import { Tag } from '@chakra-ui/react'

export function AddressStatusPill({ verified }: { verified: boolean }): JSX.Element {
  return (
    <Tag
      bgColor={verified ? 'status.success.solid' : 'status.warning.solid'}
      color="white"
      borderRadius={16}
      px={2}
      py={1}
      fontSize="sm"
    >
      {verified ? 'Verified' : 'Unverified'}
    </Tag>
  )
}
