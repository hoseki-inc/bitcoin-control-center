import { useEffect, useState } from 'react'
import type { StatementDto } from '../trpc/server-types'

/** How long the ring takes to reach 100% before it fills in to the check. */
export const RING_FILL_MS = 400

/** How long "Statement Completed" and the check stay up before the screen fades out. */
export const COMPLETED_HOLD_MS = 1800

/** Sentinel's progress fills the ring this far; drawing the statement fills the rest. */
const GENERATED_PERCENT = 90
const DOCUMENT_LOADED_PERCENT = 95

type Phase = 'hidden' | 'generating' | 'completed' | 'finished'

interface StatementGeneration {
  /** From when generation opens; it stays mounted after closing so the screen can fade out. */
  isMounted: boolean
  isOpen: boolean
  /** What the ring shows, 0–100. It never goes back. */
  progress: number
  /** Show the check and "Statement Completed". */
  isCompleted: boolean
  close: () => void
}

/**
 * The generation screen for a statement. It opens for a confirmed generating status. Sentinel's
 * progress fills the ring to 90%; loading the statement's data takes it to 95% and drawing it to
 * 100%. The ring then fills in to a check, which holds before the screen closes. A failed statement
 * closes the screen straight away.
 */
export function useStatementGeneration({
  isConfirmedPending,
  status,
  progress,
  isDocumentLoaded,
  isDocumentReady,
}: {
  /** The current status is generating, confirmed since the page opened. */
  isConfirmedPending: boolean
  status: StatementDto['status']
  /** Sentinel's 0–100 while generating. */
  progress: number | null
  isDocumentLoaded: boolean
  /** The statement is drawn, or couldn't be: the page shows the error then. */
  isDocumentReady: boolean
}): StatementGeneration {
  const [phase, setPhase] = useState<Phase>('hidden')
  const [highest, setHighest] = useState(0)
  // Set while rendering, so the page never shows through before the screen opens.
  if (phase === 'hidden' && isConfirmedPending) {
    setPhase('generating')
  }
  if (phase === 'generating' && status === 'failed') {
    setPhase('finished')
  }
  const target = shownPercent(status, progress, isDocumentLoaded, isDocumentReady)
  if (target > highest) {
    setHighest(target)
  }

  const isReady = phase === 'generating' && status === 'completed' && isDocumentReady
  useEffect(() => {
    if (!isReady) {
      return
    }
    // Let the ring reach 100% before it fills in.
    const timer = window.setTimeout(() => {
      setPhase('completed')
    }, RING_FILL_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [isReady])
  useEffect(() => {
    if (phase !== 'completed') {
      return
    }
    const timer = window.setTimeout(() => {
      setPhase('finished')
    }, COMPLETED_HOLD_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [phase])

  return {
    isMounted: phase !== 'hidden',
    isOpen: phase === 'generating' || phase === 'completed',
    progress: highest,
    isCompleted: phase === 'completed',
    close: () => {
      setPhase('finished')
    },
  }
}

function shownPercent(
  status: StatementDto['status'],
  progress: number | null,
  isDocumentLoaded: boolean,
  isDocumentReady: boolean,
): number {
  if (status === 'pending') {
    return Math.floor(((progress ?? 0) * GENERATED_PERCENT) / 100)
  }
  if (status === 'failed') {
    return 0
  }
  if (isDocumentReady) {
    return 100
  }
  return isDocumentLoaded ? DOCUMENT_LOADED_PERCENT : GENERATED_PERCENT
}
