// Unified Dynamic Config System for Wideo11
// Yeh module environment variables se config load karta hai aur validate karta hai.
// Agar kritikal variables missing ya invalid hain, to process exit kar deta hai (hard panic).
// Hinglish comments: har line ka arth samjhne ke liye.

// Config ka interface define karte hain jisaki validation ke baad use kiya jaye
export interface AppConfig {
  // Next.js app ke liye (client side mein accessible hoga)
  NEXT_PUBLIC_APP_URL: string;
  
  // Wallet payout matrix ke liye (SSOT)
  MINIMUM_MAINTENANCE_BUFFER_INR: number; // e.g., 2000 (INR)
  SISTER_SHARE_PERCENTAGE: number; // e.g., 5 (for 5%)
  
  // Add other required env vars as needed
  // Example: NETWORK_PROVIDER_PRIMARY, NETWORK_PROVIDER_SECONDARY, etc.
}

// Environment variables se config load karte hain
function loadConfig(): AppConfig {
  // Process.env se values lete hain, default values dete hain (agar missing ho to)
  const config: AppConfig = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    MINIMUM_MAINTENANCE_BUFFER_INR: parseInt(process.env.MINIMUM_MAINTENANCE_BUFFER_INR || '2000', 10),
    SISTER_SHARE_PERCENTAGE: parseFloat(process.env.SISTER_SHARE_PERCENTAGE || '5'),
    // Add others here
  };

  return config;
}

// Config ko validate karte hain
function validateConfig(config: AppConfig): void {
  // MINIMUM_MAINTENANCE_BUFFER_INR: positive number hona chahiye
  if (isNaN(config.MINIMUM_MAINTENANCE_BUFFER_INR) || config.MINIMUM_MAINTENANCE_BUFFER_INR <= 0) {
    console.error(`[CONFIG ERROR] MINIMUM_MAINTENANCE_BUFFER_INR must be a positive number. Current: ${config.MINIMUM_MAINTENANCE_BUFFER_INR}`);
    process.exit(1); // Hard system panic
  }

  // SISTER_SHARE_PERCENTAGE: 0 aur 100 ke beech hona chahiye (inclusive)
  if (isNaN(config.SISTER_SHARE_PERCENTAGE) || config.SISTER_SHARE_PERCENTAGE < 0 || config.SISTER_SHARE_PERCENTAGE > 100) {
    console.error(`[CONFIG ERROR] SISTER_SHARE_PERCENTAGE must be between 0 and 100. Current: ${config.SISTER_SHARE_PERCENTAGE}`);
    process.exit(1); // Hard system panic
  }

  // NEXT_PUBLIC_APP_URL: valid URL hona chahiye (basic check)
  try {
    new URL(config.NEXT_PUBLIC_APP_URL);
  } catch (err) {
    console.error(`[CONFIG ERROR] NEXT_PUBLIC_APP_URL is not a valid URL. Current: ${config.NEXT_PUBLIC_APP_URL}`);
    process.exit(1); // Hard system panic
  }

  // Add more validations as needed for other variables
}

// Config ko load, validate, aur freeze karte hain (SSOT ke liye)
const rawConfig = loadConfig();
validateConfig(rawConfig);
// Object.freeze se ensure karte hain ki koi config ko modify nahi kar sakta
export const config: AppConfig = Object.freeze(rawConfig);

// Export karte hain ki ise kisi bhi jagah se import kiya ja sake
// Example usage in code: import { config } from '@wideo11/config';
// Then use: config.MINIMUM_MAINTENANCE_BUFFER_INR, etc.
