import { getCACertificates, setDefaultCACertificates } from 'node:tls'

/** Honor authorities already trusted by the desktop OS, alongside Node's defaults. */
export function configureDesktopTlsTrust(): void {
  const systemCertificates = getCACertificates('system')
  if (systemCertificates.length === 0) return
  setDefaultCACertificates([...getCACertificates('default'), ...systemCertificates])
}
