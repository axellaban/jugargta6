#!/usr/bin/env bash
# Corre la migración y los tests contra un Postgres local descartable.
# Uso: PGURL=postgres://postgres@localhost:5432/postgres supabase/sql-tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
PGURL="${PGURL:-postgres://postgres@localhost:5432/postgres}"
DB="jugar_test_$$"
psql "$PGURL" -qc "create database $DB" >/dev/null
trap 'psql "$PGURL" -qc "drop database if exists $DB" >/dev/null' EXIT
TEST_URL="${PGURL%/*}/$DB"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$here/00_supabase_stub.sql"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$here/../migrations/001_init.sql"
# Re-aplicar la migración debe ser seguro (idempotente).
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$here/../migrations/001_init.sql"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$here/01_queue_test.sql"
