#!/usr/bin/env node
/**
 * download-tiles.mjs
 *
 * Downloads the Protomaps basemap vector tiles for Great Britain and saves them
 * as public/tiles/uk.pmtiles — a single-file PMTiles archive that the map app
 * reads directly with HTTP range-requests (no tile server needed).
 *
 * Data source: Protomaps daily builds from OpenStreetMap (ODbL licence).
 * https://docs.protomaps.com/basemaps/downloads
 *
 * Usage:
 *   npm run download-tiles
 *
 * Requirements:
 *   - The pmtiles CLI binary  (auto-downloaded by this script)
 *   - ~300 MB free disk space
 *   - A stable internet connection (the script makes range-requests to a ~130 GB
 *     planet file but only fetches the bytes covering the UK bounding box)
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { createGunzip } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const TILES_DIR = join(ROOT, 'public', 'tiles');
const OUT_FILE  = join(TILES_DIR, 'uk.pmtiles');

// Great Britain + Northern Ireland + Republic of Ireland bounding box
const UK_BBOX = '-10.6,49.8,1.8,60.9';

// ── Locate or download the pmtiles CLI ───────────────────────────────────────
const IS_WIN   = process.platform === 'win32';
const CLI_NAME = IS_WIN ? 'pmtiles.exe' : 'pmtiles';
const CLI_PATH = join(__dirname, CLI_NAME);

const PMTILES_VERSION = '1.22.0';

function cliDownloadUrl() {
  const os   = IS_WIN ? 'Windows' : process.platform === 'darwin' ? 'Darwin' : 'Linux';
  const arch = process.arch === 'x64'   ? 'x86_64'
             : process.arch === 'arm64' ? 'arm64'
             : 'x86_64';
  const ext  = IS_WIN ? 'zip' : 'tar.gz';
  return (
    `https://github.com/protomaps/go-pmtiles/releases/download/` +
    `v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_${os}_${arch}.${ext}`
  );
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} fetching ${u}`));
        }
        const out = createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => { out.close(); resolve(); });
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function ensureCli() {
  if (existsSync(CLI_PATH)) return CLI_PATH;

  console.log(`\nDownloading pmtiles CLI v${PMTILES_VERSION}...`);
  const url      = cliDownloadUrl();
  const archExt  = IS_WIN ? '.zip' : '.tar.gz';
  const archPath = join(__dirname, `pmtiles_tmp${archExt}`);

  await downloadFile(url, archPath);

  console.log('Extracting...');
  if (IS_WIN) {
    execSync(`powershell -Command "Expand-Archive -Path '${archPath}' -DestinationPath '${__dirname}' -Force"`);
  } else {
    execSync(`tar -xzf "${archPath}" -C "${__dirname}" pmtiles`);
    chmodSync(CLI_PATH, 0o755);
  }

  // Clean up archive
  try { execSync(IS_WIN ? `del "${archPath}"` : `rm -f "${archPath}"`); } catch (_) { /* ignore */ }

  if (!existsSync(CLI_PATH)) {
    throw new Error(
      `pmtiles binary not found at ${CLI_PATH} after extraction.\n` +
      `Please download it manually from:\n  https://github.com/protomaps/go-pmtiles/releases\n` +
      `and place the binary at: ${CLI_PATH}`
    );
  }
  return CLI_PATH;
}

// ── Resolve the latest Protomaps build ───────────────────────────────────────
async function latestBuildUrl() {
  // The authoritative build list is at build-metadata.protomaps.dev/builds.json
  // Each entry has { key: "20260405.pmtiles", ... }.
  // Actual files are hosted at https://build.protomaps.com/<key>
  return new Promise((resolve, reject) => {
    https.get('https://build-metadata.protomaps.dev/builds.json', (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          const builds = JSON.parse(body);
          // Sort descending by key (ISO date string) and pick the newest
          const sorted = builds.slice().sort((a, b) => (a.key < b.key ? 1 : -1));
          const latest = sorted[0];
          if (!latest) throw new Error('Empty builds list');
          resolve(`https://build.protomaps.com/${latest.key}`);
        } catch (e) {
          reject(new Error(`Failed to parse builds JSON: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (existsSync(OUT_FILE)) {
    console.log(`\n✓ Tile file already exists: ${OUT_FILE}`);
    console.log('  Delete it and re-run to refresh.\n');
    process.exit(0);
  }

  mkdirSync(TILES_DIR, { recursive: true });

  const cli       = await ensureCli();
  const sourceUrl = await latestBuildUrl();

  console.log(`\nSource : ${sourceUrl}`);
  console.log(`Output : ${OUT_FILE}`);
  console.log(`BBox   : ${UK_BBOX}`);
  console.log('\nExtracting UK tiles (this downloads only the UK portion via range-requests)…');
  console.log('Estimated download: ~100–300 MB. This may take a few minutes.\n');

  execFileSync(
    cli,
    ['extract', sourceUrl, OUT_FILE, `--bbox=${UK_BBOX}`],
    { stdio: 'inherit' },
  );

  console.log(`\n✓ UK tiles saved to ${OUT_FILE}`);
  console.log('  Restart the dev server and reload the page.\n');
})().catch((err) => {
  console.error('\n✗ download-tiles failed:', err.message);
  process.exit(1);
});
