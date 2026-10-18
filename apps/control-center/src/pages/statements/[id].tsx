import { Box, Button, Flex, HStack, IconButton, Link, Stack, Text } from '@chakra-ui/react'
import { renderStatementPdf } from '@hoseki/packages/pdf'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { StatementDocumentFormat, StatementId } from '@hoseki/packages/schemas'
import { Animations, ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import {
  StatusBadge,
  VIEWPORT_BELOW_HEADER,
  getBadgeConfigForStatement,
  usePdfDownloadMutation,
} from '@hoseki/packages/ui/prove-verify-ui'
import { formatDateRange } from '@hoseki/packages/ui/utils'
import { ShieldCheckIcon, XIcon } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import { DeleteStatementButton } from '../../components/statements/delete-statement-button'
import { StatementGenerationModal } from '../../components/statements/statement-generation-modal'
import { useRenderedStatement } from '../../hooks/use-rendered-statement'
import { useStatementGeneration } from '../../hooks/use-statement-generation'
import { UrlParameter, useUrlParameter } from '../../hooks/use-url-parameters'
import { JustGeneratedStateSchema } from '../../lib/statement-navigation'
import { baseTrpc, trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'

const GENERATION_POLL_MS = 1000

export function StatementDetailsPage(): JSX.Element {
  const statementId = useUrlParameter(UrlParameter.statementId)

  if (statementId === null) {
    return (
      <Box p={4}>
        <ErrorBanner mb={4} message="Invalid statement ID provided in URL" />
      </Box>
    )
  }

  // Going back or forward between statements reuses this route; start each statement fresh.
  return <StatementDetailsPageContent key={statementId} statementId={statementId} />
}

function StatementDetailsPageContent({ statementId }: { statementId: StatementId }) {
  const navigate = useNavigate()
  const location = useLocation()
  // Opened by Generate, with the statement Sentinel just returned: show generation at once, without
  // confirming its status first. Read once, and cleared so Back to this page confirms as usual.
  const [justGenerated] = useState(() => {
    const state: unknown = location.state
    return parseUnknown(JustGeneratedStateSchema, state).isOk()
  })
  useEffect(() => {
    if (justGenerated) {
      void navigate(location.pathname, { replace: true, state: null })
    }
  }, [justGenerated, navigate, location.pathname])
  const {
    data: statement,
    isLoading,
    isFetchedAfterMount,
    error,
  } = trpc.portalProve.statement.retrieve.useQuery(statementId, {
    // Check until it's done, unless it turned out to be deleted.
    refetchInterval: (data, query) =>
      data?.status === 'pending' && query.state.error?.data?.code !== 'NOT_FOUND' ? GENERATION_POLL_MS : false,
    // Retry as usual, except for a deleted statement: it won't come back, so say so straight away.
    retry: (failureCount, retryError) => failureCount < 3 && retryError.data?.code !== 'NOT_FOUND',
  })
  const [statementFormat, setStatementFormat] = useState<StatementDocumentFormat>('custom')
  const isCompleted = statement?.status === 'completed'
  // Loaded and built here, while generation may still be open, so its last step can follow the build.
  const documentQuery = trpc.portalProve.statement.retrieveDocumentData.useQuery(
    { statementId, format: statementFormat },
    { enabled: isCompleted, refetchOnWindowFocus: false },
  )
  const rendered = useRenderedStatement(documentQuery.data, isCompleted)
  const documentError = documentQuery.error?.message ?? rendered.error
  const generation = useStatementGeneration({
    // A status cached from an earlier visit may be stale; only open generation for a current one.
    isConfirmedPending: (isFetchedAfterMount || justGenerated) && error === null && statement?.status === 'pending',
    status: statement?.status ?? 'pending',
    progress: statement?.progress ?? null,
    isDocumentLoaded: documentQuery.data !== undefined,
    // A PDF that can't be built ends generation too; the page shows why.
    isDocumentReady: rendered.url !== null || documentError != null,
  })
  const headingRef = useRef<HTMLHeadingElement>(null)

  // A failed status check keeps the statement already shown, unless the statement is gone.
  if (error && (statement === undefined || error.data?.code === 'NOT_FOUND')) {
    return (
      <Box p={4}>
        <ErrorBanner mb={4} message={`Error: ${error.message}`} />
      </Box>
    )
  }

  // Wait to confirm a cached "generating" status too, rather than show the page before generation opens.
  if (isLoading || (statement.status === 'pending' && !isFetchedAfterMount && !justGenerated)) {
    return <Spinner fullPage size="xl" />
  }

  return (
    <Flex
      gap={0}
      flexDirection={{ base: 'column', lg: 'row' }}
      align="flex-start"
      // Nothing shows through while generation fades in; the statement appears as it fades out.
      // Generation renders in a portal, so it isn't hidden with the page.
      visibility={generation.isOpen ? 'hidden' : 'visible'}
    >
      {generation.isMounted && (
        <StatementGenerationModal
          isOpen={generation.isOpen}
          progress={generation.progress}
          isCompleted={generation.isCompleted}
          onClose={() => {
            // Once the statement is ready, closing reveals it; while generating, go back to the list.
            if (statement.status === 'pending') {
              void navigate('/statements')
            } else {
              generation.close()
            }
          }}
          finalFocusRef={headingRef}
        />
      )}
      <Stack
        gap={6}
        height={{ base: 'auto', lg: VIEWPORT_BELOW_HEADER }}
        flexBasis={{ base: 'auto', lg: '40%' }}
        minW={0}
        w="full"
        overflowY="auto"
        maxW={{ base: 'full', lg: 'min(40%, 480px)' }}
        py={6}
        px={{ base: 4, md: 8 }}
      >
        <CloseLink />
        <Stack gap={12}>
          <StatementSummary statement={statement} headingRef={headingRef} />
          <ActionButtons statement={statement} statementFormat={statementFormat} />
          <LearnMore />
        </Stack>
      </Stack>
      <Box
        height={{ base: 'auto', lg: VIEWPORT_BELOW_HEADER }}
        flex={{ base: 'none', lg: 1 }}
        minW={0}
        width={{ base: 'full', lg: 'auto' }}
        bg="#F9F9F9"
      >
        <StatementViewer
          isCompleted={statement.status === 'completed'}
          pdfUrl={rendered.url}
          isLoading={documentQuery.isLoading}
          error={documentError}
          onRetry={() => {
            if (documentQuery.error) {
              void documentQuery.refetch()
            } else {
              rendered.retry()
            }
          }}
          statementFormat={statementFormat}
          onStatementFormatChange={setStatementFormat}
        />
      </Box>
    </Flex>
  )
}

function StatementSummary({
  statement,
  headingRef,
}: {
  statement: StatementDto
  headingRef: RefObject<HTMLHeadingElement>
}) {
  const contactLines = [statement.user.name, statement.user.address].flatMap((value) => {
    const trimmed = value?.trim() ?? ''
    return trimmed === '' ? [] : [trimmed]
  })

  return (
    <Stack spacing={8}>
      <Stack gap={2}>
        <Text as="h1" ref={headingRef} tabIndex={-1} textStyle="text/lg" fontWeight="medium">
          Statement Details
        </Text>
        <Flex flexDirection="column" gap={4}>
          <HStack justifyContent="space-between" align="start" flexWrap="wrap" gap={4} overflowWrap="anywhere">
            <Box>
              <Text textStyle="text/sm" fontWeight="medium">
                Contact Details
              </Text>
              {contactLines.length > 0 ? (
                contactLines.map((line) => (
                  <Text key={line} whiteSpace="pre-wrap">
                    {line}
                  </Text>
                ))
              ) : (
                <Text>N/A</Text>
              )}
            </Box>
            <Box>
              <Text textStyle="text/sm" fontWeight="medium">
                Status
              </Text>
              <StatusBadge {...getBadgeConfigForStatement(statement.status)} />
            </Box>
          </HStack>
        </Flex>
      </Stack>
      {statement.status === 'failed' && statement.errorMessage !== null && (
        <ErrorBanner message={statement.errorMessage} />
      )}
      <Stack gap={2}>
        <Text as="h2" textStyle="text/lg" fontWeight="medium">
          Statement Attributes
        </Text>
        <Text textStyle="text/sm">Currency: {statement.quoteCurrency}</Text>
        <Text textStyle="text/sm">
          Period: {formatDateRange(statement.openingDate, statement.closingDate, undefined, { shortMonths: true })}
        </Text>
      </Stack>
    </Stack>
  )
}

async function triggerPdfDownload(args: { statement: StatementDto; format: StatementDocumentFormat }): Promise<void> {
  // Fetch the PdfStatement data via tRPC (same data the viewer uses)
  const statementData = await baseTrpc.portalProve.statement.retrieveDocumentData.query({
    statementId: args.statement.id,
    format: args.format,
  })

  // Build the PDF client-side (same pipeline as the viewer) and download it
  const blob = await renderStatementPdf({
    watermarkText: '',
    statement: statementData,
  })
  const url = window.URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = `statement-${args.statement.id}.pdf`
  window.document.body.appendChild(link)
  link.click()
  window.document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

function ActionButtons({
  statement,
  statementFormat,
}: {
  statement: StatementDto
  statementFormat: StatementDocumentFormat
}) {
  const navigate = useNavigate()
  const { mutate: downloadPdf, isLoading: isDownloadingPdf } = usePdfDownloadMutation({
    mutationFn: triggerPdfDownload,
  })

  return (
    <Box>
      <Text as="h2" textStyle="text/lg" fontWeight="medium" mb={2}>
        Actions
      </Text>
      <HStack>
        <Button
          variant="outline"
          size="md"
          onClick={() => {
            downloadPdf({ statement, format: statementFormat })
          }}
          isLoading={isDownloadingPdf}
          isDisabled={statement.status !== 'completed'}
        >
          Download
        </Button>
        <DeleteStatementButton
          statement={statement}
          onDeleted={() => {
            void navigate('/statements')
          }}
        />
      </HStack>
    </Box>
  )
}

function CloseLink() {
  return (
    <IconButton
      as={RouterLink}
      to="/statements"
      aria-label="Back to statements"
      icon={<XIcon size={24} aria-hidden="true" />}
      variant="ghost"
      alignSelf="flex-start"
      ml={-2}
    />
  )
}

function LearnMore() {
  return (
    <Box bg="neutral.50" p={4} borderRadius="md">
      <HStack spacing={3}>
        <ShieldCheckIcon size={20} />
        <Text fontWeight="medium">Your Proof is Private & Secure</Text>
      </HStack>
      <Text ml={7} color="neutral.900">
        This proof securely verifies your bitcoin holdings. Learn more in our{' '}
        <Link href="https://help.hoseki.app" isExternal textDecoration="underline" fontWeight="medium">
          Help Center
        </Link>
        .
      </Text>
    </Box>
  )
}

function StatementViewer({
  isCompleted,
  pdfUrl,
  isLoading,
  error,
  onRetry,
  statementFormat,
  onStatementFormatChange,
}: {
  isCompleted: boolean
  pdfUrl: string | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
  statementFormat: StatementDocumentFormat
  onStatementFormatChange: (format: StatementDocumentFormat) => void
}) {
  return (
    <Box height={{ base: '600px', lg: '100%' }} width="100%" display="flex" justifyContent="center" alignItems="center">
      <Flex
        justifyContent="center"
        alignItems="center"
        height="90%"
        width="90%"
        borderColor="neutral.200"
        borderWidth="1px"
      >
        {!isCompleted ? null : error != null ? (
          <ErrorBanner
            message={error}
            rightContent={
              <Button size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            }
          />
        ) : isLoading || pdfUrl === null ? (
          <Spinner centered />
        ) : (
          <Stack width="100%" height="100%">
            <HStack
              as="fieldset"
              aria-label="Statement format"
              justifyContent="center"
              alignItems="center"
              gap={4}
              py={4}
              flexWrap="wrap"
            >
              <Button
                variant={statementFormat === 'custom' ? 'primary' : 'outline'}
                aria-pressed={statementFormat === 'custom'}
                size="sm"
                onClick={() => {
                  if (statementFormat === 'custom') {
                    return
                  }
                  onStatementFormatChange('custom')
                }}
              >
                Full Period
              </Button>
              <Button
                variant={statementFormat === 'monthly' ? 'primary' : 'outline'}
                aria-pressed={statementFormat === 'monthly'}
                size="sm"
                onClick={() => {
                  if (statementFormat === 'monthly') {
                    return
                  }
                  onStatementFormatChange('monthly')
                }}
              >
                Monthly
              </Button>
            </HStack>
            <Box sx={Animations.fadeIn(0.25)} width="100%" flex={1} minH={0}>
              <iframe
                title="Statement PDF"
                src={`${pdfUrl}#toolbar=0`}
                width="100%"
                height="100%"
                style={{ border: 'none' }}
              />
            </Box>
          </Stack>
        )}
      </Flex>
    </Box>
  )
}
