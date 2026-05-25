-- ============================================================
-- SAMS — Staff Attendance Management System
-- Indongozi SACCO Nyamasheke
-- Database setup script
-- Run as PostgreSQL superuser:
--   psql -U postgres -f setup-db.sql
-- ============================================================

-- 1. Create user if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'attendai') THEN
    CREATE USER attendai WITH PASSWORD 'attendai_secret';
    RAISE NOTICE 'User "attendai" created.';
  ELSE
    RAISE NOTICE 'User "attendai" already exists.';
  END IF;
END
$$;

-- 2. Create database if not exists
SELECT 'CREATE DATABASE attendai OWNER attendai'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'attendai') \gexec

GRANT ALL PRIVILEGES ON DATABASE attendai TO attendai;

\c attendai
GRANT ALL ON SCHEMA public TO attendai;

-- ============================================================
-- NOTE: TypeORM with DB_SYNCHRONIZE=true will auto-create
-- all tables on first startup. Tables created:
--
--   people       — enrolled employees with face descriptors
--   attendance   — check-in / check-out records
--   holidays     — Rwanda public holidays (confirmed + tentative)
--   stations     — Indongozi SACCO branches with portal credentials
--
-- After first startup, seed data:
--   POST /api/stations/seed-demo   → creates HQ + 15 branches
--   POST /api/holidays/seed/2026   → seeds Rwanda public holidays
-- ============================================================

\echo ''
\echo 'Done! Database "attendai" is ready.'
\echo ''
\echo 'Next steps on the server:'
\echo '  1. cd attendance-api && npm run build && pm2 restart my-backend'
\echo '  2. POST /api/stations/seed-demo  (creates all 16 Indongozi SACCO branches)'
\echo '  3. POST /api/holidays/seed/2026  (seeds Rwanda public holidays)'
\echo ''
\echo 'Branch portal credentials follow the pattern:'
\echo '  Username: <code>_admin   e.g. hq_admin, bsk_admin, bsg_admin ...'
\echo '  Password: Indongozi@<CODE>  e.g. Indongozi@HQ, Indongozi@BSK ...'
\echo ''
