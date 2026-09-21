import { Box, Button, Flex, HStack, Icon, Link, Stack, Text } from '@chakra-ui/react'
import { renderStatementDocument } from '@hoseki/packages/pdf'
import { type StatementDocumentFormat, type StatementId } from '@hoseki/packages/schemas'
import { Animations, ErrorBanner, Spinner } from '@hoseki/packages/ui/design-system'
import { StatusBadge, getBadgeConfigForStatement, usePdfDownloadMutation } from '@hoseki/packages/ui/prove-verify-ui'
import { PDFViewer, pdf } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { DownloadIcon, ShieldCheckIcon } from 'lucide-react'
import { type ReactElement, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { UrlParameter, useUrlParameter } from '../../hooks/use-url-parameters'
import { baseTrpc, trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'

export function StatementDetailsPage(): JSX.Element {
  const statementId = useUrlParameter(UrlParameter.statementId)

  if (!statementId) {
    return (
      <Box p={4}>
        <ErrorBanner mb={4} message="Invalid statement ID provided in URL" />
      </Box>
    )
  }

  return <StatementDetailsPageContent statementId={statementId} />
}

function StatementDetailsPageContent({ statementId }: { statementId: StatementId }) {
  const { data: statement, isLoading, error } = trpc.portalProve.statement.retrieve.useQuery(statementId)
  const [statementFormat, setStatementFormat] = useState<StatementDocumentFormat>('custom')

  if (error) {
    return (
      <Box p={4}>
        <ErrorBanner mb={4} message={`Error: ${error?.message ?? ''}`} />
      </Box>
    )
  }

  if (isLoading) {
    return <Spinner fullPage size="xl" />
  }

  if (!statement) {
    return (
      <Box pt={8}>
        <Text>No statement found.</Text>
      </Box>
    )
  }

  return (
    <Flex gap={0} flexDirection={['column', 'column', 'row']} align="flex-start">
      <Stack
        gap={6}
        height={['auto', 'auto', 'calc(100vh - 66px)']}
        flexBasis={['100%', '100%', '40%']}
        maxW={['100%', '100%', '40%']}
        py={6}
        px={8}
      >
        <BackLink />
        <Stack gap={12}>
          <StatementSummary statement={statement} />
          <ActionButtons statement={statement} statementFormat={statementFormat} />
          <LearnMore />
        </Stack>
      </Stack>
      <Box
        height={['auto', 'auto', 'calc(100vh - 66px)']}
        flexBasis={['100%', '100%', '60%']}
        width={['100%', '100%', '60%']}
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
          <HStack justifyContent="space-between">
            {statement.user?.name && (
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
              <Text>{statement.user?.email || 'N/A'}</Text>
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
      <Stack gap={2}>
        <Text as="h2" textStyle="text/lg" fontWeight="medium">
          Statement Attributes
        </Text>
        <Text textStyle="text/sm">
          Period: {format(statement.openingDate, 'd MMMM yyyy')} - {format(statement.closingDate, 'd MMMM yyyy')}
        </Text>
      </Stack>
    </Stack>
  )
}

async function triggerPdfDownload(args: { statement: StatementDto; format: StatementDocumentFormat }): Promise<void> {
  // Fetch the PdfStatement data via tRPC (same data the preview uses)
  const statementData = await baseTrpc.portalProve.statement.retrieveDocumentData.query({
    statementId: args.statement.id,
    format: args.format,
  })

  // Render the PDF document client-side (same pipeline as the preview)
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
  const { mutateAsync: downloadPdf, isLoading: isDownloadingPdf } = usePdfDownloadMutation({
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
          onClick={async () => {
            await downloadPdf({ statement, format: statementFormat })
          }}
          isLoading={isDownloadingPdf}
          isDisabled={statement.status !== 'completed'}
        >
          <Icon as={DownloadIcon} mr={2} />
          Download
        </Button>
      </HStack>
    </Box>
  )
}

function BackLink() {
  return (
    <Link
      as={RouterLink}
      to="/portfolio"
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
  const [pdfDocument, setPdfDocument] = useState<ReactElement | null>(null)

  const { data: statementData, isLoading } = trpc.portalProve.statement.retrieveDocumentData.useQuery(
    {
      statementId: statement.id,
      format: statementFormat,
    },
    {
      enabled: statement.status === 'completed' && !!statement.id,
      refetchOnWindowFocus: false,
    },
  )

  useEffect(() => {
    async function loadPdf() {
      try {
        if (!statementData) {
          return
        }

        const document = await renderStatementDocument({
          watermarkText: 'Statement Preview',
          statement: statementData,
        })
        setPdfDocument(document)
      } catch (error) {
        console.error('Error rendering PDF:', error)
      }
    }

    void loadPdf()
  }, [statementData])

  return (
    <Box height={['600px', '600px', '100%']} width="100%" display="flex" justifyContent="center" alignItems="center">
      <Flex
        justifyContent="center"
        alignItems="center"
        height="90%"
        width="90%"
        borderColor="neutral.200"
        borderWidth="1px"
      >
        {statement.status !== 'completed' ? (
          <PreviewUnavailable />
        ) : isLoading || !pdfDocument ? (
          <Spinner centered />
        ) : (
          <Stack width="100%" height="100%">
            <HStack justifyContent="center" alignItems="center" gap={4} py={4}>
              <Button
                variant={statementFormat === 'custom' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => {
                  if (statementFormat === 'custom') {
                    return
                  }
                  onStatementFormatChange('custom')
                  setPdfDocument(null)
                }}
              >
                Full Period
              </Button>
              <Button
                variant={statementFormat === 'monthly' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => {
                  if (statementFormat === 'monthly') {
                    return
                  }
                  onStatementFormatChange('monthly')
                  setPdfDocument(null)
                }}
              >
                Monthly
              </Button>
            </HStack>
            <Box sx={Animations.fadeIn(0.25)} width="100%" height="100%">
              <PDFViewer width="100%" height="100%" style={{ border: 'none' }} showToolbar={false}>
                {pdfDocument}
              </PDFViewer>
            </Box>
          </Stack>
        )}
      </Flex>
    </Box>
  )
}

function PreviewUnavailable() {
  return (
    <Box textAlign="center">
      <Text fontSize="lg" fontWeight="medium" color="neutral.700">
        Preview Unavailable
      </Text>
      <Text color="neutral.600" mt={2}>
        Only requests that have been accepted can be previewed.
      </Text>
    </Box>
  )
}
