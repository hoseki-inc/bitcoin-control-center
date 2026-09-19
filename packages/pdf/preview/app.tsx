import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Box,
  Button,
  Center,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  IconButton,
  Switch,
  Text,
  Textarea,
  VStack,
} from '@chakra-ui/react'
import { PDFViewer } from '@react-pdf/renderer'
import { AlertTriangle, CheckCircle, Eye, EyeOff, FileText, XCircle } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import superjson from 'superjson'
import { registerCustomSerializers } from '../../custom-serializers'
import { type PdfStatement, PdfStatementSchema } from '../../schemas'
import { renderStatementDocument } from '../statement-pdf-renderer'
import { sampleCustomStatement, sampleMonthlyStatement } from './presets'

// Initialize superjson with custom serializers
const serializer = registerCustomSerializers(superjson)

interface AlertPanelProps {
  validationError: string | null
  parsedStatement: PdfStatement | null
}

const AlertPanel: React.FC<AlertPanelProps> = ({ validationError, parsedStatement }) => {
  const [alertsMinimized, setAlertsMinimized] = useState(false)

  const toggleAlertsMinimized = () => {
    setAlertsMinimized(!alertsMinimized)
  }

  const hasAlerts = validationError || parsedStatement

  if (!hasAlerts) {
    return null
  }

  return (
    <>
      {/* Expanded Alerts */}
      {!alertsMinimized && (
        <>
          {/* Validation Error Display */}
          {validationError && (
            <Alert status="error" borderTop="1px" borderColor="red.200" alignItems="flex-start" maxH="500px">
              <AlertIcon />
              <Box flex={1} minH={0} display="flex" flexDir="column">
                <AlertTitle>Validation Error:</AlertTitle>
                <AlertDescription mt={2} flex={1} minH={0}>
                  <Box
                    as="pre"
                    fontSize="sm"
                    whiteSpace="pre-wrap"
                    maxH="400px"
                    overflowY="auto"
                    p={2}
                    bg="red.50"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="red.200"
                  >
                    {validationError}
                  </Box>
                </AlertDescription>
              </Box>
              <IconButton
                aria-label="Minimize alert"
                icon={<Icon as={EyeOff} />}
                size="sm"
                variant="ghost"
                colorScheme="red"
                onClick={toggleAlertsMinimized}
              />
            </Alert>
          )}

          {parsedStatement && (
            <Alert status="success" borderTop="1px" borderColor="green.200">
              <AlertIcon />
              <Box flex={1}>
                <AlertTitle>Valid JSON</AlertTitle>
                <AlertDescription fontSize="sm">
                  Schema: <strong>PdfStatementSchema</strong> | Format: <strong>{parsedStatement.format}</strong>
                </AlertDescription>
              </Box>
              <IconButton
                aria-label="Minimize alert"
                icon={<Icon as={EyeOff} />}
                size="sm"
                variant="ghost"
                colorScheme="green"
                onClick={toggleAlertsMinimized}
              />
            </Alert>
          )}
        </>
      )}

      {/* Minimized Alert Badge */}
      {alertsMinimized && (
        <Box position="absolute" bottom={4} right={4} zIndex={10}>
          <Badge
            bg={validationError ? 'red.200' : 'green.200'}
            color={validationError ? 'red.800' : 'green.800'}
            px={3}
            py={2}
            borderRadius="md"
            cursor="pointer"
            onClick={toggleAlertsMinimized}
            display="flex"
            alignItems="center"
            gap={2}
            fontSize="sm"
            fontWeight="medium"
            boxShadow="md"
            _hover={{
              bg: validationError ? 'red.300' : 'green.300',
              transform: 'translateY(-1px)',
              boxShadow: 'lg',
            }}
            transition="all 0.2s"
          >
            <Icon
              as={validationError ? AlertTriangle : CheckCircle}
              color={validationError ? 'red.600' : 'green.600'}
              boxSize={4}
            />
            <Icon as={Eye} boxSize={4} />
          </Badge>
        </Box>
      )}
    </>
  )
}

export default function App(): JSX.Element {
  const [jsonInput, setJsonInput] = useState('')
  const [parsedStatement, setParsedStatement] = useState<PdfStatement | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showToolbar, setShowToolbar] = useState(true)
  const [hasExampleWatermark, setHasExampleWatermark] = useState(false)
  const [pdfDocument, setPdfDocument] = useState<React.ReactElement | null>(null)

  // Function to format statement data to JSON string using superjson
  const formatStatementToJson = useCallback((statement: PdfStatement) => {
    const serialized = serializer.serialize(statement)
    return JSON.stringify(serialized, null, 2)
  }, [])

  // Initialize with sample data
  useEffect(() => {
    const formattedJson = formatStatementToJson(sampleCustomStatement)
    setJsonInput(formattedJson)
  }, [formatStatementToJson])

  useEffect(() => {
    async function loadPdf() {
      try {
        if (!parsedStatement) {
          return
        }

        const document = await renderStatementDocument({
          watermarkText: 'Statement Example',
          statement: parsedStatement,
        })
        setPdfDocument(document)
      } catch (error) {
        console.error('Error rendering PDF:', error)
      }
    }

    loadPdf()
  }, [parsedStatement, hasExampleWatermark, setPdfDocument, showToolbar])

  const validateAndParseJson = useCallback(() => {
    try {
      // Parse the JSON and deserialize using superjson
      const parsedJson = JSON.parse(jsonInput)
      const processedJson = serializer.deserialize(parsedJson)

      const result = PdfStatementSchema.safeParse(processedJson)

      if (result.success) {
        setParsedStatement(result.data)
        setValidationError(null)
      } else {
        setValidationError(result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n'))
        setParsedStatement(null)
      }
    } catch (error) {
      setValidationError(`JSON Parse Error: ${error instanceof Error ? error.message : String(error)}`)
      setParsedStatement(null)
    }
  }, [jsonInput])

  // Validate on mount and when JSON changes
  useEffect(() => {
    if (jsonInput) {
      validateAndParseJson()
    }
  }, [jsonInput, validateAndParseJson])

  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonInput(e.target.value)
  }

  const handleLoadCustomPreset = () => {
    setJsonInput(formatStatementToJson(sampleCustomStatement))
  }

  const handleLoadMonthlyPreset = () => {
    setJsonInput(formatStatementToJson(sampleMonthlyStatement))
  }

  return (
    <VStack h="100vh" bg="gray.100" spacing={0}>
      {/* Root Toolbar */}
      <Box w="100%" bg="white" borderBottom="1px" borderColor="gray.300" px={6} py={4}>
        <HStack spacing={8} justify="space-between">
          {/* Left side - Presets */}
          <HStack spacing={4}>
            <Text fontSize="sm" fontWeight="medium" color="gray.700">
              Presets:
            </Text>
            <Button size="sm" variant="outline" colorScheme="blue" onClick={handleLoadCustomPreset}>
              Custom Statement
            </Button>
            <Button size="sm" variant="outline" colorScheme="blue" onClick={handleLoadMonthlyPreset}>
              Monthly Statement
            </Button>
          </HStack>

          {/* Right side - Controls */}
          <HStack spacing={6}>
            <FormControl display="flex" alignItems="center" width="auto">
              <FormLabel htmlFor="show-toolbar" mb={0} fontSize="sm" fontWeight="medium">
                Show PDF Toolbar
              </FormLabel>
              <Switch
                id="show-toolbar"
                isChecked={showToolbar}
                onChange={(e) => {
                  setShowToolbar(e.target.checked)
                }}
                colorScheme="blue"
              />
            </FormControl>

            <FormControl display="flex" alignItems="center" width="auto">
              <FormLabel htmlFor="example-watermark" mb={0} fontSize="sm" fontWeight="medium">
                Show Watermark
              </FormLabel>
              <Switch
                id="example-watermark"
                isChecked={hasExampleWatermark}
                onChange={(e) => {
                  setHasExampleWatermark(e.target.checked)
                }}
                colorScheme="blue"
              />
            </FormControl>
          </HStack>
        </HStack>
      </Box>

      {/* Main Content */}
      <Flex flex={1} w="100%">
        {/* Left Panel - JSON Editor */}
        <Box w="50%" borderRight="1px" borderColor="gray.300" display="flex" flexDir="column" position="relative">
          <VStack flex={1} spacing={0} align="stretch">
            <Textarea
              value={jsonInput}
              onChange={handleJsonChange}
              flex={1}
              p={4}
              fontFamily="mono"
              fontSize="sm"
              resize="none"
              border="none"
              outline="none"
              _focus={{ boxShadow: 'none' }}
              placeholder="Enter your JSON here..."
              spellCheck={false}
            />

            <AlertPanel validationError={validationError} parsedStatement={parsedStatement} />
          </VStack>
        </Box>

        {/* Right Panel - PDF Viewer */}
        <Box w="50%" display="flex" flexDir="column">
          <Box flex={1} bg="gray.50">
            {pdfDocument ? (
              <PDFViewer width="100%" height="100%" style={{ border: 'none' }} showToolbar={showToolbar}>
                {pdfDocument}
              </PDFViewer>
            ) : (
              <Center h="100%" color="gray.500">
                {validationError ? (
                  <VStack>
                    <Icon as={XCircle} color="red.500" boxSize={6} />
                    <Text textAlign="center">Fix the JSON validation errors to see the PDF preview</Text>
                  </VStack>
                ) : (
                  <VStack>
                    <Icon as={FileText} color="gray.400" boxSize={6} />
                    <Text textAlign="center">Enter valid JSON to see the PDF preview</Text>
                  </VStack>
                )}
              </Center>
            )}
          </Box>
        </Box>
      </Flex>
    </VStack>
  )
}
