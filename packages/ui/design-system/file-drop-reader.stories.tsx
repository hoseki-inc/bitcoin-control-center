import { Box, Icon, Stack } from '@chakra-ui/react'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import type { Story, StoryDefault } from '@ladle/react'
import { CheckCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { FileDropReader, type FileDropState } from './file-drop-reader'

export default {
  title: 'Prove and Verify / File Drop Reader',
} satisfies StoryDefault

type CustomType = {
  foo: string
}

export const Default: Story = () => {
  const [jsonStatus, setJsonStatus] = useState<FileDropState>('ready')
  const [txtStatus, setTxtStatus] = useState<FileDropState>('ready')
  const [imageStatus, setImageStatus] = useState<FileDropState>('ready')

  return (
    <Stack spacing={8}>
      <Box>
        <p>Must be a JSON file, otherwise invalid:</p>
        <FileDropReader
          readAs="text"
          readyText="Drag 'whatever.json' here"
          invalidText="Invalid file. Please check your file and try again."
          validText="Click 'Continue' to continue"
          validationFn={(content): Result<CustomType, Error> => {
            try {
              JSON.parse(content)
              return Ok({ foo: 'bar' })
            } catch {
              return Err(new Error('Invalid JSON content'))
            }
          }}
          onValidContentRead={(content) => {
            console.log('Success!', content)
          }}
          acceptedFileTypes={['json']}
          status={jsonStatus}
          onStatusChange={setJsonStatus}
          validIcon={<Icon as={CheckCircleIcon} color="green.500" boxSize="32px" />}
        />
      </Box>
      <Box>
        <p>Must be a .txt file with contents "foo", otherwise invalid:</p>
        <FileDropReader
          readAs="text"
          readyText="Drag 'foo.txt' here"
          invalidText="Invalid file. Please check your file and try again."
          validText="Click 'Continue' to continue"
          validationFn={(content): Result<string, Error> => {
            if (content === 'foo') {
              return Ok(content)
            } else {
              return Err(new Error('Invalid content, expected "foo"'))
            }
          }}
          onValidContentRead={(content) => {
            console.log('Success!', content)
          }}
          acceptedFileTypes={['txt']}
          status={txtStatus}
          onStatusChange={setTxtStatus}
        />
      </Box>
      <Box>
        <p>Accepts PNG, JPEG, and WebP images:</p>
        <FileDropReader
          readAs="arrayBuffer"
          readyText="Drag an image file here (PNG, JPEG, or WebP)"
          invalidText="Invalid image file. Please check your file and try again."
          validText="Click 'Continue' to continue"
          validationFn={(content: ArrayBuffer): Result<ArrayBuffer, Error> => {
            if (content.byteLength > 0) {
              return Ok(content)
            }
            return Err(new Error('Failed to read image file'))
          }}
          onValidContentRead={(_, file) => {
            console.log('Image loaded successfully!', file.name)
          }}
          acceptedFileTypes={['png', 'jpg', 'jpeg', 'webp']}
          status={imageStatus}
          onStatusChange={setImageStatus}
          validIcon={<Icon as={CheckCircleIcon} color="green.500" boxSize="32px" />}
        />
      </Box>
    </Stack>
  )
}
