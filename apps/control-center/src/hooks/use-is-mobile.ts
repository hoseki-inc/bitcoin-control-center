import { useEffect, useState } from 'react'

declare global {
  interface Window {
    opera?: string
  }
}

/**
 * Hook to detect if the user is on a mobile device
 * Checks user agent for common mobile device patterns
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      const userAgent =
        navigator.userAgent.length > 0
          ? navigator.userAgent
          : navigator.vendor.length > 0
            ? navigator.vendor
            : (window.opera ?? '')

      // Check for mobile devices
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
      const isMobileDevice = mobileRegex.test(userAgent)

      // Also check screen width as a fallback
      const isSmallScreen = window.innerWidth <= 768

      setIsMobile(isMobileDevice || isSmallScreen)
    }

    checkMobile()

    // Re-check on resize
    window.addEventListener('resize', checkMobile)
    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])

  return isMobile
}
