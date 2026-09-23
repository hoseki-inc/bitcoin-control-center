import { FormLabel, type FormLabelProps, HStack, Tooltip, createIcon } from '@chakra-ui/react'

export function LabelWithTooltip({
  htmlFor = '',
  labelText,
  tooltipText,
  labelProps,
}: {
  htmlFor?: string
  labelText: string
  tooltipText: string
  labelProps?: FormLabelProps
}): JSX.Element {
  return (
    <HStack alignItems="center" mb={1} gap={1}>
      <FormLabel htmlFor={htmlFor} mb={0} {...labelProps}>
        {labelText}
      </FormLabel>
      <Tooltip hasArrow placement="right" label={tooltipText} p={1.5}>
        <InfoTooltip color="text.tertiary" boxSize="16px" />
      </Tooltip>
    </HStack>
  )
}

const InfoTooltip = createIcon({
  displayName: 'InfoTooltip',
  viewBox: '0 0 17 17',
  path: (
    <>
      <path
        d="M8.7487 15.1654C12.4306 15.1654 15.4154 12.1806 15.4154 8.4987C15.4154 4.8168 12.4306 1.83203 8.7487 1.83203C5.0668 1.83203 2.08203 4.8168 2.08203 8.4987C2.08203 12.1806 5.0668 15.1654 8.7487 15.1654Z"
        fill="currentColor"
      />
      <path d="M8.75 11.1667V8.5V11.1667Z" fill="#FFF" />
      <path d="M8.75 11.1667V8.5" stroke="#FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.75 5.83203H8.75667H8.75Z" fill="#FFF" />
      <path d="M8.75 5.83203H8.75667" stroke="#FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
})
