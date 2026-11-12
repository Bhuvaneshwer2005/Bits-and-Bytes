import { useEffect, useState } from "react";

/** True while the browser reports a connection. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** Tells the learner what still works without a connection. */
export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <p className="notice offline-banner" role="status">
      You&rsquo;re offline. Saved decks, the player, the quiz and the cheat sheet still work. Building a new deck or rewriting a card needs a
      connection.
    </p>
  );
}
