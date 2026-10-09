import { Box, Button, Flex, HStack, Link, Stack, Text } from '@chakra-ui/react'
import { renderStatementDocument } from '@hoseki/packages/pdf'
import type { StatementDocumentFormat, StatementId } from '@hoseki/packages/schemas'
import { Animations, ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import {
  StatusBadge,
  VIEWPORT_BELOW_HEADER,
  getBadgeConfigForStatement,
  usePdfDownloadMutation,
} from '@hoseki/packages/ui/prove-verify-ui'
import { PDFViewer, pdf } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { ShieldCheckIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router'
import { DeleteStatementButton } from '../../components/statements/delete-statement-button'
import { StatementGenerationModal } from '../../components/statements/statement-generation-modal'
import { useRenderedStatement } from '../../hooks/use-rendered-statement'
import { UrlParameter, useUrlParameter } from '../../hooks/use-url-parameters'
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

  return <StatementDetailsPageContent statementId={statementId} />
}

function StatementDetailsPageContent({ statementId }: { statementId: StatementId }) {
  const navigate = useNavigate()
  const {
    data: statement,
    isLoading,
    isFetchedAfterMount,
    error,
  } = trpc.portalProve.statement.retrieve.useQuery(statementId, {
    refetchInterval: (data) => (data?.status === 'pending' ? GENERATION_POLL_MS : false),
  })
  const [statementFormat, setStatementFormat] = useState<StatementDocumentFormat>('custom')
  // Generation stays open after the statement is done until its closing animation ends,
  // then stays mounted so the screen can fade out.
  const [generation, setGeneration] = useState<'hidden' | 'showing' | 'finished'>('hidden')
  // A status cached from an earlier visit may be stale; only open generation for a current one.
  const isGenerating = isFetchedAfterMount && statement?.status === 'pending'
  useEffect(() => {
    if (isGenerating) {
      setGeneration((current) => (current === 'hidden' ? 'showing' : current))
    }
  }, [isGenerating])

  if (error) {
    return (
      <Box p={4}>
        <ErrorBanner mb={4} message={`Error: ${error.message}`} />
      </Box>
    )
  }

  if (isLoading) {
    return <Spinner fullPage size="xl" />
  }

  return (
    <Flex gap={0} flexDirection={{ base: 'column', lg: 'row' }} align="flex-start">
      {generation !== 'hidden' && (
        <StatementGenerationModal
          isOpen={generation === 'showing'}
          status={statement.status}
          onFinished={() => {
            setGeneration('finished')
          }}
          onClose={() => {
            void navigate('/statements')
          }}
        />
      )}
      <Stack
        gap={6}
        height={{ base: 'auto', lg: VIEWPORT_BELOW_HEADER }}
        flexBasis={{ base: 'auto', lg: '40%' }}
        minW={0}
        w="full"
        overflowY="auto"
        maxW={{ base: 'full', lg: '40%' }}
        py={6}
        px={{ base: 4, md: 8 }}
      >
        <BackLink />
        <Stack gap={12}>
          <StatementSummary statement={statement} />
          <ActionButtons statement={statement} statementFormat={statementFormat} />
          <LearnMore />
        </Stack>
      </Stack>
      <Box
        height={{ base: 'auto', lg: VIEWPORT_BELOW_HEADER }}
        flexBasis={{ base: 'auto', lg: '60%' }}
        minW={0}
        width={{ base: 'full', lg: '60%' }}
        bg="#F9F9F9"
      >
        <StatementPreview
          statement={statement}
          statementFormat={statementFormat}
          onStatementFormatChange={setStatementFormat}
        />
      </Box>
    </Flex>
  )
}

function StatementSummary({ statement }: { statement: StatementDto }) {
  return (
    <Stack spacing={8}>
      <Stack gap={2}>
        <Text as="h1" textStyle="text/lg" fontWeight="medium">
          Statement Details
        </Text>
        <Flex flexDirection="column" gap={4}>
          <HStack justifyContent="space-between" align="start" flexWrap="wrap" gap={4} overflowWrap="anywhere">
            {statement.user.name !== null && statement.user.name !== '' && (
              <Box>
                <Text textStyle="text/sm" fontWeight="medium">
                  Name
                </Text>
                <Text>{statement.user.name}</Text>
              </Box>
            )}
            <Box>
              <Text textStyle="text/sm" fontWeight="medium">
                Email
              </Text>
              <Text>{(statement.user.email?.length ?? 0) > 0 ? statement.user.email : 'N/A'}</Text>
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
          Period: {format(statement.openingDate, 'd MMMM yyyy')} - {format(statement.closingDate, 'd MMMM yyyy')}
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

  // Render the PDF document client-side (same pipeline as the viewer)
  const document = await renderStatementDocument({
    watermarkText: '',
    statement: statementData,
  })

  // Generate PDF blob and download
  const blob = await pdf(document).toBlob()
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
        {statement.status !== 'pending' && (
          <DeleteStatementButton
            statementId={statement.id}
            onDeleted={() => {
              void navigate('/statements')
            }}
          />
        )}
      </HStack>
    </Box>
  )
}

function BackLink() {
  return (
    <Link
      as={RouterLink}
      to="/home"
      display="inline-flex"
      alignItems="center"
      color="neutral.900"
      fontWeight="medium"
      _hover={{ textDecoration: 'none', color: 'neutral.500' }}
    >
      Back to Home
    </Link>
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

function StatementPreview({
  statement,
  statementFormat,
  onStatementFormatChange,
}: {
  statement: StatementDto
  statementFormat: StatementDocumentFormat
  onStatementFormatChange: (format: StatementDocumentFormat) => void
}) {
  const {
    data: statementData,
    isLoading,
    error: queryError,
    refetch,
  } = trpc.portalProve.statement.retrieveDocumentData.useQuery(
    {
      statementId: statement.id,
      format: statementFormat,
    },
    {
      enabled: statement.status === 'completed' && !!statement.id,
      refetchOnWindowFocus: false,
    },
  )

  const rendered = useRenderedStatement(statementData, statement.status === 'completed')
  const previewError = queryError?.message ?? rendered.error

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
        {statement.status !== 'completed' ? null : previewError != null ? (
          <ErrorBanner
            message={previewError}
            rightContent={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (queryError) {
                    void refetch()
                  } else {
                    rendered.retry()
                  }
                }}
              >
                Retry
              </Button>
            }
          />
        ) : isLoading || !rendered.document ? (
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
              <PDFViewer width="100%" height="100%" style={{ border: 'none' }} showToolbar={false}>
                {rendered.document}
              </PDFViewer>
            </Box>
          </Stack>
        )}
      </Flex>
    </Box>
  )
}
