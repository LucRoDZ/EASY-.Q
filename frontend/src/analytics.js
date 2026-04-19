/**
 * PostHog analytics integration — GDPR compliant.
 *
 * Initialized only when VITE_POSTHOG_KEY is set.
 * Users who have not accepted the cookie banner are excluded via
 * posthog.opt_out_capturing() (called from CookieConsentBanner).
 */

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.posthog.com';

let _posthog = null;

/**
 * Initialize PostHog. Call once at app startup (main.jsx).
 * No-op if VITE_POSTHOG_KEY is not set.
 */
export async function initAnalytics() {
  if (!POSTHOG_KEY) return;

  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // GDPR: disable automatic capture until user consents
      autocapture: false,
      // Don't capture IP addresses
      ip: false,
      // Use session recording only if explicitly opted in
      disable_session_recording: true,
      // Respect Do Not Track header
      respect_dnt: true,
      // Don't send data cross-domain without consent
      cross_subdomain_cookie: false,
    });
    _posthog = posthog;
  } catch {
    // PostHog not installed — analytics disabled
  }
}

/**
 * Track a named event with optional properties.
 * Safe to call even if PostHog is not initialized.
 */
export function track(event, properties = {}) {
  if (!_posthog) return;
  try {
    _posthog.capture(event, properties);
  } catch {
    // Best-effort — never throw from analytics
  }
}

/**
 * Identify the current user (called after Clerk sign-in).
 */
export function identify(userId, traits = {}) {
  if (!_posthog) return;
  try {
    _posthog.identify(userId, traits);
  } catch {}
}

/**
 * Opt the user out of tracking (GDPR: user declined cookie consent).
 */
export function optOut() {
  if (!_posthog) return;
  try {
    _posthog.opt_out_capturing();
  } catch {}
}

/**
 * Opt the user into tracking (called when user accepts cookie consent).
 */
export function optIn() {
  if (!_posthog) return;
  try {
    _posthog.opt_in_capturing();
  } catch {}
}
