import { Box, Stack, Text } from '@chakra-ui/react'
import type { Result } from '@patina/core'
import { CloudUploadIcon, RefreshCwIcon } from 'lucide-react'
import { type ChangeEvent, type DragEvent, useRef, useState } from 'react'

export type FileDropState = 'ready' | 'invalid' | 'valid'

type TextFileExtension = 'json' | 'txt'
type BinaryFileExtension = 'png' | 'jpg' | 'jpeg' | 'webp'
type FileExtension = TextFileExtension | BinaryFileExtension

type ContentTypeForExtensions<T extends ReadonlyArray<FileExtension>> = T[number] extends TextFileExtension
  ? string
  : T[number] extends BinaryFileExtension
    ? ArrayBuffer
    : never

export function FileDropReader<T, E extends ReadonlyArray<FileExtension>>({
  readyText,
  invalidText,
  validText,
  validationFn,
  onValidContentRead,
  onInvalidContentRead,
  acceptedFileTypes,
  status,
  onStatusChange,
  validIcon,
}: {
  readyText: string
  invalidText: string
  validText: string
  validationFn: (rawContent: ContentTypeForExtensions<E>, file: File) => Result<T, Error>
  onValidContentRead: (validatedContent: T, file: File) => void
  onInvalidContentRead?: (error: Error) => void
  acceptedFileTypes: E
  status: FileDropState
  onStatusChange?: (newStatus: FileDropState) => void
  validIcon?: React.ReactNode
}): JSX.Element {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handledJpgExtension: ReadonlyArray<FileExtension> =
    acceptedFileTypes.includes('jpg') && !acceptedFileTypes.includes('jpeg')
      ? [...acceptedFileTypes.filter((t) => t !== 'jpg'), 'jpg', 'jpeg']
      : acceptedFileTypes

  const fileExtensions = handledJpgExtension.map((type) => `.${type}`).join(',')
  const mimeTypes: string[] = handledJpgExtension.map((type) => {
    switch (type) {
      case 'json':
        return 'application/json'
      case 'png':
        return 'image/png'
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'webp':
        return 'image/webp'
      default:
        return 'text/plain'
    }
  })

  function handleFileRead(file: File) {
    if (mimeTypes.includes(file.type)) {
      const reader = new FileReader()
      reader.onload = (event) => {
        if (!event.target?.result) {
          onStatusChange?.('invalid')
          onInvalidContentRead?.(new Error('Invalid file'))
          return
        }

        const content = event.target.result

        // TODO: I would like to avoid the type assertion here. But i will need to refactor
        // this component to be more generic to handle both text and binary files.
        const validationResult = validationFn(content as ContentTypeForExtensions<E>, file)
        const newStatus = validationResult.isOk() ? 'valid' : 'invalid'
        onStatusChange?.(newStatus)

        if (validationResult.isOk()) {
          onValidContentRead(validationResult.unwrap(), file)
        } else {
          onInvalidContentRead?.(validationResult.unwrapErr())
        }
      }

      // Choose reading method based on file type
      if (file.type === 'application/json' || file.type === 'text/plain') {
        reader.readAsText(file)
      } else {
        reader.readAsArrayBuffer(file)
      }
    } else {
      onStatusChange?.('invalid')
      onInvalidContentRead?.(new Error(`Invalid file type, allowed types: ${acceptedFileTypes.join(', ')}`))
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileRead(file)
    }
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      handleFileRead(file)
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  function handleClick() {
    fileInputRef.current?.click()
  }

  return (
    <Box>
      <input
        ref={fileInputRef}
        type="file"
        accept={fileExtensions}
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />
      <Stack
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        alignItems="center"
        p={5}
        cursor="pointer"
        borderRadius="10px"
        border={status === 'valid' ? '1.5px solid' : '1.5px dashed'}
        borderColor={isDragging ? 'primary.500' : 'neutral.200'}
        transition="border-color 0.3s ease"
      >
        {status === 'ready' && (
          <>
            <CloudUploadIcon color="#64748B" width="32px" height="32px" />
            <Text textStyle="label/lg" fontWeight="semibold">
              {readyText}
            </Text>
          </>
        )}
        {status === 'invalid' && (
          <>
            <RefreshCwIcon color="#64748B" width="32px" height="32px" />
            <Text textStyle="label/lg" fontWeight="semibold" color="red.500">
              {invalidText}
            </Text>
          </>
        )}
        {status === 'valid' && (
          <>
            {validIcon}
            <Text textStyle="label/lg" fontWeight="semibold">
              {validText}
            </Text>
          </>
        )}
      </Stack>
    </Box>
  )
}
