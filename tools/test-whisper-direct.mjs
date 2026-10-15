// Probe the actual faster-whisper-server endpoint shape and confirm the
// subtitle-service whisper_client.go path works end-to-end.
//
// Run: node tools/test-whisper-direct.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const AUDIO = process.argv[2];
const WHISPER = process.env.WHISPER_URL || 'http://127.0.0.1:8000';

let audioPath = AUDIO;
if (!audioPath) {
  audioPath = path.join(os.tmpdir(), 'wideo11-test-audio.wav');
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3',
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audioPath,
  ], { stdio: 'ignore' });
}

function multipart(fields, files) {
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    let s = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`;
    parts.push(Buffer.concat([Buffer.from(s, 'binary'), Buffer.from(String(value), 'binary'), Buffer.from('\r\n', 'binary')]));
  }
  for (const [name, { filename, data, type }] of Object.entries(files)) {
    let s = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`;
    parts.push(Buffer.concat([Buffer.from(s, 'binary'), data, Buffer.from('\r\n', 'binary')]));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'binary'));
  return { body: Buffer.concat(parts), boundary };
}

function post(url, body, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: 'POST', headers: { 'Content-Type': contentType, 'Content-Length': body.length },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const checks = [];
  const audio = fs.readFileSync(audioPath);

  // 1. /health
  const h = await get(`${WHISPER}/health`);
  checks.push({ name: 'whisper /health', ok: h.status === 200, detail: `${h.status} ${h.body.slice(0, 80)}` });

  // 2. OpenAI-style /v1/audio/transcriptions (this image's real endpoint)
  const { body: b1, boundary } = multipart(
    { language: 'en', response_format: 'json' },
    { file: { filename: 'test.wav', data: audio, type: 'audio/wav' } },
  );
  const r1 = await post(`${WHISPER}/v1/audio/transcriptions`, b1, `multipart/form-data; boundary=${boundary}`);
  let p1 = null;
  try { p1 = JSON.parse(r1.body); } catch { /* not json */ }
  checks.push({
    name: 'POST /v1/audio/transcriptions',
    ok: r1.status === 200 && p1 && (p1.text || (p1.segments && p1.segments.length)),
    detail: `HTTP ${r1.status} text="${(p1?.text ?? '').slice(0, 60)}" segments=${p1?.segments?.length ?? '?'} lang=${p1?.language ?? '?'}`,
  });

  // 3. Legacy /asr path that whisper_client.go currently uses — expect failure
  const { body: b2, boundary: b2b } = multipart(
    { language: 'en' },
    { audio_file: { filename: 'test.wav', data: audio, type: 'audio/wav' } },
  );
  const r2 = await post(`${WHISPER}/asr?task=transcribe&output=json`, b2, `multipart/form-data; boundary=${b2b}`);
  checks.push({
    name: 'POST /asr (legacy path whisper_client.go uses)',
    ok: r2.status !== 200,
    detail: `HTTP ${r2.status} (expected non-200 — this image does not expose /asr) ${r2.body.slice(0, 80)}`,
  });

  const allPass = checks.every(c => c.ok);
  console.log('\n=== Whisper endpoint shape ===');
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    console.log(`       ${c.detail}`);
  }
  console.log(allPass ? '\nRESULT: PASS' : '\nRESULT: FAIL');
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });