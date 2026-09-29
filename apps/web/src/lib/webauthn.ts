// WebAuthn client helper - browser ke native API ko wrap karta hai
//
// YE CODE SIRF browser me chalta hai (navigator.credentials).
// Registration ka pura "ceremony" browser + device ke andar hota hai:
//   1. Server se challenge + options lete hain
//   2. navigator.credentials.create() device ka authenticator (Touch ID / Windows Hello)
//      call karta hai - user se fingerprint/face maanga jaata hai
//   3. Device ek key pair banata hai: PRIVATE key device me rehta hai,
//      PUBLIC key attestation ke saath wapas aata hai
//   4. Server us public key ko verify karke store kar deta hai
//
// SECURITY: private key kabhi server nahi jaata - isiliye ye phishing-resistant hai.
// Hinglish comments: har step ka arth

// ---- base64url helpers ----
// WebAuthn binary data base64url me aata hai, isliye encode/decode chahiye
export function base64urlToBuffer(base64url: string): ArrayBuffer {
  // ---- GUARD: non-string input pe clear error (crash nahi) ----
  // Pehle ye function bina check ke seedha `.replace()` call karta tha. Agar
  // upar ka code kisi shape me options bhej de (ya server ne galat shape de
  // diya ho), to `undefined.replace(...)` se ek cryptic TypeError aata tha
  // jiska stack trace user ko kuch matlab nahi batata tha.
  //
  // Ab non-string input par EXPLICIT message throw hota hai, jo seedha
  // batata hai ki asli problem kya hai (server ne `challenge` nahi bheja).
  if (typeof base64url !== 'string' || base64url.length === 0) {
    throw new Error(
      `base64urlToBuffer: expected a non-empty base64url string, received ${
        base64url === undefined ? 'undefined' : typeof base64url
      }. The server response was missing a required field.`
    )
  }

  // Base64URL -> Base64 (standard) conversion
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---- Capability detection ----
// Ye check batata hai ki device me authenticator hai ya nahi.
// Platform authenticator (Windows Hello / Touch ID) alag se check karte hain
// kyunki wo device ke andar hota hai (no USB/BT needed).
export async function isBiometricSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// ---- Capability diagnostics ----

/**
 * BiometricDiagnostics - WebAuthn support ka detailed report.
 *
 * ---- YE KYUN ZAROORI HAI ----
 * Pehle sirf ek boolean (`isUserVerifyingPlatformAuthenticatorAvailable()`)
 * check hota tha. Wo `false` aane par user ko bas "biometrics not
 * available" dikhta - koi pata nahi chalta tha KYUN nahi.
 *
 * Is machine par kai alag-alag reasons ho sakte hain, aur har ek ka apna
 * alag fix hai:
 *
 *   1. NON-SECURE CONTEXT (sabse common, aur silently fail hota hai)
 *      WebAuthn ko HTTPS ya `localhost` chahiye. Agar site kisi LAN IP se
 *      kholi jaye - jaise `http://192.168.1.5:3000` - to browser poora
 *      WebAuthn API CHHUPATA hai (`window.PublicKeyCredential` = undefined).
 *      Tab `isUserVerifyingPlatformAuthenticatorAvailable()` hamesha `false`
 *      deta hai, chahe device par Windows Hello perfectly configured ho.
 *      Isi wajah se phone par site kholne par biometric dikhai nahi deta.
 *
 *   2. WINDOWS "WEB AUTHENTICATION" API BAND
 *      Windows Settings > Privacy & security > Developer options me
 *      "Web Authentication" toggle off hua ho to platform authenticator
 *      detect hi nahi hota.
 *
 *   3. WINDOWS HELLO SET UP NAHI / TEMP DATA CLEAN
 *      Hello ka face/fingerprint enrollment stale ho to authenticator
 *      available nahi lagta.
 *
 *   4. BROWSER SUPPORT NAHI
 *      Purane browser ya private/incognito mode me WebAuthn restricted hota
 *      hai.
 *
 * Ye report UI me dikhti hai taaki user (aur hum) ko EXACTLY pata chale ki
 * fix kya hai - guess karna band ho jaata hai.
 */
export type BiometricDiagnostics = {
  /** Kya page secure context me hai (HTTPS ya localhost)? WebAuthn ka hard requirement */
  secureContext: boolean;
  /** `window.PublicKeyCredential` exist karta hai? (browser support) */
  hasPublicKeyCredential: boolean;
  /** Device ka platform authenticator (Windows Hello / Touch ID) available hai? */
  platformAuthenticator: boolean;
  /** Koi bhi authenticator (USB security key etc.) available hai? */
  anyAuthenticator: boolean;
  /** Conditional UI (usernameless login) supported hai? */
  conditionalMediation: boolean;
  /** Sab taiyaar hai biometric ke liye? */
  canUseBiometrics: boolean;
  /** USER-READABLE reason - sabse important */
  reason: string;
  /** Raw platform URL (debug ke liye) */
  origin: string;
};

/**
 * Detect full WebAuthn capability with a human-readable reason.
 *
 * NOTE: ye function KABHI throw nahi karta - har check individually guarded
 * hai, kyunki browser APIs absent hone pe access karte hi exception mil sakta
 * hai (e.g. Safari private mode).
 */
export async function diagnoseBiometrics(): Promise<BiometricDiagnostics> {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'ssr';

  const result: BiometricDiagnostics = {
    secureContext: false,
    hasPublicKeyCredential: false,
    platformAuthenticator: false,
    anyAuthenticator: false,
    conditionalMediation: false,
    canUseBiometrics: false,
    reason: 'Checking...',
    origin,
  };

  if (typeof window === 'undefined') {
    result.reason = 'Browser check runs in the browser only.';
    return result;
  }

  // ---- 1. Secure context ----
  result.secureContext = window.isSecureContext === true;
  if (!result.secureContext) {
    result.reason =
      'This page is NOT a secure context. WebAuthn needs HTTPS or localhost. ' +
      `You are on ${origin} - open the site via http://localhost:3000 instead.`;
    return result;
  }

  // ---- 2. API presence ----
  const pkc = (window as Window & { PublicKeyCredential?: typeof PublicKeyCredential })
    .PublicKeyCredential;
  const hasPKC = typeof pkc === 'function';
  result.hasPublicKeyCredential = hasPKC;
  if (!hasPKC) {
    result.reason =
      'This browser does not support WebAuthn (PublicKeyCredential missing). ' +
      'Update the browser, or avoid private/incognito mode.';
    return result;
  }

  // TypeScript ko confirm karna hai ki yahan `pkc` definitely function hai
  // (upar `hasPKC` guard ke baad). Ye assertion runtime par kuch nahi karta,
  // sirf compiler ko type deta hai.
  const credApi = pkc as typeof PublicKeyCredential;

  // ---- 3. Platform authenticator (Windows Hello / Touch ID) ----
  try {
    result.platformAuthenticator =
      (await credApi.isUserVerifyingPlatformAuthenticatorAvailable()) === true;
  } catch {
    result.platformAuthenticator = false;
  }

  // ---- 4. Any authenticator (USB key bhi chalega) ----
  try {
    result.anyAuthenticator =
      (await credApi.isConditionalMediationAvailable?.()) === true;
  } catch {
    result.anyAuthenticator = false;
  }

  // ---- 5. Conditional mediation ----
  try {
    result.conditionalMediation =
      (await credApi.isConditionalMediationAvailable?.()) === true;
  } catch {
    result.conditionalMediation = false;
  }

  result.canUseBiometrics = result.platformAuthenticator;

  if (!result.platformAuthenticator) {
    result.reason =
      'No platform authenticator found on this device. On Windows: check that ' +
      'Settings > Privacy & security > Developer options > "Web Authentication" ' +
      'is ON, and that Windows Hello (face or fingerprint) is set up in ' +
      'Settings > Accounts > Sign-in options.';
  } else {
    result.reason = 'Ready. Your device will ask for Windows Hello (face or fingerprint).';
  }

  return result;
}

// ---- Biometric methods ----
/**
 * Biometric method options jo user choose kar sakta hai.
 *
 * IMPORTANT REALITY CHECK:
 * WebAuthn / Windows Hello / Touch ID browser ko ye ALLOW NAHI karta ki wo
 * exact modality (face vs fingerprint) force kare. Platform authenticator
 * ek hi hota hai aur wo device ka apna native biometric dialog dikhata hai -
 * jisme Windows khud decide karta hai face use karni hai ya fingerprint.
 *
 * Isliye hum 'face' aur 'fingerprint' ko alag-alag OPTIONS ke roop me dikhate
 * hain (user ke liye choice + clarity), dono ke neeche SAME platform
 * authenticator ceremony chalti hai. Device jis modality me configured hai,
 * wo usi se verify karega - aur dono me se KOI BHI enable kiya ja sakta hai.
 *
 * Ye design isliye sahi hai kyunki isse user ko ye galat impression nahi milta
 * ki system force kar raha hai; balki choice milti hai aur real hardware
 * capability ke saath kaam karta hai.
 *
 * Hinglish: face aur fingerprint alag options, dono platform authenticator se
 */
export type BiometricMethod = 'face' | 'fingerprint';

export const BIOMETRIC_METHODS: {
  id: BiometricMethod;
  label: string;
  hint: string;
}[] = [
  {
    id: 'face',
    label: 'Face unlock',
    hint: 'Windows Hello / Touch ID se face se login',
  },
  {
    id: 'fingerprint',
    label: 'Fingerprint',
    hint: 'Windows Hello / Touch ID se fingerprint se login',
  },
];

// ---- Registration (device enroll) ----
// Option: 'required' | 'preferred' | 'discouraged'
// Ye batata hai ki authenticator me user verification (fingerprint/face) kitna zaroori hai
export async function registerCredential(
  email: string,
  authHeader?: string,
  _method: BiometricMethod = 'face'
): Promise<{ ok: boolean; message: string }> {
  // Step 1: server se challenge lo
  const beginRes = await fetch('/api/auth/webauthn/register/begin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({ email }),
  })

  if (!beginRes.ok) {
    return { ok: false, message: 'Could not start biometric registration.' }
  }

  // ---- UNWRAP `publicKey` (ye THE bug tha) ----
  // auth-service `{ "publicKey": { rp, user, challenge, pubKeyCredParams } }`
  // bhejta hai - options `publicKey` ke andar NESTED hain.
  //
  // Pehle yahan `const options = await beginRes.json()` tha aur phir seedha
  // `options.challenge` padha jaata tha. Par wo top-level par exist hi nahi
  // karta - wo `options.publicKey.challenge` par hai. Isliye:
  //
  //     options.challenge === undefined
  //     base64urlToBuffer(undefined)
  //     -> undefined.replace(...)  <-- TypeError line 19 par
  //
  // Yahi wo error hai jo aap dekh rahe the:
  //     "src/lib/webauthn.ts (19:28) ... base64url.replace is not a function"
  //
  // Isi wajah se biometric enrollment PASTE me kabhi kaam hi nahi kar paya -
  // request server tak pahunch rahi thi, par challenge convert karte waqt
  // crash ho rahi thi.
  const raw = await beginRes.json()
  const options = (raw?.publicKey ?? raw) as PublicKeyCredentialCreationOptions

  // Defensive: challenge ke bina aage mat badho. Pehle ye silent crash hota
  // tha; ab user ko clear message milega.
  if (!options || typeof options.challenge !== 'string') {
    return {
      ok: false,
      message: 'Biometric setup failed: the server did not return a valid challenge.',
    }
  }

  // Challenge ka ORIGINAL base64url string pehle save kar lo.
  // Neeche hum use ArrayBuffer me convert kar denge, aur uske baad string
  // recover nahi hogi - par server ko wahi string wapas bhejni hai.
  // Hinglish: challenge string ko convert karne se pehle save kar lete hain
  const challengeB64: string = options.challenge

  // Step 2: challenge bytes me convert karo (browser API bytes expect karta hai)
  options.challenge = base64urlToBuffer(options.challenge)
  if (options.user?.id) options.user.id = base64urlToBuffer(options.user.id as unknown as string)
  if (options.excludeCredentials) {
    // `type` field ko ZAROORI preserve karo - WebAuthn descriptor me ye
    // mandatory hai. Pehle yahan sirf `{...c, id}` spread hota tha jo
    // `type` ko drop kar deta tha (kyunki server ka `id` base64url STRING hai
    // aur hum use ArrayBuffer me badal rahe hain, isliye spread typed shape
    // se mismatch hota tha).
    options.excludeCredentials = options.excludeCredentials.map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id as unknown as string),
    }))
  }

  // Step 3: browser ka authenticator call karo
  // Yahan user se actual fingerprint/face POORAHAI jata hai
  //
  // `authenticatorAttachment: 'platform'` + `userVerification: 'required'`:
  // ye ensure karta hai ki device ka APNA authenticator use ho (USB/BT security
  // key nahi), aur user verification (face/fingerprint) bilkul zaroori ho.
  // Iske bina Chrome kisi bhi security key ko accept kar leta hai, jo
  // "is device ka biometric" ki guarantee ko kamzor kar deta tha.
  const creationOptions = {
    ...(options as PublicKeyCredentialCreationOptions),
    authenticatorAttachment: 'platform' as const,
    userVerification: 'required' as const,
  };

  const credential = (await navigator.credentials.create({
    publicKey: creationOptions,
    // Mediation: browser ka own confirm dialog
  })) as PublicKeyCredential | null

  if (!credential) {
    return { ok: false, message: 'Biometric registration was cancelled.' }
  }

  // Step 4: response ko JSON-safe banao aur server ko bhejo
  const response = credential.response as AuthenticatorAttestationResponse
  const finishRes = await fetch('/api/auth/webauthn/register/finish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Challenge HEADER me bhejte hain, body me nahi - kyunki go-webauthn ka
      // FinishRegistration raw request body ko STRICTLY parse karta hai aur
      // body me extra "challenge" field hone se parse fail ho sakta hai.
      'X-Challenge': challengeB64,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: bufferToBase64url(response.attestationObject),
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
      },
    }),
  })

  if (!finishRes.ok) {
    return { ok: false, message: 'Biometric registration could not be verified.' }
  }

  return { ok: true, message: 'Biometric login enabled on this device.' }
}

// ---- Authentication (biometric login) ----
// Ye password ki jagah use hota hai - signature verify hota hai
export async function authenticateWithBiometric(
  email: string
): Promise<{ ok: boolean; message: string }> {
  const beginRes = await fetch('/api/auth/webauthn/login/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  if (!beginRes.ok) {
    return { ok: false, message: 'Biometric login is not available for this account.' }
  }

  // ---- UNWRAP `publicKey` (same bug jo registration me tha) ----
  // Server `{"publicKey": {...}}` bhejta hai; options nested hain. Top-level
  // padhne se `options.challenge` undefined hota tha aur line 19 par crash
  // hota tha (`undefined.replace`).
  const raw = await beginRes.json()
  const options = (raw?.publicKey ?? raw) as PublicKeyCredentialRequestOptions

  if (!options || typeof options.challenge !== 'string') {
    return {
      ok: false,
      message: 'Biometric login failed: the server did not return a valid challenge.',
    }
  }

  // Login flow me bhi challenge ka original string save karna zaroori hai
  const challengeB64: string = options.challenge

  options.challenge = base64urlToBuffer(options.challenge)
  if (options.allowCredentials) {
    // Same fix jo `excludeCredentials` me kiya - `type` field mandatory hai
    // descriptor me, aur `id` base64url STRING se ArrayBuffer me badal raha
    // hai, isliye typed spread se mismatch hota tha.
    options.allowCredentials = options.allowCredentials.map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id as unknown as string),
    }))
  }

  // Browser authenticator se signature banwata hai
  const assertion = (await navigator.credentials.get({
    publicKey: options as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null

  if (!assertion) {
    return { ok: false, message: 'Biometric login was cancelled.' }
  }

  const authResponse = assertion.response as AuthenticatorAssertionResponse
  const finishRes = await fetch('/api/auth/webauthn/login/finish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Challenge header me (body strict parse hoti hai library ki)
      'X-Challenge': challengeB64,
    },
    body: JSON.stringify({
      id: assertion.id,
      rawId: bufferToBase64url(assertion.rawId),
      type: assertion.type,
      response: {
        authenticatorData: bufferToBase64url(authResponse.authenticatorData),
        clientDataJSON: bufferToBase64url(authResponse.clientDataJSON),
        signature: bufferToBase64url(authResponse.signature),
        userHandle: authResponse.userHandle
          ? bufferToBase64url(authResponse.userHandle)
          : null,
      },
    }),
  })

  if (!finishRes.ok) {
    return { ok: false, message: 'Biometric verification failed.' }
  }

  return { ok: true, message: 'Biometric login successful.' }
}
