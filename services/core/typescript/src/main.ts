import { startCore } from './server.js';
void startCore().catch(error => { console.error('Core startup failed', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; });
