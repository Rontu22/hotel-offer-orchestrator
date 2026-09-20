import { start } from './server.js';

start().catch((cause) => {
  console.error('Supplier failed to start', cause);
  process.exit(1);
});
