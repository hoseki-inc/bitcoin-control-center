import { getCACertificates, setDefaultCACertificates } from 'node:tls'

/** Honor authorities already trusted by the desktop OS, alongside Node's defaults. */
export function configureDesktopTlsTrust(getCertificates: typeof getCACertificates = getCACertificates): void {
  const systemCertificates = getCertificates('system')
  if (systemCertificates.length === 0) {
    return
  }
  setDefaultCACertificates([...getCertificates('default'), ...systemCertificates])
}
