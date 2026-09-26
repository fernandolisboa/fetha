-- Account buckets were keyed by the email in clear until #64; they are now
-- keyed by its hash, so every row still carrying an address is stale.
DELETE FROM "rate_limits" WHERE "key" LIKE '%@%';
