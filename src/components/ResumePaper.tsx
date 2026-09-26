import { useEffect, useRef, useState } from "react";
import { resumeHtml, type ResumeDoc, type Template } from "../lib/resumeDoc";

const A4_PX = 794; // 210 mm at 96 dpi

/**
 * On-screen preview of the resume, rendered from the same HTML that prints. It is shown at A4 size and scaled down to
 * fit narrow screens, and grows to the full height of the document, so every page is visible.
 */
export default function ResumePaper({ doc, template }: { doc: ResumeDoc; template: Template }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(1123);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / A4_PX)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = () => {
    const d = frame.current?.contentDocument;
    if (d?.body) setHeight(Math.max(1123, d.documentElement.scrollHeight));
  };
  useEffect(() => { const t = setTimeout(measure, 400); return () => clearTimeout(t); });

  return (
    <div ref={box} className="theme-paper w-full overflow-hidden rounded-xl ring-1 ring-slate-200" style={{ height: height * scale, background: "#dfe5ea" }}>
      <iframe ref={frame} title="Resume preview" srcDoc={resumeHtml(doc, template, { screen: true })} onLoad={measure} scrolling="no"
        style={{ width: A4_PX, height, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", display: "block" }} />
    </div>
  );
}
