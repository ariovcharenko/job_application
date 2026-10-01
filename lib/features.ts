// Feature switches for parts of the app that are built but not ready to show.

export const FEATURES = {
  /**
   * Company-watchlist job discovery via JSearch (the Feed page, its Settings key card, the
   * watchlist preference, and feed batch tailoring). Hidden 2026-09-24: the first live run didn't
   * give useful results. The code and any stored feed data are untouched; set to true to bring it
   * all back.
   */
  jobFeed: false,
  /**
   * The Chrome extension's sync bridge (components/ExtensionBridge.tsx). Off for the public site:
   * when mounted it posts the API key, Profile and resume to window.postMessage on every page
   * load, where any other browser extension running on the page could read them. It must stay
   * off until the bridge only answers a verified handshake from the installed extension and
   * never sends the key without an explicit opt-in.
   */
  extension: false,
};
