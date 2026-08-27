import { Input, type InputProps } from '@chakra-ui/react'
import { format, isValid } from 'date-fns'

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

/**
 * A date input component that uses the Chakra UI Input component under the hood.
 * It was created to avoid handling date strings returned by the browser everywhere we use a date input.
 *
 * The format (e.g. 'MM/DD/YYYY', 'DD/MM/YYYY') displayed to the user is
 * based on the locale defined in the user's OS.
 */
export function DateInput({ value, onChange, min, max, type = 'date', ...props }: DateInputProps): JSX.Element {
  const format = (date: Date) => formatDateForInput(date, type)

  return (
    <Input
      {...props}
      type={type}
      max={max && isValid(max) ? format(max) : undefined}
      min={min && isValid(min) ? format(min) : undefined}
      value={value && isValid(value) ? format(value) : ''}
      onChange={(e) => {
        // Calling `new Date()` with a date string like "2025-04-02" interprets it as UTC,
        // then converts to local timezone.
        // For example, in Brasilia (UTC-3), "2025-04-02" becomes "2025-04-01T21:00:00" local time.

        // To fix this, we need to ensure the date is interpreted in the local timezone. For date
        // inputs, append the time to ensure it's interpreted as midnight in local timezone
        const dateString = e.target.value

        const localDateString = type === 'date' ? `${dateString}T00:00:00` : dateString
        const dateValue = new Date(localDateString)
        onChange(dateValue && isValid(dateValue) ? dateValue : null)
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
