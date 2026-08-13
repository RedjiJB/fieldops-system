-- No role/permission distinction has existed on users until now -- any
-- dashboard login could create/edit/deactivate/reset-password any account.
-- Backfills the existing account(s) as admin so nobody gets locked out;
-- new accounts default to 'staff' at the application level (POST /users),
-- not via this column default, which only exists for the backfill.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
