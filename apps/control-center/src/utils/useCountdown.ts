import { useEffect, useState } from 'react'

interface UseCountdownReturn {
  minutes: string
  seconds: string
  timeRemaining: number
  isCounting: boolean
  start: () => void
  restart: () => void
}

export function useCountdown(initialTimeRemaining: number, autoReset: boolean = false): UseCountdownReturn {
  const [timeRemaining, setTimeRemaining] = useState(initialTimeRemaining)
  const [isCounting, setIsCounting] = useState(false)

  useEffect(() => {
    if (!isCounting) {
      return
    }

    const timerInterval = setInterval(() => {
      setTimeRemaining((prevTime) => {
        if (prevTime === 0) {
          setIsCounting(false)
          if (autoReset) {
            setTimeRemaining(initialTimeRemaining)
          }
          clearInterval(timerInterval)
          return 0
        } else {
          return prevTime - 1
        }
      })
    }, 1000)

    return () => clearInterval(timerInterval)
  }, [isCounting, initialTimeRemaining, autoReset])

  return {
    minutes: `${Math.floor(timeRemaining / 60)}`.padStart(2, '0'),
    seconds: `${timeRemaining % 60}`.padStart(2, '0'),
    /** Total time remaining in seconds */
    timeRemaining,
    isCounting,
    start: () => setIsCounting(true),
    restart: () => {
      setTimeRemaining(initialTimeRemaining)
      setIsCounting(true)
    },
  }
}
