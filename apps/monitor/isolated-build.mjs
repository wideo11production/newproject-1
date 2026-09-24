#!/usr/bin/env node
/**
 * Isolated build script for monitor app
 * Copies only monitor app files to a temp directory and runs next build there
 * to prevent monorepo page discovery leaks from sibling apps.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONITOR_ROOT = path.resolve(__dirname);
const TEMP_ROOT = path.resolve(__dirname, '.tmp-build');

const COPY_FILES = [
  'package.json',
  'tsconfig.json',
  'next.config.mjs',
  'tailwind.config.ts',
  'postcss.config.js',
  '.npmrc',
];

const COPY_DIRS = [
  'src',
  'public',
];

function cleanTemp() {
  if (fs.existsSync(TEMP_ROOT)) {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
}

function copyFiles() {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  
  for (const file of COPY_FILES) {
    const src = path.join(MONITOR_ROOT, file);
    const dest = path.join(TEMP_ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[ISOLATED_BUILD] Copied ${file}`);
    }
  }
  
  for (const dir of COPY_DIRS) {
    const src = path.join(MONITOR_ROOT, dir);
    const dest = path.join(TEMP_ROOT, dir);
    if (fs.existsSync(src)) {
      copyDirRecursive(src, dest);
      console.log(`[ISOLATED_BUILD] Copied directory ${dir}`);
    }
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // Skip @slot directory (renamed to @slot.bak) and other unwanted dirs
    if (entry.name.startsWith('@slot')) {
      console.log(`[ISOLATED_BUILD] Skipping ${entry.name}`);
      continue;
    }
    
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function runBuild() {
  console.log('[ISOLATED_BUILD] Running next build in isolated directory...');
  
  const result = spawnSync('pnpm', ['run', 'build'], {
    cwd: TEMP_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    shell: true,
  });
  
  return result.status;
}

function copyOutput() {
  const srcNext = path.join(TEMP_ROOT, '.next-monitor');
  const destNext = path.join(MONITOR_ROOT, '.next');
  
  if (fs.existsSync(destNext)) {
    fs.rmSync(destNext, { recursive: true, force: true });
  }
  
  if (fs.existsSync(srcNext)) {
    fs.cpSync(srcNext, destNext, { recursive: true });
    console.log('[ISOLATED_BUILD] Copied .next-monitor output back to monitor app .next');
  } else {
    console.error('[ISOLATED_BUILD] ERROR: Build output not found at', srcNext);
  }
}

function main() {
  console.log('[ISOLATED_BUILD] Starting isolated build for monitor app...');
  console.log('[ISOLATED_BUILD] Monitor root:', MONITOR_ROOT);
  console.log('[ISOLATED_BUILD] Temp root:', TEMP_ROOT);
  
  try {
    cleanTemp();
    copyFiles();
    const exitCode = runBuild();
    
    if (exitCode === 0) {
      copyOutput();
      console.log('[ISOLATED_BUILD] Build succeeded!');
      process.exit(0);
    } else {
      console.error('[ISOLATED_BUILD] Build failed with exit code:', exitCode);
      process.exit(exitCode);
    }
  } catch (error) {
    console.error('[ISOLATED_BUILD] Error:', error);
    process.exit(1);
  } finally {
    cleanTemp();
  }
}

main();