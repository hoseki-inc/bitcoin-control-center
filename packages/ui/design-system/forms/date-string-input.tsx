import { Input, type InputProps } from '@chakra-ui/react'

export type DateStringInputProps = Omit<InputProps, 'type' | 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}

export function DateStringInput({ value, onChange, ...props }: DateStringInputProps): JSX.Element {
  return (
    <Input
      {...props}
      type="date"
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    />
  )
}
