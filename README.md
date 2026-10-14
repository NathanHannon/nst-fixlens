# FixLens backend

NestJS + PostgreSQL 17, with private DigitalOcean Spaces photos. The seven modules are problems, captures, measurements, reports, diagnosis, storage, and health. The frontend lives separately. All model outputs are explicitly marked mock; no image is analyzed and no model API is called.

## Local development

Use Node.js 24 and Docker with its daemon running:

```sh
npm ci
cp .env.example .env
# PowerShell: Copy-Item .env.example .env
docker compose up -d --wait
npm run migration:run
npm run start:dev
```

Fill in real Spaces credentials before testing uploads. Keep the bucket private. The API signs direct PUT requests, checks object metadata with HEAD, and never receives photo bytes. Use the bucket's origin S3 endpoint, not its CDN endpoint. Spaces supports presigned URLs: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/

For Expo web, configure bucket CORS to allow PUT and Content-Type from your development origin; native uploads do not require browser CORS. The scaffold does not provision a bucket or deploy resources.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| DATABASE_URL | yes | PostgreSQL connection URL; use the managed database's TLS URL in deployment |
| SPACES_ENDPOINT | yes | Origin endpoint, e.g. `https://nyc3.digitaloceanspaces.com` |
| SPACES_KEY | yes | Spaces access key with access to the private bucket |
| SPACES_SECRET | yes | Spaces secret key |
| SPACES_BUCKET | yes | Bucket name |
| PORT | no | Integer 1–65535; defaults to 3000 |

Startup rejects missing variables and invalid URLs/ports with named errors. No credentials are checked into this repository. TLS settings are supplied through DATABASE_URL; certificate verification is not disabled in code. Storage currently derives the signing region from the Spaces origin hostname. Spaces is the selected MVP provider; R2 would need its `auto` region configuration instead.

## API and upload flow

All bodies use snake_case column names. UUID path parameters are validated. Unknown fields are rejected. Responses use entity field names; Postgres numeric columns (`alignment_score`, `confidence`, `days_between`) are strings to preserve precision. Dates serialize as ISO timestamps.

| Method | Route | Body / behavior |
| --- | --- | --- |
| POST | /problems | `title`, optional `category`, `location_note` |
| GET | /problems | All demo-owned problems, newest first |
| GET | /problems/:id | Problem plus `latest_report`, `delta_summary` (nullable) |
| POST | /problems/:id/captures/upload-url | No body; generates `capture_id`, `photo_key`, PUT URL, headers, five-minute expiry |
| POST | /problems/:id/captures | Register an uploaded photo (see below) |
| GET | /problems/:id/deltas | Read-only consecutive measured-capture deltas, newest first |
| POST | /problems/:id/diagnose | `capture_id`, optional `hazards`, `context` |
| GET | /health | Database readiness; 503 if unavailable |

1. Create a problem: `POST /problems` with `{"title":"Basement wall crack","category":"crack"}`.
2. Call `/problems/<id>/captures/upload-url`. Upload the JPEG directly to the returned URL using PUT and the returned headers. The API chooses `captures/<problem_id>/<capture_id>.jpg`.
3. Register with `/problems/<id>/captures`:

```json
{
  "photo_key": "captures/<problem_id>/<capture_id>.jpg",
  "photo_width_px": 1600,
  "photo_height_px": 1200,
  "is_baseline": true,
  "taken_at": "2026-10-13T12:00:00Z"
}
```

Dimensions are `photo_width_px` and `photo_height_px`, matching schema.sql. They are optional positive integers. Re-captures can include `alignment_score` (0–1, up to three decimal places) and `alignment_meta` (JSON object). Baselines reject alignment data. Registration checks the key belongs to the problem and that a nonempty image/jpeg object exists. JPEG bytes/dimensions are not independently decoded. The DB permits at most one baseline per problem; duplicate captures or baselines return 409. An unused upload remains in storage; use a bucket lifecycle policy for cleanup if needed.

4. Diagnose: `{"capture_id":"<capture_id>","hazards":["gas"]}`. Hazard values are `gas`, `electrical_panel`, `structural_distress`, `asbestos`, and `flooding_near_electrics`.

The diagnosis provider is a constructor-injected interface token with a mock implementation. The mock produces plausible demo-shaped records, fixed pixel measurements, null mask/reference scale, and explicit mock version strings. With no reference scale, millimeter dimensions remain null and growth is unknown. A pure SafetyGate function examines explicit hazards and conservative keywords in problem/request/provider evidence; every detected safety hazard forces `safety_override=true`, `urgency=pro_now`, and `diy=null`. It does not classify image content. Keywords can conservatively over-trigger (including negated statements).

Diagnosis locks the owned problem and creates a measurement plus report in one transaction. A capture is measured once; concurrent/repeated diagnosis returns 409 for the loser. A failed report insert rolls back the measurement. Cached urgency updates only when diagnosing the most recent capture. The latest report in problem detail is ordered by report creation time. Measurement/report write APIs are intentionally limited to this orchestration endpoint; the requested problem routes are create/read only.

Errors consistently use:

```json
{"error":{"status":400,"message":["title must be longer than or equal to 1 characters"],"path":"/problems"}}
```

`message` is a string for ordinary errors or an array for DTO validation. Unexpected errors are logged on the server and return a generic 500 message.

## Schema and migrations

The copied `schema.sql` is the source of truth. Do not run it in addition to the initial migration. `synchronize` is always false.

```sh
npm run migration:run
npm run schema:check
# Dedicated development databases only; reverting deletes the initial tables/data:
npm run migration:revert
# Generate a future candidate against the current database:
npm run migration:generate -- src/database/migrations/DescribeChange
```

TypeORM generates migrations by comparing entities with a running database: https://typeorm.io/docs/migrations/generating/

The initial migration was generated against an empty PostgreSQL 17 database and reviewed against schema.sql. The raw generation is preserved in `migration-generation/EntityBaseline.ts.txt`; only the reviewed initial migration is registered for execution. Corrections: deduplicate CREATE/DROP of shared enums, use the runtime database name in generated-column metadata, append the SQL trigger/function and demo seed, and drop shared enums after consuming tables. Constraint names, indexes, foreign keys, defaults, enum values, nullable fields, generated area expression, and the view query follow the SQL. TypeORM additionally maintains `migrations` and `typeorm_metadata` bookkeeping tables (not domain model changes). The PostgreSQL 17 integration test verifies no entity drift after the reviewed migration.

Preserved SQL limitations: equal capture timestamps have no view tie-breaker; delta rows consider measured captures only; a zero previous area can yield null percentage but `stable` in the view. The baseline partial index ensures at most one baseline, not that a baseline must exist. These behaviors were retained rather than silently changing the source schema.

If the database already contains schema.sql tables, do not run the initial migration again. Use TypeORM's `migration:run --fake` only after confirming the existing schema, trigger, and seed match, and add TypeORM view/generated-column metadata before generating future migrations (the raw SQL does not include that bookkeeping).

## DigitalOcean database permissions

If `schema.sql` was applied as `doadmin`, run [sql/grant-fixlensdb.sql](sql/grant-fixlensdb.sql) once as `doadmin`, connected to that same database. Create the `fixlensdb` database user in DigitalOcean first. In a SQL editor, paste the entire script; with psql:

```sh
psql "<doadmin connection URL>" -v ON_ERROR_STOP=1 -f sql/grant-fixlensdb.sql
```

The script grants database CONNECT, schema USAGE, read access to the demo user and delta view, and read/write access to the four business tables. It also grants enum/function and sequence permissions, plus defaults for future tables/sequences/types created by `doadmin`. It is transactional and safe to rerun. It adds grants without revoking preexisting permissions, and keeps table ownership with `doadmin`; it does not change the source data model. New objects created by a different migration role need grants for that role as well.

Use the `fixlensdb` connection URL for the API's `DATABASE_URL`. Run migration/release jobs with the `doadmin` connection URL as their `DATABASE_URL`: table access grants do not authorize ALTER/DROP of admin-owned objects. The ownership-transfer comments in `schema.sql` are an alternative for making `fixlensdb` the migration owner, not a required step for the runtime grants here.

To verify, connect as `fixlensdb` and run:

```sql
SELECT current_user;
SELECT id, clerk_id FROM public.users;
SELECT * FROM public.capture_deltas LIMIT 1;
SELECT has_table_privilege(current_user, 'public.problems', 'INSERT') AS can_create_problems,
       has_table_privilege(current_user, 'public.problems', 'UPDATE') AS can_update_problems;
```

DigitalOcean documents this owner-to-runtime grant arrangement in its [PostgreSQL permissions guide](https://docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/).

## Demo user and future authentication

`DemoUserGuard` injects `{id: '00000000-0000-0000-0000-000000000001'}` on every request. The migration seeds this row with `clerk_id='demo'`; the Clerk-shaped column remains solely because it exists in the SQL. There is no login, Clerk SDK, user management, or caller-controlled user ID. Services enforce ownership with the injected identity. A future auth guard can replace the APP_GUARD binding while preserving `CurrentUser` and business services. Anyone reaching the MVP API acts as the same demo user.

## Verification

```sh
npm run build
npm run lint
npm test
# Use a dedicated EMPTY database; the test applies and reverts the initial migration:
TEST_DATABASE_URL=postgresql://fixlens:fixlens@localhost:5432/fixlens_test npm run test:e2e
# PowerShell: $env:TEST_DATABASE_URL='postgresql://.../fixlens_test'; npm run test:e2e
```

Unit tests cover all safety hazards, text/provider signals, pure-function immutability, and environment validation. Integration tests use PostgreSQL and override only storage/model providers; they cover DTO errors, ownership, direct upload registration, baseline uniqueness, transaction rollback, concurrency, generated area, deltas, and migration metadata. Spaces signing is checked separately without uploading bytes; live bucket credentials are needed to verify real PUT/HEAD access.

## DigitalOcean App Platform

Use `nst-fixlens` as the component source directory and the included Dockerfile (Node.js 24). Set the environment variables above, attach the managed PostgreSQL 17 connection URL, and route HTTP to PORT (default 3000). Configure `/health` as the health-check route. Run migrations once as a pre-deploy job/release step using the same image: `node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js`. Do not run migrations independently on every replica. The API binds to `0.0.0.0` and supports graceful shutdown. Infrastructure controls connection pooling; this project adds no pool tuning.
