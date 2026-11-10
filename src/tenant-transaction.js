import { pool } from './db.js';

// Every tenant-specific DB query must use the client passed to `work`.
export async function withTenantTransaction(userId, tenantId, work) {
  const client = await pool.connect();
  let mustDiscardConnection = false;
  try {
    await client.query('BEGIN');

    // The header is a selection, not a permission: membership is checked in DB.
    const membership = await client.query(
      'SELECT 1 FROM public.user_tenants WHERE user_id = $1 AND tenant_id = $2',
      [userId, tenantId]
    );
    if (membership.rowCount === 0) {
      const error = new Error('You do not have access to this tenant');
      error.status = 403;
      throw error;
    }

    // true = LOCAL to this transaction, automatically reset at its end.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Do not reuse a connection if rollback/cleanup failed.
      mustDiscardConnection = true;
    }
    throw error;
  } finally {
    client.release(mustDiscardConnection ? new Error('Transaction cleanup failed') : undefined);
  }
}
