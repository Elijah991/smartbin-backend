-- Optional alias for collection time (handshake); keeps last_collection in sync for older clients.
ALTER TABLE bins ADD COLUMN IF NOT EXISTS last_pickup TIMESTAMP NULL;
