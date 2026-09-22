import type { StatementDocumentFormat } from '@hoseki/packages/schemas/pdf-statement'
import { type UseMutationOptions, type UseMutationResult, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

export function usePdfDownloadMutation<T extends object>(
  options: UseMutationOptions<void, Error, { statement: T; format: StatementDocumentFormat }, unknown> & {
    mutationFn: (variables: { statement: T; format: StatementDocumentFormat }) => Promise<void>
  },
): UseMutationResult<void, Error, { statement: T; format: StatementDocumentFormat }, unknown> {
  return useMutation({
    onError: (error) => {
      toast.error('Statement not downloaded', { description: error.message })
    },
    onSuccess: () => {
      toast.success('Statement downloaded successfully')
    },
    ...options,
  })
}

export async function saveToFile({ response, filename }: { response: Response; filename: string }): Promise<void> {
  if (!response.ok) {
    throw new Error('Failed to download PDF')
  }
  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()

  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export function getFilenameFromResponse(response: Response): string {
  // Purposely not treating the absence of the header as an error.
  const contentDisposition = response.headers.get('Content-Disposition') ?? ''
  // Extract filename from content disposition header
  // Format: attachment; filename="HOSEKI_STATEMENT_28APR2025_28JUL2025_b140aae4.pdf"
  const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
  const filenameMatch = contentDisposition.match(filenameRegex)
  return filenameMatch?.[1] ?? 'statement.pdf'
}
