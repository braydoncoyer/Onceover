#!/usr/bin/env node
// Runs the built CLI, or the TypeScript source straight from a checkout.
import { existsSync } from 'node:fs';

const built = new URL('../dist/node/cli.js', import.meta.url);
const { run } = await import(existsSync(built) ? built.href : new URL('../src/cli.ts', import.meta.url).href);
run();
