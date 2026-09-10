# Desktop connections to your own Electrum server

Proposed plan, September 7, 2026. The desktop fixes are checkpointed in `9dfb0ae` on `desktop-app-review`. This document proposes the next work; it does not implement it.

**September 10 update:** the public-IP interface exposed a desktop trust-store gap. The node's Root CA was already trusted in macOS, and its public certificate matched the endpoint, but Electron's Node backend only used its bundled public authorities. A direct TLS diagnostic reproduced the untrusted-chain failure and then passed full verification using the existing system trust store in approximately 160 ms. This is handshake timing, not a wallet-sync benchmark. Desktop startup now supplements its existing authorities with the OS-trusted authorities before starting Sentinel. This change is confined to the desktop launcher; it does not install a certificate, disable public certificate verification, or change StartOS behavior. A per-connection certificate-import UI and named connection profiles remain unimplemented. The original plan below is retained as future work.

The user confirmed a successful physical Trezor connection and reported very slow private Electrum access through Tor. Their node runs Electrs. Their installed StartOS version is still unconfirmed, so the StartOS 0.4 guidance below must be checked against the installed service before giving exact setup instructions.

## Recommendation

Make **My own node** a first-class choice, with direct LAN access as the first delivery. Support direct remote access to the same node through an existing VPN or a deliberately configured public TLS endpoint. Keep Tor available as an explicit route.

| Connection            | Intended use                                                         | App behavior                                                        |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| LAN                   | Computer and node are on the same network                            | Connect directly to the node's advertised IP or hostname and port.  |
| Private remote access | User has a VPN route to their node                                   | Use the same direct connection; VPN setup remains outside the app.  |
| Own public endpoint   | User intentionally makes their Electrum service reachable remotely   | Connect to its public hostname and port using verified TLS.         |
| Tor                   | User chooses an onion address or wants to route Electrum through Tor | Use the bundled Tor process and keep its readiness/error reporting. |

StartOS documents LAN and VPN as private access methods. Its VPN guidance recommends a LAN IP or suitable private domain because `.local` discovery often does not cross the VPN. [StartOS private access](https://docs.start9.com/start-os/0.4.0.x/private-access.html), [inbound VPN](https://docs.start9.com/start-os/0.4.0.x/inbound-vpn.html).

## What already exists

- [Desktop settings](../apps/control-center/src/pages/settings/index.tsx) already accept a custom host, port, TCP/SSL, and a Tor toggle. Turning Tor off selects direct transport; LAN does not require another backend.
- Selecting **Custom Server** while a preset is active currently does nothing: the change handler only handles known presets. Editing the host manually works, but the selector makes that hard to discover.
- [Backend validation](../apps/api-sentinel/src/modules/trpc/router.ts) accepts local names and IP addresses but rejects a pasted `ssl://host:port` address. The connection test only opens the connection and negotiates `server.version`.
- [TLS transport](../packages/clients/electrum/lib/protocol.ts) verifies public hosts but automatically skips certificate verification for names/IPs classified as local or private. That permits encryption without establishing which server answered. Explicit trust needs to replace this desktop behavior.
- Atomic save/reconnect and preserving the previous connection after a failed change are already implemented in [the application context](../apps/api-sentinel/src/context.ts).
- [Electrum address discovery](../packages/bitcoin/onchain/electrum_provider.ts) starts with receive/change indexes of zero and performs lookups in groups of ten. This could amplify Tor latency; it is not yet established as the cause of the user's delay. Other portfolio/history caching already exists.

## Observed connection baseline

After the plan was drafted, the user supplied their live Electrs interface screen. All three local SSL endpoints answered protocol and block-tip queries from this Mac and reported Electrs 0.11.1. The screenshot's onion endpoint uses TCP on port 50001; the public endpoint is disabled and was not tested or enabled. Private addresses are intentionally omitted from this repository document.

The running desktop app's existing **Test Connection** API produced these results without saving settings or querying wallet addresses:

| Route        | Connection-test elapsed time                | Interpretation                                                                         |
| ------------ | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| LAN IPv4     | 24 ms; repeat 72 ms                         | Best initial path for the user's account-level comparison.                             |
| LAN hostname | 5,230 ms initially; repeats 36 ms and 25 ms | Works, but the initial delay needs resolution/connect timing before assigning a cause. |
| LAN IPv6     | 21 ms                                       | Reachable; certificate validation needs attention before recommending it.              |
| Tor TCP      | 6,825 ms; repeat 1,535 ms                   | Works with an already-ready Tor process; these figures exclude Tor bootstrap.          |

Separate TLS/protocol probes returned tip/ping responses in roughly 3–7 ms over LAN. Strict certificate verification succeeded for IPv4 in the standalone Node test environment. For the hostname, the current app-style connection without TLS SNI received the wrong certificate; explicitly sending the hostname as SNI made strict verification succeed. IPv6 still failed the strict certificate-name check. The packaged app currently skips private-host certificate verification, so its successful tests do not establish certificate trust. The app's saved, connected Tor configuration remained unchanged after the tests.

These are a few connection samples, not a wallet-sync benchmark. Next compare the same account's initial load, warm refresh, and transaction history over LAN and Tor. Add explicit TLS SNI for local DNS names to the implementation plan, independently of CA trust configuration; raw IP addresses should not be sent as DNS SNI names.

## 1. Establish the LAN baseline

Confirm the installed StartOS version and copy the actual Electrs LAN connection details from its service interface. Check Electrs' sync health before comparing routes. Use the current desktop host/port fields, the advertised protocol, and Tor off to establish whether direct access works before changing the UI.

For current StartOS Electrs packaging, LAN and public-domain connections use TLS. The external port is assigned by StartOS and can differ between installations, including migrated nodes; neither 50001 nor 50002 is a safe assumption. Internal service addresses are separate from desktop-reachable addresses. [Electrs package networking](https://github.com/Start9Labs/electrs-startos#network-access-and-interfaces).

Use the protocol actually advertised for an onion endpoint. The Electrs package documents a Tor SSL toggle, while the general wallet guide describes TLS everywhere; do not infer an existing onion's protocol from the general guide or change a working saved configuration automatically.

## 2. Make connection setup understandable

Replace the preset-first form with **My own node** and **Public server** choices. For an own node, accept a pasted Electrum address and display the parsed host, port, protocol, and selected direct/Tor route before testing. Retain editable advanced fields. Fix the Custom Server selection behavior as part of this change.

Support `ssl://host:port`, `tcp://host:port`, bare `host:port`, and bracketed IPv6. Require an explicit port when it is absent; do not guess a StartOS port. For an address without a scheme, show TLS as the editable default. Reject credentials, web paths, and malformed addresses with useful messages. An onion address requires Tor; selecting it must visibly select that route before any connection attempt.

Reuse this setup on a fresh desktop profile before its first Electrum connection or wallet query. Preserve existing users' saved server/route choices. A public server remains a separate, explicit choice, since it receives the user's address-history queries.

Show **Direct** or **Tor**, TLS trust, and the active endpoint. Do not label a direct connection as LAN or VPN based solely on its hostname; the operating system determines routing. Keep the explanation that the Tor setting applies to Electrum traffic.

## 3. Add explicit trust for private TLS

For StartOS, support importing the node's root CA from its trusted dashboard and associate it with the saved node connection. Use ordinary certificate-chain and hostname verification with that authority. A changed authority or invalid certificate must produce an actionable trust error. Persist trust and endpoint settings together through the existing atomic save path.

StartOS issues local certificates under its own authority; a public domain can instead use an ACME certificate. Trusting the root supports normal leaf-certificate renewal. [StartOS wallet certificate guidance](https://docs.start9.com/bitcoin-guides/1.0.x/connecting-wallets.html#making-your-wallet-trust-the-certificate).

Do not assume browser or macOS Keychain trust automatically reaches the packaged Node TLS client. Test the actual packaged runtime. Avoid a global “ignore certificate errors” option. For other self-hosted servers, a later fingerprint-pinning option can support an explicit first-use verification flow if CA import is insufficient.

Handle existing private TLS connections with a visible trust-setup step when needed. Keep StartOS's internal service transport working; the desktop trust change must not require a new StartOS dependency, manifest ID, or volume migration. Retain explicit plain TCP support for servers configured that way, but require TLS for the public-internet setup path.

## 4. Make testing explain the wait

Measure hostname resolution, socket connection, TLS negotiation, Tor bootstrap when applicable, and Electrum response time separately. Test protocol negotiation, the expected Bitcoin network, and a tip query before reporting that the connection is usable. A returned tip height alone must not be presented as proof of full synchronization.

Distinguish an unreachable node, incorrect port/protocol, certificate problem, Tor startup failure, and an Electrum request timeout. Testing must not replace the active connection or save settings. Saving must continue to preserve the old connection on failure.

Compare LAN and Tor against the same Electrs node and the same controlled watch-only fixture. Record cold startup, first account discovery, warm refresh, and history loading separately, with repeated measurements and request counts. Log timings/counts only, excluding descriptors, addresses, scripthashes, credentials, and full responses.

If repeated scanning dominates, follow with durable discovery progress and bounded request reuse/concurrency. Preserve gap-limit discovery, newly used addresses, reorg handling, and cache isolation between accounts, networks, and servers. Do not merely increase timeouts or request concurrency without measurements.

## 5. Complete remote access and route switching

Document private remote access through an existing VPN first. An own public endpoint can use the same direct client, with verified TLS and the server's actual external port. StartOS public-domain hosting requires gateway/DNS configuration and inbound reachability; a CGNAT connection needs an alternative gateway such as StartTunnel. [StartOS clearnet setup](https://docs.start9.com/start-os/0.4.0.x/clearnet.html).

The application should connect to an endpoint the user configured, without managing router port forwarding or exposing Bitcoin Core RPC. A public TLS endpoint still makes the Electrum service publicly reachable; TLS does not provide client access control.

Start with one active saved connection to limit migration complexity. Add named LAN/remote/Tor profiles after the single-connection workflow is reliable. Switching stays explicit. If automatic switching is considered later, require a user-defined policy before any alternate route or server receives wallet queries.

## Acceptance and delivery

1. Test address parsing, visible route selection, certificate trust, and rollback with focused unit/API tests and controlled TCP/TLS servers. Include untrusted/wrong-host/expired certificates and renewal under the same trusted CA.
2. Verify a packaged Mac build against the user's Electrs LAN endpoint, then restart and sleep/wake. Compare account totals and histories with the same fixture over Tor.
3. Exercise VPN access and a controlled public TLS endpoint, unreachable servers, interrupted tests/saves, and loss of the active route. Confirm that no alternate server or route receives queries automatically.
4. Check fresh-profile setup and migration of saved public, private, and Tor configurations. Confirm that the shared StartOS internal connection path still passes its checks. Repeat native connection/trust smoke tests on Windows before release.

The first implementation should deliver the LAN setup, explicit TLS trust, and useful connection timing together. It is complete when a user can copy their node's actual address, establish trust, test, save, restart, and load consistent wallet data without hidden route changes. Performance targets should be set from the measured baseline; direct access alone is not evidence that Tor's application-side bottlenecks are fixed.
