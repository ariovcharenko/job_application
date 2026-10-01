"use client";

import { useEffect, useState } from "react";
import { canUseIndexedDB } from "@/lib/storageCheck";

/**
 * Asks the browser not to clear this site's saved data (API key, profile, tracker) when it is
 * short on space, and warns when the browser won't let the app store anything at all (a private
 * window or blocked site data), since every save would silently fail there.
 */
export default function StoragePersist() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let alive = true;
    navigator.storage?.persist?.().catch(() => {});
    let factory: IDBFactory | undefined;
    try {
      factory = typeof indexedDB === "undefined" ? undefined : indexedDB;
    } catch {
      // Some browsers throw just for reading window.indexedDB when site data is blocked.
      factory = undefined;
    }
    canUseIndexedDB(factory).then((ok) => alive && setBlocked(!ok));
    return () => {
      alive = false;
    };
  }, []);
  if (!blocked) return null;
  return (
    <div role="alert" className="bg-bad-soft px-4 py-3 text-center text-sm leading-relaxed text-bad">
      <strong className="font-semibold">This browser is blocking local storage. The app can&apos;t save anything here.</strong>{" "}
      Try a regular (not private) window, or allow site data for this site in your browser settings.
    </div>
  );
}
