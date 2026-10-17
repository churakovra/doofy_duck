#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=platform_password="$PLATFORM_DB_PASSWORD" \
  --set=economy_password="$ECONOMY_DB_PASSWORD" \
  --set=core_password="$CORE_DB_PASSWORD" <<'SQL'
CREATE ROLE platform LOGIN PASSWORD :'platform_password';
CREATE DATABASE platform OWNER platform;
CREATE DATABASE platform_test OWNER platform;
CREATE ROLE economy LOGIN PASSWORD :'economy_password';
CREATE DATABASE economy OWNER economy;
CREATE DATABASE economy_test OWNER economy;
CREATE ROLE core LOGIN PASSWORD :'core_password';
CREATE DATABASE core OWNER core;
CREATE DATABASE core_test OWNER core;
SQL
