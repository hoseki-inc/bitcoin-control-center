import { Input, type InputProps } from '@chakra-ui/react'
import { format, isValid, parseISO } from 'date-fns'
import { DateStringInput } from './date-string-input'

export type DateInputProps = Omit<InputProps, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: Date | null
  onChange: (date: Date | null) => void
  min?: Date
  max?: Date
  /**
   * The type of date input to use.
   * @default 'date'
   */
  type?: 'date' | 'datetime-local'
}

/** Shared date picker with Date values; date-only values use local midnight. */
export function DateInput({ value, onChange, min, max, type = 'date', ...props }: DateInputProps): JSX.Element {
  const formatInputDate = (date: Date): string => formatDateForInput(date, type)

  if (type === 'date') {
    return (
      <DateStringInput
        {...props}
        value={value && isValid(value) ? formatInputDate(value) : ''}
        min={min && isValid(min) ? formatInputDate(min) : undefined}
        max={max && isValid(max) ? formatInputDate(max) : undefined}
        onChange={(date) => {
          onChange(date ? parseISO(date) : null)
        }}
      />
    )
  }

  return (
    <Input
      {...props}
      type={type}
      max={max && isValid(max) ? formatInputDate(max) : undefined}
      min={min && isValid(min) ? formatInputDate(min) : undefined}
      value={value && isValid(value) ? formatInputDate(value) : ''}
      onChange={(e) => {
        const dateValue = new Date(e.target.value)
        onChange(isValid(dateValue) ? dateValue : null)
      }}
    />
  )
}

/**
 * Has nothing to do with what we display to the user, the single
 * purpose is to format the date to pass to the input[value].
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/date
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/datetime-local
 */
function formatDateForInput(date: Date, type: 'date' | 'datetime-local'): string {
  return type === 'date' ? format(date, 'yyyy-MM-dd') : format(date, "yyyy-MM-dd'T'HH:mm")
}
