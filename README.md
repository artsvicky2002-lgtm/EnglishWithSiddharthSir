# EnglishWithSiddharthSir V8

V8 prepares the project for production cloud deployment.

Included:
- All V7 features
- PostgreSQL production schema (`migrate-postgres.sql`)
- `pg` dependency
- Render deployment guide
- Health endpoint: `/api/health`
- Environment-based configuration
- SQLite remains available for local development

IMPORTANT:
The current application code intentionally uses SQLite when DATABASE_URL is absent. The included PostgreSQL schema and deployment guide are the migration foundation; do not enable DATABASE_URL until the API adapter migration is completed.

Local:
npm install
npm start
http://localhost:3000

Production environment:
DATABASE_URL
NODE_ENV=production
ADMIN_USER
ADMIN_PASSWORD
SESSION_SECRET
