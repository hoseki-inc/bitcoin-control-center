import { Box, Button, HStack, Image, Stack, Text } from '@chakra-ui/react'
import { LinearGradient } from '@hoseki/packages/ui/design-system'
import { formatDateRange } from '@hoseki/packages/ui/utils'
import { format } from 'date-fns'
import type { StatementDto } from '../../trpc/server-types'

export function StatementCard({ statement, onView }: { statement: StatementDto; onView: () => void }): JSX.Element {
  return (
    <Box
      as="button"
      type="button"
      display="block"
      width="full"
      textAlign="left"
      _focusVisible={{ boxShadow: 'outline' }}
      data-group=""
      onClick={onView}
      aria-label={`View statement created ${format(new Date(statement.createdAt), 'dd MMM yyyy h:mm a')}`}
      borderRadius="panel"
      borderWidth="1px"
      borderColor="border.subtle"
      bg="surface.subtle"
      p={0}
      overflow="hidden"
      position="relative"
      minWidth={0}
    >
      {/* Integrator Ribbon */}
      {statement.integrator && (
        <Box
          as="span"
          position="absolute"
          top={0}
          left={0}
          bg="secondary.400"
          color="black"
          height="40px"
          width="100%"
          display="flex"
          alignItems="center"
          justifyContent="center"
          textStyle="text/sm"
          textAlign="center"
          whiteSpace="nowrap"
          px={6}
          py={1.5}
          style={{ transform: 'translate(-80px, 25px) rotate(-35deg)' }}
          boxShadow="0px 0px 2px 0px #E9CA3A inset, 2px 2px 5px 0px #E9CA3A inset"
          zIndex={1}
        >
          {statement.integrator.name}
        </Box>
      )}
      <Box
        as="span"
        position="relative"
        p={6}
        pb={0}
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          as="span"
          display="block"
          maxH="150px"
          w="150px"
          overflow="hidden"
          boxShadow="6px 0 12px 0 rgba(0, 0, 0, 0.07), -6px 0 12px 0 rgba(0, 0, 0, 0.07), 0 -6px 12px 0 rgba(0, 0, 0, 0.07)"
        >
          <Image src="/statements/satoshi-statement.jpg" alt="Statement Preview" w="150px" />
        </Box>
        <LinearGradient
          as="span"
          gradientDirection="from-bottom"
          baseColor="rgba(0, 0, 0, 0.20)"
          gradientSize={60}
          opacity={1}
          transition="opacity 0.4s"
          justify="center"
          alignItems="flex-end"
          pointerEvents="auto"
          pb={4}
        >
          <Button as="span" size="sm" variant="outline">
            View
          </Button>
        </LinearGradient>
      </Box>
      <HStack as="span" bg="surface.raised" borderTopWidth="1px" borderColor="border.subtle">
        <Stack as="span" py={2} px={4} spacing={0} flexGrow="1">
          <Text as="span" display="block" textStyle="text/sm" fontWeight="medium" color="text.primary">
            Statement
          </Text>
          <Text as="span" display="block" textStyle="text/xs" color="text.secondary">
            Period: {formatDateRange(statement.openingDate, statement.closingDate)}
          </Text>
          <Text as="span" display="block" textStyle="text/xs" color="text.secondary">
            Created: {format(new Date(statement.createdAt), 'dd MMM yyyy h:mm a')}
          </Text>
        </Stack>
      </HStack>
    </Box>
  )
}
