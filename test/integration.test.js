import 'dotenv/config';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { TENANT_A, TENANT_B, PROJECT_A, PROJECT_B } from '../src/constants.js';

const users = {
  alice: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  charlie: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
};
function token(who) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    subject: users[who], issuer: 'tenant-practice',
    audience: 'tenant-practice-api', algorithm: 'HS256', expiresIn: '1h'
  });
}
let server;
let baseUrl;
before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await pool.end();
});
function request(who, tenant, path = '/projects', { method = 'GET', body } = {}) {
  const headers = {};
  if (who) headers.Authorization = `Bearer ${token(who)}`;
  if (tenant) headers['X-Tenant-ID'] = tenant;
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

test('missing JWT is rejected with 401', async () => {
  const response = await request(null, TENANT_A);
  assert.equal(response.status, 401);
});

test('missing or malformed tenant header is rejected with 400', async () => {
  assert.equal((await request('alice', null)).status, 400);
  assert.equal((await request('alice', 'not-a-uuid')).status, 400);
});

test('Alice can see A but cannot see or select B', async () => {
  const response = await request('alice', TENANT_A);
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.ok(rows.some(row => row.id === PROJECT_A));
  assert.ok(rows.every(row => row.tenant_id === TENANT_A));
  assert.equal((await request('alice', TENANT_B)).status, 403);
});

test('Bob cannot read, update, or delete A project', async () => {
  assert.equal((await request('bob', TENANT_B, `/projects/${PROJECT_A}`)).status, 404);
  assert.equal((await request('bob', TENANT_B, `/projects/${PROJECT_A}`, {
    method: 'PATCH', body: { name: 'Hacked' }
  })).status, 404);
  assert.equal((await request('bob', TENANT_B, `/projects/${PROJECT_A}`, {
    method: 'DELETE'
  })).status, 404);
});

test('A member of two companies can switch with no cross-tenant leakage', async () => {
  for (const [tenant, expected, forbidden] of [
    [TENANT_A, PROJECT_A, PROJECT_B],
    [TENANT_B, PROJECT_B, PROJECT_A],
    [TENANT_A, PROJECT_A, PROJECT_B]
  ]) {
    const res = await request('charlie', tenant);
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(rows.some(row => row.id === expected));
    assert.ok(rows.every(row => row.tenant_id === tenant));
    assert.ok(!rows.some(row => row.id === forbidden));
  }
});

test('injected tenant_id in request body is ignored on INSERT', async () => {
  const created = await request('alice', TENANT_A, '/projects', {
    method: 'POST', body: { name: 'New ABC Task', tenant_id: TENANT_B }
  });
  assert.equal(created.status, 201);
  const row = await created.json();
  assert.equal(row.tenant_id, TENANT_A);
  assert.equal((await request('bob', TENANT_B, `/projects/${row.id}`)).status, 404);
});

test('raw SQL RLS blocks cross-tenant writes and defaults to no rows without context', async () => {
  const client = await pool.connect();
  try {
    // No active tenant context should expose zero projects.
    const none = await client.query('SELECT id FROM public.projects');
    assert.equal(none.rowCount, 0);
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);
    const selected = await client.query('SELECT tenant_id FROM public.projects');
    assert.ok(selected.rowCount > 0);
    assert.ok(selected.rows.every(row => row.tenant_id === TENANT_A));
    await assert.rejects(
      client.query('INSERT INTO public.projects (tenant_id, name) VALUES ($1, $2)', [TENANT_B, 'Wrong company']),
      err => err.code === '42501'
    );
    await client.query('ROLLBACK'); // recover from the intentional policy violation
    const after = await client.query('SELECT id FROM public.projects');
    assert.equal(after.rowCount, 0);
  } finally {
    client.release();
  }
});


test('RLS WITH CHECK prevents changing an A project into a B project', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);
    await assert.rejects(
      client.query('UPDATE public.projects SET tenant_id = $1 WHERE id = $2', [TENANT_B, PROJECT_A]),
      err => err.code === '42501'
    );
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});
