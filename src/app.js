import express from 'express';
import { requireAuth, requireTenant } from './middleware/auth.js';
import { projectsRouter } from './routes/projects.js';

export const app = express();
app.use(express.json({ limit: '16kb' }));
app.use('/projects', requireAuth, requireTenant, projectsRouter);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.status === 403) return res.status(403).json({ error: err.message });
  console.error('Request failed:', err.message, err);
  return res.status(500).json({ error: 'Internal server error' || err?.message });
});
