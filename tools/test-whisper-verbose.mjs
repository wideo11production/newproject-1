// Direct whisper probe: send a WAV and print the RAW response so we can see
// exactly what the model returns. Run: node tools/test-whisper-direct.mjs <wav>
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
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3',
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audioPath], { stdio: 'ignore' });
}
const audio = fs.readFileSync(audioPath);

function post(url, body, boundary) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
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

async function main() {
  const boundary = '----Wideo11SubtitleBoundary';
  const parts = [];
  parts.push(Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\n`, 'binary'),
    audio,
    Buffer.from('\r\n', 'binary'),
  ]));
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'binary'));
  const body = Buffer.concat(parts);

  const r = await post(`${WHISPER}/v1/audio/transcriptions?response_format=verbose_json&language=en`, body, boundary);
  console.log('STATUS', r.status);
  console.log('BODY', r.body.slice(0, 1200));
}
main().catch(e => { console.error(e); process.exit(2); });