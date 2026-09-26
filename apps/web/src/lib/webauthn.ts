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

// ---- Registration (device enroll) ----
// Option: 'required' | 'preferred' | 'discouraged'
// Ye batata hai ki authenticator me user verification (fingerprint/face) kitna zaroori hai
export async function registerCredential(
  email: string,
  authHeader?: string
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

  const options = await beginRes.json()

  // Challenge ka ORIGINAL base64url string pehle save kar lo.
  // Neeche hum use ArrayBuffer me convert kar denge, aur uske baad string
  // recover nahi hogi - par server ko wahi string wapas bhejni hai.
  // Hinglish: challenge string ko convert karne se pehle save kar lete hain
  const challengeB64: string = options.challenge

  // Step 2: challenge bytes me convert karo (browser API bytes expect karta hai)
  options.challenge = base64urlToBuffer(options.challenge)
  if (options.user?.id) options.user.id = base64urlToBuffer(options.user.id)
  if (options.excludeCredentials) {
    options.excludeCredentials = options.excludeCredentials.map((c: { id: string }) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    }))
  }

  // Step 3: browser ka authenticator call karo
  // Yahan user se actual fingerprint/face POORAHAI jata hai
  const credential = (await navigator.credentials.create({
    publicKey: options as PublicKeyCredentialCreationOptions,
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

  const options = await beginRes.json()

  // Login flow me bhi challenge ka original string save karna zaroori hai
  const challengeB64: string = options.challenge

  options.challenge = base64urlToBuffer(options.challenge)
  if (options.allowCredentials) {
    options.allowCredentials = options.allowCredentials.map((c: { id: string }) => ({
      ...c,
      id: base64urlToBuffer(c.id),
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
