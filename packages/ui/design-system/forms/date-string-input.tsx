import {
  Box,
  Button,
  Flex,
  IconButton,
  Input,
  InputGroup,
  type InputProps,
  InputRightElement,
  Popover,
  PopoverAnchor,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  useDisclosure,
  useFormControlContext,
} from '@chakra-ui/react'
import { DayPicker } from '@daypicker/react'
import '@daypicker/react/style.css'
import { format, isValid, parseISO, startOfDay } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type DateStringInputProps = Omit<InputProps, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
}

/** Date-only values stay in local calendar time and never pass through UTC. */
function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = parseISO(value)
  return isValid(date) && format(date, 'yyyy-MM-dd') === value ? date : undefined
}

export function DateStringInput({ value, onChange, min, max, ...props }: DateStringInputProps): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const calendarRef = useRef<HTMLDivElement>(null)
  const form = useFormControlContext()
  const isDisabled = props.isDisabled ?? form?.isDisabled
  const isReadOnly = props.isReadOnly ?? form?.isReadOnly
  const isRequired = props.isRequired ?? form?.isRequired
  const selected = parseDate(value)
  const requestedMin = min ? parseDate(min) : undefined
  const earliestDay = new Date(2009, 0, 1)
  const firstDay = requestedMin && requestedMin > earliestDay ? requestedMin : earliestDay
  const lastDay = max ? parseDate(max) : undefined
  const today = startOfDay(new Date())
  const [draft, setDraft] = useState(value)
  const [month, setMonth] = useState(selected ?? today)
  useEffect(() => setDraft(value), [value])

  const allowed = (date: Date): boolean => (!firstDay || date >= firstDay) && (!lastDay || date <= lastDay)
  const select = (date: Date | undefined): void => {
    const next = date ? format(date, 'yyyy-MM-dd') : ''
    setDraft(next)
    onChange(next)
    onClose()
  }
  const commitDraft = (): void => {
    const date = parseDate(draft)
    if ((!draft && !isRequired) || (date && allowed(date))) {
      onChange(draft)
    } else {
      setDraft(value)
    }
  }

  return (
    <Popover
      isOpen={isOpen}
      onOpen={() => {
        setMonth(selected ?? (allowed(today) ? today : (firstDay ?? lastDay ?? today)))
        onOpen()
      }}
      onClose={onClose}
      placement="bottom-start"
      autoFocus={false}
      isLazy
      lazyBehavior="unmount"
    >
      <PopoverAnchor>
        <InputGroup size={props.size} minW={0}>
          <Input
            {...props}
            type="text"
            value={draft}
            placeholder={props.placeholder ?? 'YYYY-MM-DD'}
            autoComplete="off"
            pr={12}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => {
              commitDraft()
              props.onBlur?.(event)
            }}
            onKeyDown={(event) => {
              props.onKeyDown?.(event)
              if (event.defaultPrevented) return
              if (event.key === 'Enter') {
                event.preventDefault()
                commitDraft()
              }
            }}
          />
          <InputRightElement h="full" w="2.75rem" insetEnd={1}>
            <PopoverTrigger>
              <IconButton
                aria-label="Choose date"
                icon={<CalendarDays size={18} aria-hidden="true" />}
                variant="ghost"
                size="sm"
                h="calc(100% - 8px)"
                w="full"
                minW={0}
                p={0}
                color="text.secondary"
                isDisabled={isDisabled || isReadOnly}
              />
            </PopoverTrigger>
          </InputRightElement>
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent
        ref={calendarRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation()
        }}
        onAnimationComplete={() => {
          if (isOpen) calendarRef.current?.querySelector<HTMLButtonElement>('.rdp-day_button[tabindex="0"]')?.focus()
        }}
        aria-label="Choose date"
        w="max-content"
        maxW="calc(100vw - 24px)"
        border={0}
        borderRadius="panel"
        boxShadow="floating"
        bg="surface.raised"
        overflow="hidden"
      >
        <PopoverBody p={3}>
          <Box
            textStyle="text/sm"
            color="text.primary"
            sx={{
              '.rdp-root': {
                '--rdp-accent-color': 'var(--hoseki-colors-neutral-900)',
                '--rdp-today-color': 'var(--hoseki-colors-neutral-900)',
                '--rdp-day-width': { base: '36px', sm: '40px' },
                '--rdp-day-height': '40px',
                '--rdp-day_button-width': { base: '36px', sm: '40px' },
                '--rdp-day_button-height': '40px',
                '--rdp-day_button-border-radius': 'var(--hoseki-radii-control)',
                '--rdp-selected-border': 'none',
                '--rdp-outside-opacity': '1',
                '--rdp-weekday-opacity': '1',
                fontFamily: 'body',
              },
              '.rdp-month_caption': { textStyle: 'text/sm', fontWeight: 'medium', px: 2 },
              '.rdp-caption_label': { fontWeight: 'medium' },
              '.rdp-dropdown_root': { borderRadius: 'control', px: 1, py: 1 },
              '.rdp-dropdown_root:hover': { bg: 'surface.muted' },
              '.rdp-dropdown_root:focus-within': {
                outline: '2px solid',
                outlineColor: 'focus.ring',
                outlineOffset: '2px',
              },
              '.rdp-weekday': { textStyle: 'text/xs', color: 'text.tertiary', fontWeight: 'normal', py: 3 },
              '.rdp-day_button': { textStyle: 'text/sm', fontVariantNumeric: 'tabular-nums' },
              '.rdp-day_button:hover:not(:disabled)': { bg: 'surface.muted' },
              '.rdp-outside': { color: 'text.tertiary' },
              '.rdp-today:not(.rdp-selected) .rdp-day_button': { fontWeight: 'semibold', bg: 'surface.muted' },
              '.rdp-selected .rdp-day_button, .rdp-selected .rdp-day_button:hover': {
                bg: 'surface.inverse',
                color: 'text.inverse',
                fontWeight: 'medium',
              },
              '.rdp-button_previous, .rdp-button_next': { borderRadius: 'control' },
              '.rdp-button_previous:hover:not(:disabled), .rdp-button_next:hover:not(:disabled)': {
                bg: 'surface.muted',
              },
              '.rdp-chevron': { width: '18px', height: '18px' },
            }}
          >
            <DayPicker
              mode="single"
              required={isRequired}
              selected={selected}
              onSelect={select}
              month={month}
              onMonthChange={setMonth}
              startMonth={firstDay}
              endMonth={lastDay ?? new Date(Math.max(today.getFullYear() + 10, selected?.getFullYear() ?? 0), 11)}
              captionLayout="dropdown-years"
              navLayout="after"
              disabled={[...(firstDay ? [{ before: firstDay }] : []), ...(lastDay ? [{ after: lastDay }] : [])]}
              weekStartsOn={1}
              showOutsideDays
              fixedWeeks
              autoFocus
            />
          </Box>
          <Flex borderTop="1px solid" borderColor="border.subtle" mt={2} pt={2} justify="space-between" gap={3}>
            <Button size="sm" variant="ghost" onClick={() => select(today)} isDisabled={!allowed(today)}>
              Today
            </Button>
            {!isRequired && (
              <Button
                size="sm"
                variant="ghost"
                color="text.secondary"
                onClick={() => select(undefined)}
                isDisabled={!value}
              >
                Clear
              </Button>
            )}
          </Flex>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}
