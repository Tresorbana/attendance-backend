-- Run this as your PostgreSQL superuser to create the attendai database and user.
-- Usage: psql -U postgres -f setup-db.sql

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

SELECT 'CREATE DATABASE attendai OWNER attendai'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'attendai') \gexec

GRANT ALL PRIVILEGES ON DATABASE attendai TO attendai;

\c attendai
GRANT ALL ON SCHEMA public TO attendai;

\echo ''
\echo 'Done! Database "attendai" is ready.'
\echo 'Start the API with: cd attendance-api && npm run start:dev'
