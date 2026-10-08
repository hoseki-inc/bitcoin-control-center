CREATE TABLE btc_quote_cache (
  provider_url TEXT NOT NULL,
  quote_currency TEXT NOT NULL CHECK(quote_currency IN ('USD', 'CAD', 'GBP', 'EUR')),
  timestamp INTEGER NOT NULL,
  price TEXT NOT NULL,
  PRIMARY KEY(quote_currency, timestamp)
);
CREATE TABLE btc_quote_lookups (
  provider TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(provider, requested_at)
);
CREATE INDEX btc_quote_lookup_date ON btc_quote_lookups(requested_at, expires_at);
ALTER TABLE statements ADD COLUMN quote_currency TEXT NOT NULL DEFAULT 'USD'
  CHECK(quote_currency IN ('USD', 'CAD', 'GBP', 'EUR'));
ALTER TABLE statements ADD COLUMN error_message TEXT;
INSERT INTO _migrations (id, name, applied_at) VALUES
  (16, '015_btc_quote_cache', '2026-10-05T00:00:00Z'),
  (17, '016_statement_quote_currency', '2026-10-06T00:00:00Z');
INSERT INTO btc_quote_cache (provider_url, quote_currency, timestamp, price)
  VALUES ('https://example.invalid', 'EUR', 1785542400, '45678.12345');
INSERT INTO btc_quote_lookups (provider, requested_at, expires_at)
  VALUES ('synthetic-provider', 1785542400, 9007199254740991);
UPDATE statements SET quote_currency = 'EUR';
