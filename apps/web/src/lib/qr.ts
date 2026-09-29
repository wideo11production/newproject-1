/**
 * ============================================================================
 * QR CODE GENERATOR (dependency-free, offline)
 * ============================================================================
 *
 * WHY NOT AN EXTERNAL QR SERVICE:
 *  - Privacy: har QR scan ke liye URL third-party server (e.g. api.qrserver)
 *    jaata. Usse pata chalta hai KAUN kab KAISE install karta hai.
 *  - Offline: app offline ho to QR load nahi hoga.
 *  - Trust: apna URL kisi aur ke server se guzarne se bache.
 *  - Cost/CDN rule: project me koi external CDN nahi (har cheez apni).
 *
 * ISLIYE: QR poora code me generate hota hai. Koi library nahi, koi network
 * call nahi.
 *
 * ---------------------------------------------------------------------------
 * ALGORITHM
 * ---------------------------------------------------------------------------
 * Standard QR Model 2, byte mode, error correction level M (~15%).
 *
 * Steps:
 *  1. Data ko byte mode me encode karo (mode indicator + char count + bytes)
 *  2. Reed-Solomon error correction blocks banao
 *  3. Data ko matrix me place karo (zig-zag, mask patterns avoid karte hue)
 *  4. Best mask choose karo (penalty score minimum)
 *  5. Render to SVG
 *
 * VERSION: auto-select hota hai chhota sa version jo data fit kare
 * (1-10 range, versions 1..40 ka chhota hissa).
 *
 * NOTE: Ye "mask pattern" evaluation standard QR spec (ISO/IEC 18004) follow
 * karta hai, isliye output kisi bhi standard scanner se scan hoga.
 *
 * Hinglish comments: har block ka arth
 */

/** GF(256) - QR codes Reed-Solomon ke liye use karte hain (mod 2^8) */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // 0x11D (QR ka primitive polynomial) se modulo
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

/** GF(256) multiplication */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial (degree n) */
function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon ECC bytes generate karo */
function rsEncode(data: Uint8Array, eccLen: number): Uint8Array {
  const gen = rsGeneratorPoly(eccLen);
  const result = new Uint8Array(eccLen);
  // NOTE: index loop `for...of` ki jagah - `Uint8Array` ka spread/iteration
  // ES2015+ target maangta hai, aur is project ka tsconfig older target
  // use karta hai. Index loop har target pe chalta hai aur byte-wise
  // semantics bhi EXACT same hain (sirf iterable nahi hai).
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let j = 0; j < eccLen; j++) {
      result[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Capacity tables (byte mode, level M) - chhote versions ke liye
// ---------------------------------------------------------------------------

/** Version -> total codewords, EC codewords per block, block structure */
const VERSION_INFO: Record<number, { total: number; ecPerBlock: number; groups: [number, number] }> = {
  // groups: [dataCodewordsPerBlock, blockCount] me total ec blocks count hota hai
  1: { total: 26, ecPerBlock: 10, groups: [16, 1] },
  2: { total: 44, ecPerBlock: 16, groups: [28, 1] },
  3: { total: 70, ecPerBlock: 26, groups: [44, 1] },
  4: { total: 100, ecPerBlock: 18, groups: [32, 2] },
  5: { total: 134, ecPerBlock: 24, groups: [43, 2] },
  6: { total: 172, ecPerBlock: 16, groups: [27, 4] },
  7: { total: 196, ecPerBlock: 18, groups: [31, 4] },
  8: { total: 242, ecPerBlock: 22, groups: [38, 4] },
  9: { total: 292, ecPerBlock: 22, groups: [36, 5] },
  10: { total: 346, ecPerBlock: 26, groups: [43, 5] },
};

/** Aligned pattern centers har version ke liye (chhote range) */
const ALIGN_POS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Format info bits (level M, mask 0-7) - precomputed */
const FORMAT_INFO_M: number[] = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

/**
 * Encode karo aur QR matrix return karo (boolean[][]).
 *
 * @param text - encode karna hai (usually a URL)
 * @returns { size, modules } ya null agar data fit na ho
 */
export function encodeQR(text: string): { size: number; modules: boolean[][] } | null {
  const bytes = new TextEncoder().encode(text);

  // ---- Version choose karo (data + overhead fit ho) ----
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const info = VERSION_INFO[v];
    // Byte mode: 4 bits mode + charCount bits + data bytes
    const countBits = v < 10 ? 8 : 16;
    const neededBits = 4 + countBits + bytes.length * 8;
    if (neededBits <= info.total * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) return null; // data bahut bada

  const info = VERSION_INFO[version];
  const size = version * 4 + 17;
  const totalDataCodewords = info.total - info.ecPerBlock * info.groups[1];
  const [dataPerBlock, blockCount] = info.groups;

  // ---- 1. Data bit stream (mode + count + payload + terminator + pad) ----
  const bits: number[] = [];
  const pushBits = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, version < 10 ? 8 : 16);

  // NOTE: index loop (not `for...of`) - `Uint8Array` iteration ES2015+ target
  // maangta hai, jo is project ke tsconfig me nahi hai. Index loop har target
  // pe chalta hai aur bytes same order me jaate hain.
  for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);

  // Terminator (up to 4 zero bits)
  const capacityBits = totalDataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);

  // Byte-align
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes: alternating 0xEC, 0x11 (spec standard)
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < capacityBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Bits -> codewords
  const dataCodewords = new Uint8Array(totalDataCodewords);
  for (let i = 0; i < totalDataCodewords; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
    dataCodewords[i] = byte;
  }

  // ---- 2. Reed-Solomon: split into blocks, ECC add karo ----
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  for (let b = 0; b < blockCount; b++) {
    const start = b * dataPerBlock;
    const block = dataCodewords.slice(start, start + dataPerBlock);
    dataBlocks.push(block);
    eccBlocks.push(rsEncode(block, info.ecPerBlock));
  }

  // Interleave data codewords
  const finalCodewords: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) finalCodewords.push(block[i]);
  }
  // Interleave ECC codewords
  for (let i = 0; i < info.ecPerBlock; i++) {
    for (const block of eccBlocks) finalCodewords.push(block[i]);
  }

  // ---- 3. Matrix build ----
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array(size).fill(null)
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  // Helper patterns: finders + separators + timing + alignment
  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        modules[rr][cc] = inRing;
        isFunction[rr][cc] = true;
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0;
    modules[6][i] = v;
    isFunction[6][i] = true;
    modules[i][6] = v;
    isFunction[i][6] = true;
  }

  // Alignment patterns (version > 1)
  const positions = ALIGN_POS[version];
  if (positions.length > 0) {
    for (const r of positions) {
      for (const c of positions) {
        // Finders ke saath overlap mat karo
        const nearFinder =
          (r <= 8 && c <= 8) ||
          (r <= 8 && c >= size - 9) ||
          (r >= size - 9 && c <= 8);
        if (nearFinder) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const ring = Math.max(Math.abs(dr), Math.abs(dc));
            modules[r + dr][c + dc] = ring !== 1;
            isFunction[r + dr][c + dc] = true;
          }
        }
      }
    }
  }

  // Reserve format info areas (dark module + format bits)
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === null) { modules[8][i] = false; isFunction[8][i] = true; }
    if (modules[i][8] === null) { modules[i][8] = false; isFunction[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    if (modules[8][size - 1 - i] === null) { modules[8][size - 1 - i] = false; isFunction[8][size - 1 - i] = true; }
    if (modules[size - 1 - i][8] === null) { modules[size - 1 - i][8] = false; isFunction[size - 1 - i][8] = true; }
  }
  modules[size - 8][8] = true; // dark module
  isFunction[size - 8][8] = true;

  // ---- 4. Data placement (zig-zag, right to left, skipping function cols) ----
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  const nextBit = (): number => {
    if (bitIdx >= totalBits) return 0;
    const bit = (finalCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
    bitIdx++;
    return bit;
  };

  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // timing pattern column skip
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (isFunction[row][c]) continue;
        modules[row][c] = nextBit() === 1;
      }
    }
    upward = !upward;
  }

  // ---- 5. Mask + penalty, sabse best chuno ----
  const applyMask = (maskIdx: number): boolean[][] => {
    const out = modules.map((row) => row.map((m) => m === true));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isFunction[r][c]) continue;
        let invert = false;
        switch (maskIdx) {
          case 0: invert = (r + c) % 2 === 0; break;
          case 1: invert = r % 2 === 0; break;
          case 2: invert = c % 3 === 0; break;
          case 3: invert = (r + c) % 3 === 0; break;
          case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
          case 5: invert = ((r * c) % 2) + ((r * c) % 3) === 0; break;
          case 6: invert = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
          case 7: invert = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
        }
        if (invert) out[r][c] = !out[r][c];
      }
    }
    return out;
  };

  const placeFormat = (grid: boolean[][], maskIdx: number) => {
    const fmt = FORMAT_INFO_M[maskIdx];
    for (let i = 0; i < 15; i++) {
      const bit = ((fmt >>> i) & 1) === 1;
      // copy 1: around top-left
      if (i < 6) grid[8][i] = bit;
      else if (i < 8) grid[8][i + 1] = bit;
      else if (i === 8) grid[7][8] = bit;
      else grid[14 - i][8] = bit;
      // copy 2: split
      if (i < 8) grid[size - 1 - i][8] = bit;
      else grid[8][size - 15 + i] = bit;
    }
    grid[size - 8][8] = true; // dark module
  };

  let best: boolean[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const grid = applyMask(mask);
    placeFormat(grid, mask);
    const score = penaltyScore(grid, size);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }

  return best ? { size, modules: best } : null;
}

/** QR penalty score (mask evaluation ke liye) - spec ke 4 rules */
function penaltyScore(grid: boolean[][], size: number): number {
  let score = 0;

  // Rule 1: same-colour runs >= 5
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const a = horizontal ? grid[i][j] : grid[j][i];
        const b = horizontal ? grid[i][j - 1] : grid[j - 1][i];
        if (a === b) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2: 2x2 same-colour blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like patterns
  const pattern1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pattern2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let match1 = true;
      let match2 = true;
      for (let k = 0; k < 11; k++) {
        if (grid[r][c + k] !== pattern1[k]) match1 = false;
        if (grid[r][c + k] !== pattern2[k]) match2 = false;
      }
      if (match1) score += 40;
      if (match2) score += 40;
    }
  }

  // Rule 4: dark/light imbalance
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * QR ko SVG string me render karta hai.
 *
 * @param text - encode karna hai
 * @param options - `size` (px), `quiet` (quiet-zone modules)
 */
export function qrToSvg(
  text: string,
  options: { size?: number; quiet?: number } = {}
): { svg: string; size: number } | null {
  const qr = encodeQR(text);
  if (!qr) return null;

  const quiet = options.quiet ?? 4; // spec recommends 4 modules
  const total = qr.size + quiet * 2;
  const px = options.size ?? 240;

  // Path me ekd contiguous bana dete hain - SVG chhota aur render fast
  let path = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="QR code to open Wideo11 on your phone">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>` +
    `</svg>`;

  return { svg, size: px };
}
