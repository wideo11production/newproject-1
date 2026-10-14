/**
 * hex-literal-allowed — design tokens ke bahar kaun sa hex chalega
 *
 * ============================================================================
 * KYUN YE RULE HAI
 * ============================================================================
 *
 * 1559 hardcoded hex 66 files mein mile. Har file ne apna `#16181d`, `#8b949e`,
 * `#ff6500` likha — matlab `design-system.ts` wali file thi jise koi import nahi
 * karta tha, aur "ek palette" ek JANH MANN KA WAADA tha, likha hua nahi.
 *
 * Isiliye ye rule ek ALLOW-LIST enforce karti hai, generic "hex mat likho" nahi.
 * Iske paas ek valid case hai: `design-system.ts` mein token define karna. Baaki
 * har jagah violation hai.
 *
 * ============================================================================
 * KYUN ALLOW-LIST, KYUN BLOCK-LIST NAHI
 * ============================================================================
 *
 * Block-list ke saath do problem:
 *
 *   1. Naya hex sirf ek naya naam hai — list badhelti rehti hai.
 *   2. Rule ka scope poora repo ho to 66 files ek saath fail ho jaati hain, aur
 *      log rule ko disable kar dete hain. Ye pehle bhi hua hai.
 *
 * Allow-list ulta hai: sirf ek file legit hai, baaki 65 galat.
 *
 * ============================================================================
 * FAIL-CLOSED, SILENT PASS NAHI
 * ============================================================================
 *
 * Allow-list load na ho to SAB KUCH violation hota hai — config load fail hone
 * par "sab paas" wala rule exactly woh failure hai jise ye rok raha hai.
 *
 * Isliye try/catch sirf READ ke liye hai, BEHAVIOUR ke liye nahi. Fail hone par
 * default WARN nahi, ERROR hai.
 */

const { readFileSync, existsSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

/** Token file ka path, repo root se. */
const TOKENS_FILE = 'packages/ui/src/design-system.ts';

/**
 * design-system.ts se allow-list padho.
 *
 * File ko TEXT se parse kiya ja raha hai (import se nahi) — import karne se poora
 * module graph load hota hai, aur ek lint rule uske liye bana hi nahi hai.
 *
 * @returns {Set<string>|null} allowed hexes, ya null agar file na mile.
 */
function loadAllowedHexes() {
  try {
    // Rule file: `packages/eslint-config/hex-literal-allowed.js`
    // Repo root usse do level upar hai.
    const here = __dirname;
    const candidates = [
      resolve(here, '..', '..', TOKENS_FILE),
      resolve(here, '..', '..', '..', TOKENS_FILE),
      resolve(process.cwd(), TOKENS_FILE),
      resolve(process.cwd(), 'packages/ui/src/design-system.ts'),
    ];

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;

      const text = readFileSync(candidate, 'utf8');

      // ---- sirf ASLI DECLARATION dhoondho, comment nahi ----
      //
      // Ye ek asli bug tha. `text.indexOf('hexLiteralAllowed')` pehli occurrence
      // deta hai — aur woh JSDoc comment mein hai jo token ko EXPLAIN karta hai
      // (`hexLiteralAllowed ESLint rule ise enforce karta hai`), declaration se
      // pehle.
      //
      // Nateeja: `open` brace comment ke baad wala milta, jo actual object se
      // hazaar characters door hota. Block galat nikalta, keys 0 milti, aur
      // loader `null` return karta — jo fail-closed hai, matlab HAR hex report
      // hota "tokensUnavailable" ke saath. Rule "chal raha" dikhta par galat
      // message deta.
      //
      // Isliye `export const hexLiteralAllowed` dhoondha ja raha hai — wo sirf
      // declaration mein hai.
      const decl = text.indexOf('export const hexLiteralAllowed');
      if (decl < 0) continue;

      const open = text.indexOf('{', decl);
      if (open < 0) continue;

      // Object ko brace-match karke nikaalo — pehla `}` nahi, matching wala.
      let depth = 0;
      let end = -1;
      for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) continue;

      const block = text.slice(open, end);
      const found = new Set();

      // `'#rrggbb': true` — quoted key, sirf 6-digit hex.
      const re = /'(#[0-9a-fA-F]{6})'\s*:/g;
      let m;
      while ((m = re.exec(block)) !== null) {
        found.add(m[1].toLowerCase());
      }

      // KHAALI list bhi VALID hai — matlab "kuch bhi allowed nahi". Ye load
      // failure nahi, ye asli jawab hai.
      //
      // `continue` karne se rule fail-closed path mein chala jaata aur har hex ko
      // `tokensUnavailable` batata — jo GALAT message hai, kyunki token file bilkul
      // theek padhi gayi thi.
      //
      // Ye farq asli hai: `null` matlab "mujhe nahi pata kya allowed hai" (to sab
      // report karo, aur reason bhi wahi bolo), aur `Set()` matlab "kuch bhi
      // allowed nahi" (to sab report karo, par reason `hexLiteral` ho).
      return found;
    }

    // Koi candidate file nahi mili. Fail closed.
    return null;
  } catch {
    // Read fail. Fail closed.
    return null;
  }
}

/** Ek hi baar load — per file nahi. */
const ALLOWED = loadAllowedHexes();

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban hex colour literals in components. Colours come from @wideo11/ui/design-system.',
    },
    schema: [],
    messages: {
      hexLiteral:
        "Hardcoded colour '{{ hex }}'. Design colours live in @wideo11/ui/design-system — " +
        'add a token there and import it instead of inlining the hex.',
      tokensUnavailable:
        'Could not read the design-token allow-list, so every hex is reported. ' +
        'Fix the token file; do not silence this rule.',
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode?.() ?? context.sourceCode;
    const report = context.report.bind(context);

    /**
     * Comment ranges ke andar ke hex SKIP karo.
     *
     * ---- YE KYUN ----
     *
     * `MediaLibraryPane.tsx` ka file-header JSDoc mein design spec likhi hai:
     * `` `#0d0f11` sits under `#16181d` ``. Wo DOCUMENTATION hai — koi className
     * nahi. Rule isse "hardcoded colour" bol raha tha, jo false positive hai.
     *
     * Aur false positive khatarnaak hai: log unhe ignore karna seekh jaate hain,
     * aur asli violations bhi chhoot jaati hain.
     *
     * Isliye: saare comments ki ranges collect karo, aur koi bhi node jo unke
     * andar hai use skip karo.
     */
    let commentRanges = [];
    try {
      commentRanges = (sourceCode.getAllComments?.() ?? []).map((c) => [c.range[0], c.range[1]]);
    } catch {
      // sourceCode na mile to koi comment filtering nahi. Ye degradation hai —
      // aur is case mein rule thoda zyada report karega, kam nahi. Fail-loud.
      commentRanges = [];
    }

    const insideComment = (node) => {
      if (commentRanges.length === 0) return false;
      const start = node.range?.[0];
      const end = node.range?.[1];
      if (start === undefined || end === undefined) return false;
      for (const [cs, ce] of commentRanges) {
        if (start >= cs && end <= ce) return true;
      }
      return false;
    };

    /**
     * Ek string literal ke andar saare hex dhoondho.
     *
     * ---- YE KYUN ZAROORI THA ----
     *
     * Pehla version `node.value === '#rrggbb'` check karta tha. Wo KABHI match
     * nahi karta, kyunki asli code mein hex akela literal nahi hota — wo ek
     * string ke andar hota hai: `className="bg-[#16181d]"`. Poori string
     * `bg-[#16181d]` hai Literal, aur `#16181d` uske andar ka text.
     *
     // Nateeja: rule "chal raha tha", kuch report nahi karta tha — aur wahi
     // silence dangerous hai, kyunki lagta hai enforcement ho raha hai.
     *
     * Isliye ab string ke andar scan hota hai, ek-ek hex ke liye.
     */
    const scan = (node, value) => {
      const HEX_INSIDE_STRING = /#[0-9a-fA-F]{6}\b/g;
      let m;
      while ((m = HEX_INSIDE_STRING.exec(value)) !== null) {
        const hex = m[0].toLowerCase();
        if (ALLOWED.has(hex)) continue;

        // Token file khud — tokens wahin defined hote hain.
        const filename = (context.getFilename() || '').replace(/\\/g, '/');
        if (filename.endsWith('packages/ui/src/design-system.ts')) continue;

        // Documentation, code nahi.
        if (insideComment(node)) continue;

        context.report({ node, messageId: 'hexLiteral', data: { hex } });
      }
    };

    // Fail-closed: allow-list nahi mili to SAB KUCH report hota hai.
    if (ALLOWED === null) {
      return {
        Literal(node) {
          if (typeof node.value !== 'string') return;
          const HEX = /#[0-9a-fA-F]{6}\b/g;
          let m;
          while ((m = HEX.exec(node.value)) !== null) {
            context.report({ node, messageId: 'tokensUnavailable' });
          }
        },
      };
    }

    return {
      // String literals — className, style, template parts.
      Literal(node) {
        if (typeof node.value !== 'string') return;
        scan(node, node.value);
      },

      // Template literals — `bg-[${x}]` aur `` `${a} #16181d` `` dono. Iske
      // bina backtick wale sab kuch chhoot jaate the, aur codebase mein
      // template literals hi zyada hain (`${surface} rounded-md p-5`).
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          scan(quasi, quasi.value.raw);
        }
      },
    };
  },
};
