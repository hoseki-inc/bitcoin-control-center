import { Box, Flex, HStack, SimpleGrid, Stack, Text, useColorMode } from '@chakra-ui/react'
import { Glass, useGlassPreset } from '@hoseki/packages/ui/design-system/glass'
import { ChartLine, Eye, FileText, House, Settings, Wallet } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { AppearanceToggle } from '../components/appearance-toggle'
import { WALLPAPER_FAMILIES, WALLPAPER_PRESETS, type WallpaperMode } from '../shell/wallpaper/presets'
import { useWallpaperThumbnails } from '../shell/wallpaper/thumbnails'
import { useBlockSeed, useWallpaper } from '../shell/wallpaper/use-wallpaper'
import { Wallpaper } from '../shell/wallpaper/wallpaper'

/**
 * Development page for the glass shell: every wallpaper preset under every glass
 * surface, in both themes, for side-by-side comparison while tuning materials.
 */
export function GlassLabPage(): JSX.Element {
  const { colorMode } = useColorMode()
  const mode: WallpaperMode = colorMode === 'dark' ? 'dark' : 'light'
  const { preset, setWallpaper } = useWallpaper()
  const seed = useBlockSeed(true)
  const thumbnails = useWallpaperThumbnails(mode, seed)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const dockGlass = useGlassPreset('dock')

  return (
    <Box position="relative" minH="100dvh" overflow="hidden" color="text.primary">
      <Wallpaper preset={preset} mode={mode} seed={seed} onSnapshot={setSnapshot} />

      <Box position="relative" zIndex={1} px={{ base: 4, md: 8 }} pt={{ base: 6, md: 8 }} pb="140px">
        <Flex justify="space-between" align="flex-start" gap={4} wrap="wrap">
          <Box layerStyle="materialMenu" p={4} maxW="560px">
            <HStack justify="space-between" mb={3}>
              <Box>
                <Text textStyle="text/md" fontWeight="semibold">
                  Glass lab
                </Text>
                <Text textStyle="text/xs" color="text.secondary">
                  {preset.name} · {WALLPAPER_FAMILIES.find((f) => f.family === preset.family)?.label} · {mode}
                </Text>
              </Box>
              <AppearanceToggle />
            </HStack>
            <SimpleGrid columns={4} spacing={2}>
              {WALLPAPER_PRESETS.map((option) => (
                <Box
                  as="button"
                  key={option.id}
                  type="button"
                  onClick={() => setWallpaper(option.id)}
                  aria-pressed={option.id === preset.id}
                  aria-label={option.name}
                  borderRadius="12px"
                  overflow="hidden"
                  outline="2px solid"
                  outlineColor={option.id === preset.id ? 'accent.solid' : 'transparent'}
                  outlineOffset="2px"
                  transition="transform 200ms, outline-color 200ms"
                  _hover={{ transform: 'scale(1.04)' }}
                  _active={{ transform: 'scale(0.97)' }}
                >
                  <Box
                    h="52px"
                    w="100%"
                    bg={
                      thumbnails[option.id] !== undefined
                        ? `center / cover url(${thumbnails[option.id]})`
                        : 'surface.muted'
                    }
                  />
                  <Text textStyle="text/xs" py={1} bg="var(--material-tint)">
                    {option.name}
                  </Text>
                </Box>
              ))}
            </SimpleGrid>
          </Box>

          <Stack spacing={3} w="300px">
            <Box layerStyle="materialToast" px={4} py={3}>
              <HStack spacing={3}>
                <Box
                  boxSize="7px"
                  borderRadius="full"
                  bg="status.success.solid"
                  boxShadow="0 0 0 3px rgb(16 185 129 / 0.2)"
                />
                <Box>
                  <Text textStyle="text/sm" fontWeight="medium">
                    Balances updated
                  </Text>
                  <Text textStyle="text/xs" color="text.secondary">
                    5 accounts synced a moment ago
                  </Text>
                </Box>
              </HStack>
            </Box>
            <Box layerStyle="materialMenu" p={1}>
              {['Add account', 'Change wallpaper', 'Appearance', 'Hide balances'].map((item, index) => (
                <Box
                  key={item}
                  px={3}
                  py={2}
                  borderRadius="var(--radius-menu-item)"
                  textStyle="text/sm"
                  fontWeight="medium"
                  bg={index === 1 ? 'surface.muted' : 'transparent'}
                >
                  {item}
                </Box>
              ))}
            </Box>
          </Stack>
        </Flex>

        <Stack align="center" spacing={8} mt={{ base: 10, md: 14 }}>
          <Text textStyle="text/5xl" fontWeight="semibold" letterSpacing="-0.02em" textAlign="center">
            Good evening, Erik.
          </Text>
          <Flex gap={6} wrap="wrap" justify="center">
            <Widget label="Holdings">
              <Text
                textStyle="text/2xl"
                fontWeight="semibold"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
                opacity={0.9}
              >
                ₿ 9.850235
              </Text>
              <Text textStyle="text/sm" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                $831,684 · 5 accounts
              </Text>
            </Widget>
            <Widget label="Verified">
              <Text textStyle="text/2xl" fontWeight="semibold" opacity={0.9}>
                2 of 5
              </Text>
              <Box mt={3} h="6px" borderRadius="full" layerStyle="glassTrack" overflow="hidden">
                <Box h="100%" w="40%" borderRadius="full" bg="text.primary" />
              </Box>
            </Widget>
          </Flex>
          <Box layerStyle="material" borderRadius="full" px={4} py={2} textStyle="text/sm" fontWeight="medium">
            Search{' '}
            <Text as="span" color="text.tertiary">
              ⌘K
            </Text>
          </Box>
        </Stack>

        <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6} mt={12} maxW="980px" mx="auto">
          <Box layerStyle="materialModal" p={6}>
            <Text textStyle="text/lg" fontWeight="semibold">
              Remove this account?
            </Text>
            <Text mt={2} textStyle="text/sm" color="text.secondary">
              Its history stays in your statements. You can add it again at any time.
            </Text>
          </Box>
          <WindowSpecimen snapshot={snapshot} />
        </SimpleGrid>
      </Box>

      <Flex position="fixed" bottom="10px" left={0} right={0} justify="center" zIndex={2}>
        <Glass {...dockGlass} borderRadius="16px" boxShadow="var(--glass-drop)" px={3} py={3}>
          <HStack spacing="10px">
            <DockTile from="#FFE56C" to="#F2B200" icon={<House size={24} color="#1A1300" />} />
            <DockTile from="#5B7BD8" to="#2D3F8C" icon={<Wallet size={24} color="white" />} />
            <DockTile from="#34D399" to="#047857" icon={<ChartLine size={24} color="white" />} />
            <DockTile from="#FDBA74" to="#EA580C" icon={<FileText size={24} color="white" />} />
            <DockTile from="#94A3B8" to="#334155" icon={<Settings size={24} color="white" />} />
            <DockTile from="#C4B5FD" to="#6D28D9" icon={<Eye size={24} color="white" />} />
          </HStack>
        </Glass>
      </Flex>
    </Box>
  )
}

function Widget({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const widgetGlass = useGlassPreset('widget')
  return (
    <Stack align="center" spacing={2}>
      <Glass
        {...widgetGlass}
        w="270px"
        h="150px"
        borderRadius="20px"
        boxShadow="var(--glass-widget-shadow)"
        p={5}
        transition="transform 300ms cubic-bezier(0.23, 1, 0.32, 1)"
        _hover={{ transform: 'scale(1.05)' }}
      >
        <Text textStyle="text/sm" fontWeight="semibold" color="text.secondary" mb={2}>
          {label}
        </Text>
        {children}
      </Glass>
      <Text textStyle="text/sm" fontWeight="medium" textShadow="0 2px 4px rgb(0 0 0 / 0.35)">
        {label}
      </Text>
    </Stack>
  )
}

function DockTile({ from, to, icon }: { from: string; to: string; icon: ReactNode }): JSX.Element {
  return (
    <Flex
      boxSize="50px"
      align="center"
      justify="center"
      borderRadius="12px"
      bg={`linear-gradient(160deg, ${from}, ${to})`}
      boxShadow="inset 0 1px 0 rgb(255 255 255 / 0.4), inset 0 -1px 0 rgb(0 0 0 / 0.15), 0 2px 6px rgb(0 0 0 / 0.25)"
      transition="transform 300ms cubic-bezier(0.23, 1, 0.32, 1)"
      _hover={{ transform: 'translateY(-4px) scale(1.12)' }}
      _active={{ transform: 'scale(0.95)' }}
    >
      {icon}
    </Flex>
  )
}

/** The window material: a cached, pre-blurred wallpaper under a tint, never a live backdrop blur. */
function WindowSpecimen({ snapshot }: { snapshot: string | null }): JSX.Element {
  return (
    <Box
      position="relative"
      h="220px"
      borderTopRadius="var(--radius-window)"
      overflow="hidden"
      boxShadow="var(--window-shadow)"
    >
      {snapshot !== null && (
        <Box
          as="img"
          src={snapshot}
          alt=""
          position="absolute"
          inset={0}
          w="100%"
          h="100%"
          objectFit="cover"
          transform="scale(1.2)"
          filter="var(--window-wallpaper-filter)"
        />
      )}
      <Box position="absolute" inset={0} layerStyle="window" borderRadius={0} />
      <Box position="absolute" inset={0} layerStyle="windowChrome" />
      <Box position="relative" p={6}>
        <Text textStyle="text/2xl" fontWeight="semibold" color="text.primary">
          Portfolio
        </Text>
        <Text mt={1} textStyle="text/sm" color="text.secondary">
          Windows paint a blurred snapshot of the wallpaper instead of blurring live content.
        </Text>
      </Box>
    </Box>
  )
}
