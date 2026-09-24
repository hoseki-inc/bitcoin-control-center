import { Box, Text } from '@chakra-ui/react'
import { splitQRs } from 'bbqr'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useRef, useState } from 'react'

interface BBQrDisplayProps {
  /** Raw bytes to encode as BBQr. Mutually exclusive with `value`. */
  data?: Uint8Array
  /** BBQr file type: 'J' (JSON), 'U' (Unicode), 'P' (PSBT), 'B' (Binary), etc. */
  fileType?: string
  /** Plain string to display as a single static QR code. Mutually exclusive with `data`. */
  value?: string
  /** QR code size in pixels. Default 280. */
  size?: number
  /** Frame interval in ms for animated QR. Default 250. */
  frameDelay?: number
}

export function BBQrDisplay({
  data,
  fileType = 'U',
  value,
  size = 280,
  frameDelay = 250,
}: BBQrDisplayProps): JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const parts = useMemo(() => {
    if (value != null && value !== '') {
      return [value]
    }
    if (!data) {
      return []
    }
    const result = splitQRs(data, fileType)
    return result.parts
  }, [data, fileType, value])

  const isAnimated = parts.length > 1

  useEffect(() => {
    if (!isAnimated) {
      return
    }
    intervalRef.current = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % parts.length)
    }, frameDelay)
    return (): void => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isAnimated, parts.length, frameDelay])

  const firstPart = parts[0]
  if (firstPart == null || firstPart === '') {
    return <></>
  }

  const currentValue = parts[frameIndex] ?? firstPart

  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
      <Box bg="white" p={4} borderRadius="12px" border="1px solid" borderColor="border.subtle">
        <QRCodeSVG value={currentValue} size={size} level="L" />
      </Box>
      {isAnimated && (
        <Text textStyle="text/sm" color="text.tertiary" fontWeight="medium">
          Part {frameIndex + 1} of {parts.length}
        </Text>
      )}
    </Box>
  )
}
