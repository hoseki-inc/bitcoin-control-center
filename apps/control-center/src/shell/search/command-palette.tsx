import { Box, Flex, Grid, Input, Text, useBreakpointValue } from '@chakra-ui/react'
import { curves, durations } from '@hoseki/packages/ui/design-system/animations/motion'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CornerDownLeft, Search } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AccountArtwork } from '../account-grid'
import { type Command, type CommandGroup, useCommands } from './commands'
import { Orb } from './orb'
import { rankCommands } from './score'

const MotionBox = motion.create(Box)
const MAX_RESULTS = 12
const ENERGY_SETTLE_MS = 450
const seconds = (ms: number): number => ms / 1000

/**
 * ⌘K search. An orb rises above a glass card; typing stirs the orb. Arrow keys move,
 * Enter runs, Escape clears the query and then closes.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return <AnimatePresence>{open && <PaletteDialog key="palette" onClose={onClose} />}</AnimatePresence>
}

function PaletteDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const reduced = useReducedMotion() === true
  const { commands, accounts } = useCommands()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [energy, setEnergy] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentHeight, setContentHeight] = useState<number | 'auto'>('auto')
  const listId = useId()

  const orbSize = useBreakpointValue({ base: 64, sm: 88 }) ?? 88
  const { groups, results } = useMemo(() => {
    const visible = query.trim() === '' ? commands.filter((command) => command.searchOnly !== true) : commands
    const grouped = groupResults(rankCommands(query, visible).slice(0, MAX_RESULTS), query)
    // Arrow keys follow the order on screen, which is grouped.
    return { groups: grouped, results: grouped.flatMap(({ items }) => items) }
  }, [commands, query])
  const active = results[Math.min(selected, results.length - 1)]

  // Remember where focus was, and give it back on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => {
      previous?.focus()
    }
  }, [])

  // Typing stirs the orb; it settles shortly after the last keystroke.
  useEffect(() => {
    if (energy === 0) {
      return
    }
    const timer = window.setTimeout(() => {
      setEnergy(0)
    }, ENERGY_SETTLE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [energy, query])

  // The card's height glides between result counts instead of jumping.
  useLayoutEffect(() => {
    const content = contentRef.current
    if (content === null) {
      return
    }
    const observer = new ResizeObserver(() => {
      setContentHeight(content.offsetHeight)
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, results])

  const run = (command: Command | undefined): void => {
    if (command === undefined) {
      return
    }
    onClose()
    command.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length === 0) {
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setSelected((index) => (Math.min(index, results.length - 1) + step + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (query !== '') {
        setQuery('')
        setSelected(0)
      } else {
        onClose()
      }
    } else if (event.key === 'Tab') {
      // The palette is a single field; keep focus inside it.
      event.preventDefault()
    }
  }

  const enter = (duration: number, extra?: Record<string, unknown>): Record<string, unknown> =>
    reduced ? { duration: 0.15, ease: 'easeOut' } : { duration: seconds(duration), ease: curves.enter, ...extra }
  const showTiles = query.trim() === '' && accounts.length > 0

  return (
    <Box
      as="dialog"
      open
      aria-modal="true"
      aria-label="Search"
      position="fixed"
      inset={0}
      zIndex={1100}
      // Undo the browser's own dialog box so the palette lays itself out.
      w="100%"
      h="100%"
      maxW="100%"
      maxH="100%"
      m={0}
      p={0}
      border="none"
      bg="transparent"
      color="inherit"
    >
      <MotionBox
        position="absolute"
        inset={0}
        bg="rgb(15 23 42 / 0.18)"
        _dark={{ bg: 'rgb(0 0 0 / 0.3)' }}
        sx={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: seconds(durations.searchOverlay) } }}
        exit={{ opacity: 0, transition: { duration: seconds(durations.searchOverlay) } }}
      />
      <Flex
        position="absolute"
        top={{ base: '16px', lg: '8%' }}
        left="50%"
        transform="translateX(-50%)"
        w="calc(100% - 32px)"
        maxW="720px"
        direction="column"
        align="center"
        pointerEvents="none"
      >
        <MotionBox
          position="relative"
          mb={{ base: 4, sm: 5 }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.55, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: enter(durations.searchOrb) }}
          exit={{ opacity: 0, y: 10, scale: 0.8, transition: { duration: 0.18, ease: curves.exit } }}
        >
          <Box
            aria-hidden
            position="absolute"
            inset="-45%"
            borderRadius="full"
            bg="radial-gradient(circle, rgb(255 229 108 / 0.32) 0%, rgb(255 144 30 / 0.1) 38%, transparent 66%)"
          />
          <Orb size={orbSize} energy={energy} />
        </MotionBox>

        <MotionBox
          layerStyle="materialModal"
          borderRadius={{ base: '34px', sm: '36px' }}
          w="100%"
          overflow="hidden"
          pointerEvents="auto"
          style={{ transformOrigin: '50% 0%' }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            height: contentHeight,
            transition: {
              ...enter(durations.searchCard),
              height: { duration: seconds(durations.heightTween), ease: curves.exit },
            },
          }}
          exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16, ease: curves.exit } }}
        >
          <Box ref={contentRef} p={3}>
            <Flex
              align="center"
              gap={3}
              h={{ base: '44px', sm: '48px' }}
              px={4}
              borderRadius="full"
              bg="surface.subtle"
              boxShadow="inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 0 0.5px var(--material-edge)"
            >
              <Search size={18} aria-hidden color="var(--hoseki-colors-text-tertiary)" />
              <Input
                ref={inputRef}
                variant="unstyled"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSelected(0)
                  setEnergy(1)
                }}
                onKeyDown={onKeyDown}
                placeholder="Search accounts, pages and actions"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
                aria-autocomplete="list"
                textStyle="text/md"
                h="100%"
                px={0}
                bg="transparent"
                border="none"
                borderRadius={0}
                _focus={{ outline: 'none', border: 'none', boxShadow: 'none' }}
                _focusVisible={{ outline: 'none' }}
                _placeholder={{ color: 'text.tertiary' }}
              />
            </Flex>

            {showTiles && (
              <MotionBox
                mt={3}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: enter(durations.searchSection) }}
              >
                <Grid templateColumns={{ base: 'repeat(3, 1fr)', sm: 'repeat(6, 1fr)' }} gap={1} px={1}>
                  {accounts.slice(0, 6).map((account) => (
                    <Flex
                      as="button"
                      type="button"
                      key={`${account.kind}-${account.id}`}
                      tabIndex={-1}
                      direction="column"
                      align="center"
                      gap={1.5}
                      py={2}
                      borderRadius="12px"
                      _hover={{ bg: 'surface.muted' }}
                      onClick={() => {
                        run(commands.find((command) => command.id === `account-${account.kind}-${account.id}`))
                      }}
                    >
                      <Box boxSize="44px" borderRadius="11px" overflow="hidden" boxShadow="0 2px 6px rgb(0 0 0 / 0.2)">
                        <AccountArtwork account={account} />
                      </Box>
                      <Text textStyle="text/xs" fontWeight="medium" noOfLines={1} maxW="100%" px={1}>
                        {account.name}
                      </Text>
                    </Flex>
                  ))}
                </Grid>
              </MotionBox>
            )}

            <Box
              ref={listRef}
              id={listId}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A combobox's rich results cannot be a native select.
              role="listbox"
              aria-label="Results"
              mt={3}
              maxH={{ base: '52dvh', lg: '420px' }}
              overflowY="auto"
              overscrollBehavior="contain"
              sx={{
                maskImage: 'linear-gradient(to bottom, transparent, black 8px, black calc(100% - 20px), transparent)',
              }}
            >
              {results.length === 0 ? (
                <Text px={3} py={6} textAlign="center" textStyle="text/sm" color="text.secondary">
                  No matches for “{query.trim()}”
                </Text>
              ) : (
                groups.map(({ group, items }) => (
                  <MotionBox
                    key={group}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Groups options inside the listbox.
                    role="group"
                    aria-label={group}
                    pt={1}
                    mb={2}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0, transition: enter(durations.searchSection) }}
                  >
                    <Text px={3} py={1} textStyle="text/xs" fontWeight="semibold" color="text.tertiary">
                      {group}
                    </Text>
                    {items.map((command) => {
                      const isActive = command === active
                      return (
                        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- Keys and focus stay in the input; it drives the options via aria-activedescendant.
                        <Flex
                          key={command.id}
                          id={`${listId}-${command.id}`}
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Options are chosen from the input via aria-activedescendant.
                          role="option"
                          aria-selected={isActive}
                          align="center"
                          gap={3}
                          p={2}
                          borderRadius="12px"
                          cursor="pointer"
                          bg={isActive ? 'surface.muted' : 'transparent'}
                          onMouseMove={() => {
                            setSelected(results.indexOf(command))
                          }}
                          onClick={() => {
                            run(command)
                          }}
                        >
                          {command.icon}
                          <Text
                            flex={1}
                            minW={0}
                            textStyle={{ base: 'text/sm', md: 'text/md' }}
                            fontWeight="medium"
                            noOfLines={1}
                          >
                            {command.label}
                            {command.detail !== undefined && (
                              <Text as="span" color="text.tertiary" fontWeight="normal">
                                {' '}
                                {command.detail}
                              </Text>
                            )}
                          </Text>
                          <Box color="text.tertiary" opacity={isActive ? 1 : 0} transition="opacity 100ms" pr={1}>
                            <CornerDownLeft size={14} aria-hidden />
                          </Box>
                        </Flex>
                      )
                    })}
                  </MotionBox>
                ))
              )}
            </Box>
          </Box>
        </MotionBox>
      </Flex>
    </Box>
  )
}

/**
 * With no query the list reads as "Suggestions"; with a query, results keep their rank
 * but are gathered under their group, in the order each group first appears.
 */
function groupResults(results: readonly Command[], query: string): Array<{ group: CommandGroup; items: Command[] }> {
  if (query.trim() === '') {
    return results.length === 0 ? [] : [{ group: 'Suggestions', items: [...results] }]
  }
  const groups = new Map<CommandGroup, Command[]>()
  for (const command of results) {
    groups.set(command.group, [...(groups.get(command.group) ?? []), command])
  }
  return [...groups].map(([group, items]) => ({ group, items }))
}
