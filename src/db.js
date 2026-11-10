import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env.');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.POOL_MAX || 1), // reuse a connection deliberately in tests
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('Idle database connection error:', error.message);
});
