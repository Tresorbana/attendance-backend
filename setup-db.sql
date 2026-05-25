-- ============================================================
-- SAMS — Staff Attendance Management System
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
-- all tables on first startup. The tables created are:
--
--   people       — enrolled employees with face descriptors
--   attendance   — check-in / check-out records
--   holidays     — public holidays (confirmed + tentative)
--   stations     — office branches with portal credentials
--
-- After first startup, seed demo data:
--   POST /api/stations/seed-demo   → creates 3 demo stations
--   POST /api/holidays/seed/2026   → seeds public holidays
-- ============================================================

\echo ''
\echo 'Done! Database "attendai" is ready.'
\echo ''
\echo 'Next steps:'
\echo '  1. cd attendance-api && npm run build && pm2 restart my-backend'
\echo '  2. POST /api/stations/seed-demo  (creates demo station logins)'
\echo '  3. POST /api/holidays/seed/2026  (seeds public holidays)'
\echo ''
\echo 'Demo station portal credentials (after seed-demo):'
\echo '  Nairobi HQ     → nairobi_admin  / Nairobi@2026'
\echo '  Mombasa Branch → mombasa_admin  / Mombasa@2026'
\echo '  Kisumu Office  → kisumu_admin   / Kisumu@2026'
\echo ''
\echo 'Station portal URL: /station-portal'
