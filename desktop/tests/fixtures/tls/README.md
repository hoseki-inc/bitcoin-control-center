# Synthetic TLS fixtures

These certificates and the server private key were generated solely for local automated tests. They are not credentials for a real service. The CA private key is not included. Do not install this CA in an operating-system trust store.

The server certificate is signed by the test CA and covers `localhost` and `127.0.0.1`. Tests supply the CA as a simulated OS-trusted authority, then exercise real TLS handshakes and hostname validation. The certificates expire in September 2036.
