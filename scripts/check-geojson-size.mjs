#!/usr/bin/env node
import { stat } from 'fs/promises';
import { spawn } from 'child_process';

const DEFAULT_LIMIT = Number(process.env.CLOUDFLARE_FILE_LIMIT_BYTES) || 25 * 1024 * 1024; // 25 MiB default
const files = process.argv.length > 2 ? process.argv.slice(2) : [
  'public/data/lsoa_boundaries.geojson',
  'public/data/msoa_boundaries.geojson',
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Exit ' + code))));
    p.on('error', reject);
  });
}

(async () => {
  for (const f of files) {
    try {
      const s = await stat(f);
      const size = s.size;
      console.log(`${f}: ${size} bytes`);
      if (size > DEFAULT_LIMIT) {
        console.log(`${f} exceeds ${DEFAULT_LIMIT} bytes — running simplifier...`);
        await run('python', ['scripts/simplify_geojson.py', f]);
      } else {
        console.log(`${f} is within limit`);
      }
    } catch (err) {
      console.warn(`Skipping ${f}: ${err.message}`);
    }
  }
  console.log('GeoJSON size check complete');
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
