// Feature switches for parts of the app that are built but not ready to show.

export const FEATURES = {
  /**
   * The Chrome extension connection (components/ExtensionBridge.tsx, Settings > Chrome extension).
   * On since the bridge became point to point: chrome.runtime messaging with the extension's ID,
   * only from this site's origin, only after a one-time pairing she confirms in the extension's
   * own window, and no API key in any message. With no extension installed or no pairing it does
   * nothing at all (no listener, no message), see components/ExtensionBridge.test.ts.
   */
  extension: true,
};
