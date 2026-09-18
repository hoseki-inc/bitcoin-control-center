import { Box, Button, Flex, Text } from '@chakra-ui/react'
import { Spinner } from '@hoseki/packages/ui/design-system'
import { joinQRs } from 'bbqr'
import { Html5Qrcode } from 'html5-qrcode'
import { CameraIcon, CameraOffIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const BBQR_HEADER = 'B$'

interface BBQrScannerProps {
  /** Called when a complete BBQr payload has been reassembled. */
  onComplete: (data: Uint8Array, fileType: string) => void
  /** Called when a non-BBQr (plain) QR code is scanned. */
  onPlainScan?: (text: string) => void
  /** Called when an unrecoverable error occurs. */
  onError?: (error: string) => void
  /** Called when the user clicks cancel. */
  onCancel?: () => void
}

type ScannerState = 'requesting-camera' | 'scanning' | 'error'

let scannerIdCounter = 0

export function BBQrScanner({ onComplete, onPlainScan, onError, onCancel }: BBQrScannerProps): JSX.Element {
  const [state, setState] = useState<ScannerState>('requesting-camera')
  const [errorMessage, setErrorMessage] = useState<string>()
  const [totalParts, setTotalParts] = useState(0)
  const [scannedCount, setScannedCount] = useState(0)

  // Stable refs for callbacks so the effect doesn't re-run when they change
  const onCompleteRef = useRef(onComplete)
  const onPlainScanRef = useRef(onPlainScan)
  const onErrorRef = useRef(onError)
  onCompleteRef.current = onComplete
  onPlainScanRef.current = onPlainScan
  onErrorRef.current = onError

  // Unique ID per mount to avoid element ID collisions
  const elementIdRef = useRef(`bbqr-scanner-${++scannerIdCounter}`)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const partsRef = useRef<Map<number, string>>(new Map())
  const expectedTotalRef = useRef<number>(0)
  const completedRef = useRef(false)

  useEffect(() => {
    let mounted = true
    let scanner: Html5Qrcode | null = null

    async function start(): Promise<void> {
      // Wait a tick to ensure the DOM element is rendered
      await new Promise((r) => setTimeout(r, 0))
      if (!mounted) {
        return
      }

      const el = document.getElementById(elementIdRef.current)
      if (!el) {
        return
      }

      // Get the first available camera (more reliable on desktop than facingMode)
      let cameraId: string | undefined
      try {
        const cameras = await Html5Qrcode.getCameras()
        if (cameras.length > 0) {
          cameraId = cameras[0]?.id
        }
      } catch {
        // Fall through to facingMode fallback
      }

      scanner = new Html5Qrcode(elementIdRef.current, { verbose: false })
      scannerRef.current = scanner

      try {
        const cameraConfig = cameraId ?? { facingMode: 'user' }
        // Use qrbox function to scan 85% of the viewport — maximizes scan area
        await scanner.start(
          cameraConfig,
          {
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.85)
              return { width: size, height: size }
            },
            aspectRatio: 1,
          },
          (decodedText) => {
            if (!mounted || completedRef.current) {
              return
            }
            handleScan(decodedText)
          },
          undefined,
        )
        if (mounted) {
          setState('scanning')
        }
      } catch (err) {
        if (!mounted) {
          return
        }
        const msg = err instanceof Error ? err.message : 'Camera access denied'
        setState('error')
        setErrorMessage(msg)
        onErrorRef.current?.(msg)
      }
    }

    function handleScan(decodedText: string): void {
      if (completedRef.current) {
        return
      }

      // Check if this is a BBQr frame
      if (decodedText.startsWith(BBQR_HEADER) && decodedText.length >= 8) {
        const total = parseInt(decodedText.slice(4, 6), 36)
        const partIndex = parseInt(decodedText.slice(6, 8), 36)

        if (isNaN(total) || isNaN(partIndex) || total < 1 || partIndex >= total) {
          return
        }

        // First frame: set expected total
        if (expectedTotalRef.current === 0) {
          expectedTotalRef.current = total
          setTotalParts(total)
        }

        // Collect this part
        if (!partsRef.current.has(partIndex)) {
          partsRef.current.set(partIndex, decodedText)
          setScannedCount(partsRef.current.size)
        }

        // Check if we have all parts
        if (partsRef.current.size === expectedTotalRef.current) {
          completedRef.current = true

          // Build ordered array of all frame strings
          const allParts: string[] = []
          for (let i = 0; i < expectedTotalRef.current; i++) {
            const part = partsRef.current.get(i)
            if (!part) {
              setState('error')
              setErrorMessage(`Missing part ${i}`)
              onErrorRef.current?.(`Missing part ${i}`)
              return
            }
            allParts.push(part)
          }

          try {
            const result = joinQRs(allParts)
            // Stop scanner first, then defer the completion callback to the next tick.
            // This avoids triggering React state updates + component unmount while
            // html5-qrcode is still inside its scan callback loop.
            void stopScannerInstance(scanner).then(() => {
              onCompleteRef.current(result.raw, result.fileType)
            })
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to decode QR data'
            setState('error')
            setErrorMessage(msg)
            onErrorRef.current?.(msg)
          }
        }
      } else if (onPlainScanRef.current) {
        // Non-BBQr single QR code
        completedRef.current = true
        const cb = onPlainScanRef.current
        void stopScannerInstance(scanner).then(() => cb(decodedText))
      }
    }

    void start()

    return (): void => {
      mounted = false
      void stopScannerInstance(scanner ?? scannerRef.current)
      scannerRef.current = null
    }
    // Empty deps: runs once on mount, cleans up on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleCancel(): void {
    void stopScannerInstance(scannerRef.current)
    onCancel?.()
  }

  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap={4} w="100%">
      {/* Camera viewport — html5-qrcode injects a <video> + overlay inside this div */}
      <Box
        id={elementIdRef.current}
        w="100%"
        maxW="400px"
        borderRadius="12px"
        overflow="hidden"
        border="1px solid"
        borderColor="neutral.200"
        bg="neutral.900"
        sx={{
          // html5-qrcode injects child elements; keep them tidy
          '& video': { borderRadius: '12px' },
          // Hide the default scan region border that html5-qrcode draws
          '& #qr-shaded-region': { display: 'none !important' },
        }}
      />

      {/* Status indicators */}
      {state === 'requesting-camera' && (
        <Flex align="center" gap={2}>
          <Spinner size="sm" />
          <Text textStyle="text/sm" color="neutral.500">
            Requesting camera access...
          </Text>
        </Flex>
      )}

      {state === 'scanning' && totalParts > 1 && (
        <Flex align="center" gap={2} bg="neutral.50" px={4} py={2} borderRadius="8px">
          <CameraIcon size={16} />
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.700">
            Scanned {scannedCount} of {totalParts} parts
          </Text>
        </Flex>
      )}

      {state === 'scanning' && totalParts <= 1 && (
        <Flex align="center" gap={2}>
          <CameraIcon size={16} />
          <Text textStyle="text/sm" color="neutral.500">
            Point your webcam at the QR code...
          </Text>
        </Flex>
      )}

      {state === 'error' && (
        <Flex direction="column" align="center" gap={2}>
          <Flex align="center" gap={2} color="error.500">
            <CameraOffIcon size={16} />
            <Text textStyle="text/sm" fontWeight="medium">
              {errorMessage ?? 'Camera error'}
            </Text>
          </Flex>
          <Text textStyle="text/xs" color="neutral.400">
            Make sure your browser has camera permissions enabled.
          </Text>
        </Flex>
      )}

      {/* Cancel button */}
      {onCancel && (
        <Button variant="outline" size="sm" onClick={handleCancel}>
          Cancel
        </Button>
      )}
    </Box>
  )
}

async function stopScannerInstance(scanner: Html5Qrcode | null): Promise<void> {
  if (!scanner) {
    return
  }
  if (scanner.isScanning) {
    try {
      await scanner.stop()
    } catch {
      // Ignore stop errors during cleanup
    }
  }
  try {
    scanner.clear()
  } catch {
    // Element may already be removed
  }
}
