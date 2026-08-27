# Security policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch. Older releases should be upgraded before reporting an issue that is already fixed in a supported version.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's **Security → Report a vulnerability** flow to create a private GitHub security advisory.

Include the affected version, reproduction steps, impact, and any suggested remediation. Avoid including real wallet descriptors, exchange credentials, seed material, or other personal data in the report.

The public repository must enable private vulnerability reporting before its first release. Until the public repository exists, reports should follow Hoseki's existing private security channel.

## Scope

Bitcoin Control Center stores sensitive portfolio configuration locally and connects to user-selected Bitcoin and exchange infrastructure. Reports involving local credential storage, descriptor handling, proof generation, Electrum transport, Tor integration, Electron boundaries, or StartOS packaging are especially valuable.
