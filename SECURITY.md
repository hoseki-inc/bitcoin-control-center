# Security policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch. Older releases should be upgraded before reporting an issue that is already fixed in a supported version.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's **Security → Report a vulnerability** flow to create a private GitHub security advisory.

Include the affected version, reproduction steps, impact, and any suggested remediation. Avoid including real wallet descriptors, exchange credentials, seed material, or other personal data in the report.

The public repository must enable private vulnerability reporting before its first release. Until the public repository exists, reports should follow Hoseki's existing private security channel.

## Scope

Bitcoin Control Center stores sensitive portfolio configuration locally and connects to user-selected Bitcoin and exchange infrastructure. Reports involving local credential storage, descriptor handling, proof generation, Electrum transport, Tor integration, Electron boundaries, or StartOS packaging are especially valuable.

## Electrum TLS trust

Desktop adds authorities already trusted by the operating system to Node's existing defaults before starting Sentinel. Public SSL endpoints require a valid certificate chain and matching hostname/IP. The app does not install or automatically trust authorities received from a server.

The shared Electrum transport currently skips certificate verification for hosts classified as local/private. A successful private SSL connection does not establish server identity. Per-profile certificate import and explicit private-host verification are not implemented. Plain TCP is unencrypted. Keep the StartOS internal service connection compatible when changing this policy.
