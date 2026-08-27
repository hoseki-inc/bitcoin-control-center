import { Box, type BoxProps, HStack, VStack } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, useState } from 'react'

const MotionBox = motion(Box)

export function AnimatedPopInBoxes({ children, ...rest }: { children: ReactNode[] } & BoxProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const selected = selectedIndex !== null ? children[selectedIndex] : null
  const others =
    selectedIndex !== null
      ? children.map((c, i) => ({ child: c, index: i })).filter(({ index }) => index !== selectedIndex)
      : children.map((c, i) => ({ child: c, index: i }))

  return (
    <VStack spacing={6} align="center" {...rest}>
      <AnimatePresence mode="wait">
        {selectedIndex !== null && (
          <MotionBox
            key={`selected-${selectedIndex}`}
            as={motion.div}
            layoutId={`item-${selectedIndex}`}
            initial={{ y: 100, scale: 0.75, opacity: 0, rotate: -2 }}
            animate={{ y: 0, scale: 1, opacity: 1, rotate: 0 }}
            exit={{ y: -100, scale: 0.75, opacity: 0, rotate: 2 }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 20,
              opacity: { duration: 0.2, ease: 'easeInOut' },
            }}
          >
            {selected}
          </MotionBox>
        )}
      </AnimatePresence>

      <MotionBox
        as={motion.div}
        variants={{
          hidden: {},
          visible: {
            transition: {
              staggerChildren: 0.5,
              delayChildren: 0.1,
            },
          },
        }}
        initial="hidden"
        animate="visible"
      >
        <HStack wrap="wrap" justify="center" spacing={selectedIndex !== null ? 0 : 4}>
          {others.map(({ child, index }) => (
            <MotionBox
              key={index}
              layoutId={`item-${index}`}
              cursor="pointer"
              onClick={() => setSelectedIndex(index)}
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0, scale: 0.8, y: 20 },
                visible: {
                  opacity: 1,
                  scale: selectedIndex !== null ? 0.65 : 1,
                  y: 0,
                  transition: {
                    type: 'spring',
                    stiffness: 400,
                    damping: 15,
                    opacity: { duration: 0.15, ease: 'easeOut' },
                  },
                },
              }}
              whileHover={{
                scale: selectedIndex !== null ? 0.7 : 1.05,
                transition: { duration: 0.2, ease: 'easeOut' },
              }}
            >
              {child}
            </MotionBox>
          ))}
        </HStack>
      </MotionBox>
    </VStack>
  )
}

export function AnimatedPopInSingleBox({ children, ...rest }: { children: ReactNode } & BoxProps): JSX.Element {
  return (
    <AnimatePresence>
      <Box
        as={motion.div}
        initial={{ y: 200, scale: 0.8, opacity: 0 }}
        animate={{
          y: 0,
          scale: 1,
          opacity: 1,
          transition: {
            type: 'spring',
            damping: 12,
            stiffness: 200,
            mass: 0.8,
            opacity: {
              duration: 0.3,
              ease: 'easeInOut',
              delay: 0.1,
            },
          },
        }}
        exit={{
          y: 100,
          scale: 0.9,
          opacity: 0,
          transition: {
            type: 'tween',
            duration: 0.25,
            ease: 'easeInOut',
          },
        }}
        {...rest}
      >
        {children}
      </Box>
    </AnimatePresence>
  )
}
