import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { type Connection, usePrefs } from './prefs';

/** The token the server hands back in the URL fragment: `…#cf_token=<jwt>`. */
export function tokenFromUrl(url: string): string | null {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const token = new URLSearchParams(hash).get('cf_token');
  return token || null;
}

/**
 * Sign in with Cloudflare Access for a server on another hostname. The server's `/auth/access` page sits
 * behind Access, so opening it shows Access's login; afterwards the server sends the person back to the app
 * with their Access token.
 *
 * - Web: a full-page redirect. The connection waits in `pendingConnection` and the token is picked up by
 *   `finishAccessSignIn` when the app loads again. Resolves to `null` (the page is leaving).
 * - Android: an in-app browser sheet that returns to `studyo://auth`. Resolves to the token.
 */
export async function signInWithAccess(
  conn: Connection,
  returnPath = '/connect',
): Promise<string | null> {
  if (Platform.OS === 'web') {
    usePrefs.getState().setPending(conn);
    const back = `${window.location.origin}${returnPath}`;
    window.location.assign(`${conn.url}/auth/access?return=${encodeURIComponent(back)}`);
    return null;
  }
  const back = Linking.createURL('auth');
  const result = await WebBrowser.openAuthSessionAsync(
    `${conn.url}/auth/access?return=${encodeURIComponent(back)}`,
    back,
  );
  return result.type === 'success' ? tokenFromUrl(result.url) : null;
}

/**
 * On web, after the redirect back: take the token from the address bar, attach it to the waiting (or current)
 * connection, and clean the address. Returns true when a sign-in was completed.
 */
export function finishAccessSignIn(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const token = tokenFromUrl(window.location.href);
  if (!token) return false;
  const prefs = usePrefs.getState();
  if (
    prefs.pendingConnection &&
    prefs.connection &&
    prefs.pendingConnection.url === prefs.connection.url
  ) {
    // Signing in again to the server we're already connected to.
    prefs.setAccessToken(token);
    prefs.setPending(null);
  } else if (prefs.pendingConnection) {
    // The connect screen picks this up, checks the server with it, and only then saves the connection.
    prefs.setPending({ ...prefs.pendingConnection, cfToken: token });
  } else if (prefs.connection) {
    prefs.setAccessToken(token);
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}
