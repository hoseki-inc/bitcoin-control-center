import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

/** Keep one notification per failed page, independent of render frequency. */
export function useQueryErrorToast(message: string | null, retry: () => void): void {
  const retryRef = useRef(retry)
  useEffect(() => {
    retryRef.current = retry
  }, [retry])

  useEffect(() => {
    if (!message) return
    const toastId = toast.error(message, {
      duration: 8000,
      action: { label: 'Try Again', onClick: () => retryRef.current() },
    })
    return () => {
      toast.dismiss(toastId)
    }
  }, [message])
}
