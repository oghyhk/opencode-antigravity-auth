/**
 * Antigravity Proxy — standalone entry point.
 *
 * Run with:  npx tsx src/standalone/main.ts
 * Or after build:  node dist/src/standalone/main.js
 */

import { startProxyServer } from "./server";

startProxyServer();
