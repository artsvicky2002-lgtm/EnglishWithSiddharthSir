# EnglishWithSiddharthSir V8 — Render deployment

## 1. Create PostgreSQL
In Render: New > PostgreSQL.
Copy its Internal Database URL.

## 2. Configure Web Service
Build command:
npm install

Start command:
npm start

## 3. Environment variables
DATABASE_URL=<your Render PostgreSQL Internal Database URL>
NODE_ENV=production
ADMIN_USER=<your admin username>
ADMIN_PASSWORD=<strong unique password>
SESSION_SECRET=<long random secret>

## 4. Database schema
Run `migrate-postgres.sql` against the PostgreSQL database before enabling a production PostgreSQL adapter.

## Important
The bundled V8 server keeps SQLite as the working local-development fallback. The PostgreSQL schema is included for the production migration. Do not put DATABASE_URL into the current server until the PostgreSQL adapter migration is completed.
