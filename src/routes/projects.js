import { Router } from 'express';
import { withTenantTransaction } from '../tenant-transaction.js';
import { UUID_RE } from '../constants.js';

export const projectsRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const validName = (name) => typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 100;

projectsRouter.get('/', wrap(async (req, res) => {
  const result = await withTenantTransaction(req.userId, req.tenantId, (client) =>
    // Intentionally omit WHERE tenant_id: the DB RLS policy must enforce isolation.
    client.query('SELECT id, tenant_id, name FROM public.projects ORDER BY id')
  );
  res.json(result.rows);
}));

projectsRouter.get('/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid project ID' });
  const result = await withTenantTransaction(req.userId, req.tenantId, (client) =>
    client.query('SELECT id, tenant_id, name FROM public.projects WHERE id = $1', [req.params.id])
  );
  return result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ error: 'Project not found' });
}));

projectsRouter.post('/', wrap(async (req, res) => {
  if (!validName(req.body?.name)) return res.status(400).json({ error: 'Name must be 1–100 characters' });
  const result = await withTenantTransaction(req.userId, req.tenantId, (client) =>
    // tenant_id comes from the transaction-local DB setting, never request JSON.
    client.query('INSERT INTO public.projects (name) VALUES ($1) RETURNING id, tenant_id, name', [req.body.name.trim()])
  );
  return res.status(201).json(result.rows[0]);
}));

projectsRouter.patch('/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid project ID' });
  if (!validName(req.body?.name)) return res.status(400).json({ error: 'Name must be 1–100 characters' });
  const result = await withTenantTransaction(req.userId, req.tenantId, (client) =>
    client.query('UPDATE public.projects SET name = $1 WHERE id = $2 RETURNING id, tenant_id, name',
      [req.body.name.trim(), req.params.id])
  );
  return result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ error: 'Project not found' });
}));

projectsRouter.delete('/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid project ID' });
  const result = await withTenantTransaction(req.userId, req.tenantId, (client) =>
    client.query('DELETE FROM public.projects WHERE id = $1 RETURNING id', [req.params.id])
  );
  return result.rowCount ? res.status(204).end() : res.status(404).json({ error: 'Project not found' });
}));
