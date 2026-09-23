// Voice input with the browser's built-in speech recognition (free; Chrome and Edge support English and Hindi).
import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null;
  start(): void; stop(): void; abort(): void;
};

const Ctor: (new () => Recognition) | undefined =
  typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;

export const speechSupported = Boolean(Ctor);

/** Dictate into a text box: `onText` receives the running transcript (interim results included). */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback((lang: "en-IN" | "hi-IN") => {
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => cb.current(Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(" "));
    r.onerror = (e) => setError(e?.error === "not-allowed" ? "Microphone access is blocked. Allow it in your browser to use voice." : e?.error === "no-speech" ? null : "Voice input stopped.");
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);
  return { listening, error, start, stop };
}
