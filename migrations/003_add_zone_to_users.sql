ALTER TABLE users ADD COLUMN IF NOT EXISTS zone VARCHAR(120);

-- Legacy installs may have stored the assigned area label in `phone` while real phone numbers
-- typically start with '+'. Copy plausible zone labels into `zone` once.
UPDATE users
SET zone = TRIM(phone)
WHERE role = 'collector'
  AND (zone IS NULL OR TRIM(COALESCE(zone, '')) = '')
  AND phone IS NOT NULL
  AND TRIM(phone) <> ''
  AND LEFT(TRIM(phone), 1) <> '+';
