import { Button, Flex, FormControl, FormLabel, Grid, Input, Stack, Textarea } from '@chakra-ui/react'
import Decimal from 'decimal.js'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { todayLocalDate } from '../../utils/local-date'
import { dollarsToCents } from './value'

export interface ValuationFields {
  valueCents: string
  valuedAt: string
  note?: string
}

export function ValuationForm({
  initial,
  onSave,
  saving,
  label = 'Save Valuation',
  onCancel,
  children,
  disabled = false,
}: {
  initial?: ValuationFields
  onSave: (fields: ValuationFields) => Promise<void>
  saving: boolean
  label?: string
  onCancel?: () => void
  children?: ReactNode
  disabled?: boolean
}): JSX.Element {
  const [value, setValue] = useState(initial ? new Decimal(initial.valueCents).div(100).toFixed(2) : '')
  const [valuedAt, setValuedAt] = useState(initial?.valuedAt ?? todayLocalDate())
  const [note, setNote] = useState(initial?.note ?? '')
  const valueRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (initial !== undefined) {
      valueRef.current?.focus()
    }
  }, [initial])
  const valueCents = dollarsToCents(value)
  const valid = valueCents !== null && /^\d{4}-\d{2}-\d{2}$/.test(valuedAt) && valuedAt <= todayLocalDate()
  return (
    <Stack
      as="form"
      spacing={4}
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && !disabled && !saving) {
          void onSave({ valueCents, valuedAt, note: note.trim() || undefined })
        }
      }}
    >
      {children}
      <Grid templateColumns={{ base: '1fr', sm: '1fr 1fr' }} gap={4}>
        <FormControl isRequired isDisabled={saving}>
          <FormLabel htmlFor="investment-value" textStyle="text/sm" color="neutral.600" fontWeight="medium">
            Total Value (USD)
          </FormLabel>
          <Input
            id="investment-value"
            ref={valueRef}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
            }}
          />
        </FormControl>
        <FormControl isRequired isDisabled={saving}>
          <FormLabel htmlFor="investment-date" textStyle="text/sm" color="neutral.600" fontWeight="medium">
            Valuation Date
          </FormLabel>
          <Input
            id="investment-date"
            type="date"
            max={todayLocalDate()}
            value={valuedAt}
            onChange={(event) => {
              setValuedAt(event.target.value)
            }}
          />
        </FormControl>
      </Grid>
      <FormControl isDisabled={saving}>
        <FormLabel htmlFor="investment-note" textStyle="text/sm" color="neutral.600" fontWeight="medium">
          Note (optional)
        </FormLabel>
        <Textarea
          id="investment-note"
          maxLength={2000}
          minH="80px"
          resize="vertical"
          placeholder="e.g. Treasury stocks and preferred shares"
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
      </FormControl>
      <Flex justify="flex-end" gap={2} direction={{ base: 'column-reverse', sm: 'row' }}>
        {onCancel && (
          <Button variant="outline" onClick={onCancel} isDisabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="submit" isLoading={saving} isDisabled={!valid || disabled}>
          {label}
        </Button>
      </Flex>
    </Stack>
  )
}
