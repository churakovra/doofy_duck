import pg from 'pg';
import { migrate } from './migrations.js';

const url = process.env.CORE_DATABASE_URL;
if (!url) throw Error('CORE_DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
try { await migrate(pool); console.log('Core database migrations applied'); }
finally { await pool.end(); }
