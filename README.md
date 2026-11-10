# Task 12 — Multitenancy & Tenant Isolation (Node.js + PostgreSQL RLS)

A runnable local practice project for shared-database, shared-table multi-tenancy with transaction-scoped tenant settings. **No Kubernetes or frontend required.**

## 1. Goal and expected behavior

The same Node.js API serves multiple businesses. Every project belongs to one tenant. Alice belongs only to Company A, Bob only to Company B, and Charlie belongs to both companies and may switch between them. PostgreSQL RLS ensures tenant-specific reads and writes are restricted even if a project query omits `WHERE tenant_id = ...`.

| Tenant | ID | Project (seeded) |
| --- | --- | --- |
| ABC Technologies | `11111111-1111-4111-8111-111111111111` | ABC Website |
| XYZ Solutions | `22222222-2222-4222-8222-222222222222` | XYZ Dashboard |

| Test identity | Authorized tenants |
| --- | --- |
| alice | A |
| bob | B |
| charlie | A and B |

> Authentication is **simulated for this security practice**: the development-only `scripts/make-token.js` signs JWTs for seeded identities. It is **not** a real login flow. A production system must authenticate users and issue signed tokens from a trusted service, securely manage secrets, and apply proper key rotation.

## 2. Prerequisites (Windows 11 / PowerShell)

- Node.js **20+** (22+ recommended) and npm
- Docker Desktop with a running Docker engine
- A terminal such as PowerShell or VS Code's terminal

Check:

```powershell
node -v
npm -v
docker --version
docker compose version
```

You do not need Kubernetes for this task.

## 3. Project files

```text
nodejs-multitenancy-rls-practice/
  compose.yaml
  .env.example
  .gitignore
  package.json
  db/init/
    01-schema.sql
    02-seed.sql
  src/
    app.js
    server.js
    db.js
    constants.js
    tenant-transaction.js
    middleware/auth.js
    routes/projects.js
  scripts/make-token.js
  test/integration.test.js
  README.md
```

## 4. Start PostgreSQL and install packages

From this folder in **PowerShell**:

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d
docker compose ps
```

Docker starts PostgreSQL 17 on **localhost:5433**. On the **first** startup, it runs the SQL files in `db/init/` and creates tables, roles, policies, and seed rows.

Inspect logs if the database is not ready:

```powershell
docker compose logs db
```

Check tables:

```powershell
docker compose exec db psql -U postgres -d tenant_practice -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
```

Expected tables: `projects`, `tenants`, `user_tenants`, `users`.

## 5. Understand the schema and security

**Shared-table (row-per-tenant) design**: `projects` has a `tenant_id` column. The unique project ID and the tenant ID identify the project and its owner tenant.

The `user_tenants` table is a user-to-tenant membership map and has a composite primary key `(user_id, tenant_id)`. This allows checking whether a user can select a tenant.

There are two separate database roles:

- `tenant_owner`: owns tables, cannot log in; RLS is also forced on the projects table.
- `app_user`: non-superuser, non-owner, **NOBYPASSRLS**; only gets the grants needed for app requests.

The database row policy in `db/init/01-schema.sql`:

```sql
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

CREATE POLICY projects_tenant_isolation ON public.projects
  FOR ALL TO app_user
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

- `USING`: controls which rows are visible or eligible for update/delete.
- `WITH CHECK`: controls which tenant rows may be inserted or produced by an update.
- `current_setting('app.tenant_id', true)`: reads the tenant selected on the **current connection**. A missing or reset setting evaluates to no tenant; RLS denies project rows. `NULLIF(...,'')` accounts for PostgreSQL custom settings sometimes returning an empty string after reset.
- `FORCE ROW LEVEL SECURITY`: requires the owner to be subject to policies too; superusers and `BYPASSRLS` roles still bypass them, so the API must **never** connect as those roles.
- The `app_user` has no `TRUNCATE` permission (RLS does not apply to TRUNCATE).

The index `idx_projects_tenant_id_id (tenant_id, id)` helps queries that filter by tenant and project ID. On large tables, examine real queries with `EXPLAIN (ANALYZE, BUFFERS)` to validate indexing.

Check the current RLS flags:

```powershell
docker compose exec db psql -U postgres -d tenant_practice -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='projects';"
```

Expected flags: `t` and `t`.

View configured policies:

```powershell
docker compose exec db psql -U postgres -d tenant_practice -c "SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='projects';"
```

## 6. Request flow

```text
API request
  -> Verify Authorization: Bearer <signed JWT>
  -> Validate X-Tenant-ID as UUID
  -> Get one connection from the pg pool
  -> BEGIN transaction
  -> Check user_tenants membership for user and tenant
  -> SELECT set_config('app.tenant_id', $1, true)
  -> Execute all project queries through that SAME connection
  -> COMMIT (or ROLLBACK on error)
  -> Release connection back to the pool
```

The HTTP `X-Tenant-ID` header is **not authority**: the membership check is what authorizes access. Each transaction sets its own tenant context, and the setting ends with COMMIT/ROLLBACK. The app's database pool deliberately has `POOL_MAX=1` for tests, so several tenants reuse the same connection, making state-leak failures easier to notice.

**Never** call `pool.query(...)` inside the tenant transaction's callback; use the supplied `client.query(...)` to remain on the same transaction and tenant setting.

## 7. Run tests (automated)

Once PostgreSQL is ready, run:

```powershell
npm test
```

This uses Node's built-in test runner to start an ephemeral HTTP server, send real requests, and inspect RLS behavior against local PostgreSQL. No second terminal is needed for `npm test`.

The test suite checks:

1. Missing JWT returns 401.
2. Missing or invalid tenant UUID returns 400.
3. Alice can view A's projects but selecting B is forbidden (403).
4. Bob cannot read, update, or delete an A project (404; RLS hides it).
5. Charlie can switch A -> B -> A with no mixed project rows.
6. Attempting to send a different `tenant_id` in a POST JSON body does not override the server's tenant setting.
7. A direct SQL query with no tenant setting sees no project rows.
8. A direct SQL INSERT for the wrong tenant fails with PostgreSQL code `42501`.
9. After ROLLBACK, reused connection has no active tenant context.
10. A direct SQL UPDATE cannot move Tenant A’s project into Tenant B (`WITH CHECK` denies it).

If a test fails, inspect Docker logs and confirm `.env` uses port `5433` and the limited `app_user` role.

## 8. Run API and test manually in PowerShell

Start the HTTP server (leave terminal running):

```powershell
npm start
```

Open a **second PowerShell terminal** in the same folder. Generate demonstration JWTs:

```powershell
$aliceToken = (node scripts/make-token.js alice).Trim()
$bobToken = (node scripts/make-token.js bob).Trim()
$charlieToken = (node scripts/make-token.js charlie).Trim()
```

Define the tenants:

```powershell
$tenantA = '11111111-1111-4111-8111-111111111111'
$tenantB = '22222222-2222-4222-8222-222222222222'
$headersA = @{ Authorization = "Bearer $aliceToken"; 'X-Tenant-ID' = $tenantA }
$headersB = @{ Authorization = "Bearer $bobToken"; 'X-Tenant-ID' = $tenantB }
```

Alice's project list:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/projects' -Headers $headersA
```

Bob's project list:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/projects' -Headers $headersB
```

Create a new project for A (the API obtains `tenant_id` from the DB setting):

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/projects' -Method Post -Headers $headersA -ContentType 'application/json' -Body (@{ name = 'ABC New Project' } | ConvertTo-Json)
```

Try Alice's token with B's header — should return **403 Forbidden**:

```powershell
$wrongHeaders = @{ Authorization = "Bearer $aliceToken"; 'X-Tenant-ID' = $tenantB }
Invoke-RestMethod -Uri 'http://localhost:3000/projects' -Headers $wrongHeaders
```

PowerShell throws an HTTP error for the expected 403 response. That is a successful negative test.

Try Bob reading Alice's seeded project — should return **404 Not Found**:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/projects/aaaaaaaa-0000-4000-8000-000000000001' -Headers $headersB
```

Try Charlie using both tenants:

```powershell
$headersCA = @{ Authorization = "Bearer $charlieToken"; 'X-Tenant-ID' = $tenantA }
$headersCB = @{ Authorization = "Bearer $charlieToken"; 'X-Tenant-ID' = $tenantB }
Invoke-RestMethod -Uri 'http://localhost:3000/projects' -Headers $headersCA
Invoke-RestMethod -Uri 'http://localhost:3000/projects' -Headers $headersCB
```

For PATCH and DELETE (use a project ID returned by a previous POST):

```powershell
$projectId = '<YOUR_NEW_PROJECT_UUID>'
Invoke-RestMethod -Uri "http://localhost:3000/projects/$projectId" -Method Patch -Headers $headersA -ContentType 'application/json' -Body (@{ name = 'Renamed ABC Project' } | ConvertTo-Json)
Invoke-RestMethod -Uri "http://localhost:3000/projects/$projectId" -Method Delete -Headers $headersA
```

## 9. Why local settings matter with connection pools

**Unsafe (do not implement):**

```js
await pool.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
const result = await pool.query('SELECT * FROM public.projects');
```

The `false` value sets a **session-scoped** setting that may persist on reused connections; separate calls to `pool.query` may also use different connections. This can cause leakage or incorrect data access.

**Correct** — as implemented in `src/tenant-transaction.js`:

```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // First verify membership, as shown in the full implementation.
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  const result = await client.query('SELECT * FROM public.projects');
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

The actual project code handles rollback failure by discarding the connection rather than reusing an uncertain transaction state.

If a deployment later uses PgBouncer transaction pooling, the same principle is essential: never depend on cross-transaction session state. No PgBouncer installation is required for this practice.

## 10. Row-per-tenant vs schema-per-tenant

| Aspect | One shared table with `tenant_id` (this practice) | Separate schema per tenant |
| --- | --- | --- |
| Data layout | `public.projects` contains all tenants' rows | `tenant_a.projects`, `tenant_b.projects`, etc. |
| Isolation | RLS policy and application authorization | Schema permissions, safe schema selection, application authorization |
| Schema migrations | Usually one migration for shared tables | Coordinated migrations across many schemas |
| Operational overhead | Lower for many small tenants | Higher as tenants grow |
| Useful when | Many tenants share the same structure | Stronger logical namespace separation is useful |

Schema-per-tenant is not automatically secure: permissions and safe schema routing still matter. Do not interpolate user-supplied schema names into SQL; identifiers require an allowlisted mapping and safe quoting. Dedicated databases are a third model, outside this task.

## 11. Threat model (what must be defended)

| Threat | Defense / limit |
| --- | --- |
| User changes `X-Tenant-ID` | Verify membership from authenticated JWT subject in `user_tenants` |
| Query misses `WHERE tenant_id` | PostgreSQL RLS hides other tenants' project rows |
| API inserts for wrong tenant | Database default and `WITH CHECK` policy |
| Connection reused for another tenant | `BEGIN` + transaction-local `set_config(..., true)` + COMMIT/ROLLBACK |
| Application uses privileged DB login | Use `app_user`, never a superuser/owner/BYPASSRLS role |
| User submits SQL syntax | Use bound SQL parameters; never build SQL by concatenating user input |
| Compromised app or SQL injection can run arbitrary SQL | This RLS pattern is defense-in-depth, **not** sufficient by itself: a role able to execute arbitrary SQL can manipulate custom session settings; prevent injection, restrict permissions, and protect credentials |
| User removed from a tenant | Revalidate membership against DB on every tenant transaction (already implemented); in-flight transactions may complete |

> RLS is applied in this practice to `projects`, not to every table. A real SaaS application must inventory **every** tenant-owned table and its joins, background jobs, exports, caches and admin paths. The membership table is application-internal and has only read access for `app_user` in this demo.

## 12. Mistakes to avoid

1. Trusting an unverified tenant header or JWT claim as proof of membership.
2. Using PostgreSQL `postgres`, a table owner with bypass rights, or a `BYPASSRLS` app role.
3. Enabling RLS but forgetting an appropriate SELECT/INSERT/UPDATE/DELETE policy.
4. Writing `SET app.tenant_id = ...` as session state and then reusing pooled connections.
5. Calling `pool.query` in the middle of an operation that is supposed to use one transaction/client.
6. Forgetting to `ROLLBACK` and release or discard a failed client.
7. Accepting `tenant_id` from client JSON for inserts and updates without database enforcement.
8. Applying RLS to reads but overlooking UPDATE/DELETE/INSERT restrictions.
9. Omitting indexes involving `tenant_id` when tenant tables become large.
10. Testing only success cases and never testing cross-tenant attempts or connection reuse.
11. Believing RLS alone prevents an attacker with arbitrary SQL execution from changing `app.tenant_id`.
12. Forgetting that RLS does not cover operations like TRUNCATE; use least-privilege grants.

## 13. Finish checklist

- [ ] Two tenant records and three demo identities exist.
- [ ] Membership validation rejects a valid JWT requesting the wrong tenant.
- [ ] RLS is enabled and forced on `projects`.
- [ ] API runs under the nonprivileged `app_user` DB role.
- [ ] All project operations use one transaction-scoped client.
- [ ] Local tenant context is set using bound parameters and cleaned up at transaction end.
- [ ] SELECT/POST/PATCH/DELETE stay tenant-isolated.
- [ ] Tenant index exists.
- [ ] All `npm test` cases pass.
- [ ] You can explain the threat model and row-per-tenant vs schema-per-tenant tradeoff.

## 14. Clean up local practice

Stop the API with `Ctrl+C`. Stop PostgreSQL without deleting data:

```powershell
docker compose down
```

To **delete all local practice DB data and reinitialize SQL scripts on the next startup**:

```powershell
docker compose down -v
```

`down -v` is destructive; only use it if resetting this practice's data is intended.

## References

- PostgreSQL RLS: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- PostgreSQL settings: https://www.postgresql.org/docs/current/config-setting.html
- node-postgres transactions: https://node-postgres.com/features/transactions
- PgBouncer pool modes: https://www.pgbouncer.org/config
- Kubernetes overview (not needed for this task): https://kubernetes.io/docs/concepts/overview/
