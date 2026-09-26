import { useEffect, useState, type ReactNode } from "react";

export interface HeroJob { title: string; company: string; location: string; pay?: string }

// ---------------------------------------------------------------------------------------------------------------------
// The job journey as an isometric glass diagram: resume + what the AI learns about you flow into an AI core, come out
// as scored jobs, then an interview, then "placed". Everything is drawn on one isometric grid: a tile is a glass slab
// whose top face is a plane, so icons and bars drawn on it are skewed correctly. Always dark: it is a lit stage that
// looks right on both themes. One real, live job title is shown on the match card; the score is illustrative.
// ---------------------------------------------------------------------------------------------------------------------

const K = 0.866; // cos 30°
const H = 0.5; // sin 30°
type Pt = [number, number];

const BLUE = "#34abc8", GREEN = "#22bf9b", GOLD = "#f0bf4c";
const reducedMotion = () => typeof window !== "undefined" && (Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) || document.documentElement.classList.contains("low-data"));

/** Screen position of a world grid point (gx along one iso axis, gy along the other). */
const world = (gx: number, gy: number, ox = 400, oy = 130): Pt => [ox + (gx - gy) * K, oy + (gx + gy) * H];

interface SlabProps { at: Pt; w: number; d: number; depth?: number; tone: string; lift?: number; glow?: boolean; children?: ReactNode; float?: number }

/** A glass slab. `at` is the centre of its top face. Children are drawn on the top plane, in (u, v) units of w by d. */
function Slab({ at, w, d, depth = 12, tone, lift = 0, glow = true, children, float = 0 }: SlabProps) {
  const ox = at[0] - ((w - d) * K) / 2;
  const oy = at[1] - lift - ((w + d) * H) / 2;
  const P = (u: number, v: number): Pt => [ox + (u - v) * K, oy + (u + v) * H];
  const A = P(0, 0), B = P(w, 0), C = P(w, d), D = P(0, d);
  const poly = (...pts: Pt[]) => pts.map((p) => p.join(",")).join(" ");
  const id = `s${Math.round(at[0])}_${Math.round(at[1])}`;
  return (
    <g className="hj-float" style={float ? { animationDelay: `${float}s` } : undefined}>
      {glow && <ellipse cx={at[0]} cy={at[1] + depth + 10} rx={(w + d) * K * 0.5} ry={(w + d) * H * 0.5 + 6} fill={tone} opacity="0.22" filter="url(#hj-blur)" />}
      <defs>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#274c66" stopOpacity="0.96" /><stop offset="1" stopColor="#0f2434" stopOpacity="0.96" /></linearGradient>
        <linearGradient id={`${id}-l`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#12293b" /><stop offset="1" stopColor="#08131c" /></linearGradient>
        <linearGradient id={`${id}-r`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f2434" /><stop offset="1" stopColor="#060f17" /></linearGradient>
      </defs>
      <polygon points={poly(D, C, [C[0], C[1] + depth], [D[0], D[1] + depth])} fill={`url(#${id}-l)`} stroke="rgba(140,210,240,.18)" strokeWidth="1" />
      <polygon points={poly(B, C, [C[0], C[1] + depth], [B[0], B[1] + depth])} fill={`url(#${id}-r)`} stroke="rgba(140,210,240,.14)" strokeWidth="1" />
      <polyline points={poly([D[0], D[1] + depth], [C[0], C[1] + depth], [B[0], B[1] + depth])} fill="none" stroke={tone} strokeOpacity="0.85" strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points={poly(A, B, C, D)} fill={`url(#${id}-top)`} stroke="rgba(170,225,245,.5)" strokeWidth="1.4" strokeLinejoin="round" />
      <polyline points={poly(D, A, B)} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeLinejoin="round" />
      <g transform={`matrix(${K} ${H} ${-K} ${H} ${ox} ${oy})`}>{children}</g>
    </g>
  );
}

/** Two straight iso segments from a to b (along the x axis first, then y), so links follow the grid like circuit traces. */
const route = (a: Pt, b: Pt, firstAxis: "x" | "y"): { d: string; mid: Pt } => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = (dx / K + 2 * dy) / 2; // distance along +x axis
  const m = (2 * dy - dx / K) / 2; // distance along +y axis
  const corner: Pt = firstAxis === "x" ? [a[0] + n * K, a[1] + n * H] : [a[0] - m * K, a[1] + m * H];
  return { d: `M${a[0]},${a[1]} L${corner[0]},${corner[1]} L${b[0]},${b[1]}`, mid: corner };
};

function Link({ a, b, axis, tone, delay = 0, animate }: { a: Pt; b: Pt; axis: "x" | "y"; tone: string; delay?: number; animate: boolean }) {
  const r = route(a, b, axis);
  return (
    <g>
      <path d={r.d} fill="none" stroke="rgba(90,170,210,.28)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d={r.d} fill="none" stroke={tone} strokeOpacity="0.9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 9" className="hj-flow" style={{ animationDelay: `${delay}s` }} />
      {animate && [0, 1].map((i) => (
        <g key={i} filter="url(#hj-glow)">
          <path d="M0,-5 L7,0 L0,5 L-7,0 Z" fill={tone} opacity="0.95">
            <animateMotion dur="3.4s" begin={`${delay + i * 1.7}s`} repeatCount="indefinite" path={r.d} />
          </path>
        </g>
      ))}
    </g>
  );
}

const Bar = ({ x, y, w, h = 4, o = 0.5, c = "#9fd4e8" }: { x: number; y: number; w: number; h?: number; o?: number; c?: string }) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={c} opacity={o} />;

/** Small unskewed caption under a tile, so the story reads even at a glance. */
function Caption({ at, text, tone }: { at: Pt; text: string; tone: string }) {
  const w = text.length * 7 + 24;
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <rect x={-w / 2} y={-12} width={w} height={24} rx={12} fill="rgba(8,19,28,.82)" stroke={tone} strokeOpacity="0.55" />
      <circle cx={-w / 2 + 12} cy={0} r={3} fill={tone} />
      <text x={-w / 2 + 21} y={4.5} fontSize="12" fontWeight="600" fill="#dbe9f0" style={{ fontFamily: "var(--font-sans)" }}>{text}</text>
    </g>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function HeroJourney({ jobs }: { jobs: HeroJob[] }) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => { setAnimate(!reducedMotion()); }, []);

  const S = 178;
  const g = (gx: number, gy: number) => world(gx, gy, 410, 118);
  const Bc = g(230, 230);
  const F = g(230 - S, 230), A = g(230, 230 + S), C = g(230 + S, 230), D = g(230 + S, 230 - S), E = g(230, 230 - S);
  const job = jobs[0];

  return (
    <div className="hj relative mx-auto w-full max-w-[720px] select-none" aria-hidden>
      <svg viewBox="165 120 630 420" className="h-auto w-full overflow-visible lg:scale-[1.1]" role="img">
        <defs>
          <filter id="hj-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" /></filter>
          <filter id="hj-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id="hj-bokeh"><stop offset="0" stopColor="#fff" stopOpacity="0.35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
          <radialGradient id="hj-floor" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#1a5f7c" stopOpacity="0.32" /><stop offset="1" stopColor="#1a5f7c" stopOpacity="0" /></radialGradient>
          <linearGradient id="hj-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BLUE} stopOpacity="0.35" /><stop offset="1" stopColor={BLUE} stopOpacity="0" /></linearGradient>
        </defs>

        {/* atmosphere: floor glow, bokeh, faint network and analytics, like a lit studio backdrop */}
        <ellipse cx="420" cy="380" rx="360" ry="200" fill="url(#hj-floor)" />
        <circle cx="690" cy="120" r="46" fill="url(#hj-bokeh)" opacity="0.5" /><circle cx="560" cy="70" r="20" fill="url(#hj-bokeh)" opacity="0.35" /><circle cx="130" cy="120" r="30" fill="url(#hj-bokeh)" opacity="0.25" />
        <g opacity="0.38" stroke={BLUE} strokeWidth="0.8" fill={BLUE}>
          {[[640, 60], [690, 90], [730, 55], [700, 140], [760, 120], [660, 150], [610, 110]].map(([x, y], i, a) => <g key={i}><circle cx={x} cy={y} r="2.4" />{i > 0 && <line x1={x} y1={y} x2={a[i - 1][0]} y2={a[i - 1][1]} />}</g>)}
        </g>
        <g opacity="0.5" transform="translate(150 40)"><path d="M0,60 L18,44 L34,52 L52,26 L70,38 L90,14 L90,70 L0,70 Z" fill="url(#hj-area)" /><path d="M0,60 L18,44 L34,52 L52,26 L70,38 L90,14" fill="none" stroke={BLUE} strokeWidth="1.5" /></g>

        {/* links first, so the slabs sit on top of them */}
        <Link a={F} b={Bc} axis="x" tone={BLUE} animate={animate} />
        <Link a={A} b={Bc} axis="y" tone={BLUE} delay={0.6} animate={animate} />
        <Link a={Bc} b={C} axis="x" tone={GREEN} delay={1.2} animate={animate} />
        <Link a={C} b={D} axis="y" tone={GOLD} delay={1.8} animate={animate} />
        <Link a={D} b={E} axis="x" tone={GREEN} delay={2.4} animate={animate} />

        {/* back row */}
        <Slab at={F} w={100} d={76} tone={BLUE} float={0.4}>
          <circle cx="50" cy="34" r="19" fill="none" stroke="rgba(150,210,235,.22)" strokeWidth="5" />
          <circle cx="50" cy="34" r="19" fill="none" stroke={BLUE} strokeWidth="5" strokeLinecap="round" strokeDasharray="90 120" transform="rotate(-90 50 34)" />
          <text x="50" y="38" textAnchor="middle" fontSize="12" fontWeight="700" fill="#e6f4f9">75%</text>
          <Bar x={14} y={60} w={72} o={0.55} /><Bar x={14} y={68} w={48} o={0.3} h={3} />
        </Slab>
        <Slab at={E} w={130} d={94} depth={16} tone={GREEN} float={1.4}>
          <circle cx="46" cy="47" r="27" fill="rgba(34,191,155,.16)" stroke={GREEN} strokeWidth="3" />
          <path d="M33,48 L43,58 L61,36" fill="none" stroke="#7df0cf" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <Bar x={86} y={30} w={34} h={6} o={0.65} c="#bff5e4" /><Bar x={86} y={44} w={26} o={0.35} /><Bar x={86} y={54} w={30} o={0.3} />
          <Bar x={14} y={84} w={100} h={4} o={0.28} c={GREEN} />
        </Slab>

        {/* middle row */}
        <Slab at={Bc} w={86} d={86} depth={18} tone={BLUE} float={0.9}>
          <circle cx="43" cy="43" r="36" fill="none" stroke={BLUE} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="3 5" />
          <circle cx="43" cy="43" r="26" fill="none" stroke={GREEN} strokeOpacity="0.7" strokeWidth="1.5" />
          <circle cx="43" cy="43" r="26" fill="none" stroke={GREEN} strokeWidth="2" className="hj-ring" />
          <circle cx="43" cy="43" r="17" fill="rgba(52,171,200,.28)" stroke="#8fe0f5" strokeWidth="2" />
          <text x="43" y="49" textAnchor="middle" fontSize="17" fontWeight="800" fill="#f2fbff" style={{ letterSpacing: 1 }}>AI</text>
        </Slab>
        <Slab at={D} w={96} d={72} tone={GOLD} float={0.2}>
          <rect x="10" y="10" width="76" height="52" rx="6" fill="rgba(240,191,76,.10)" stroke="rgba(240,191,76,.5)" />
          {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={22 + (i % 4) * 17} cy={24 + Math.floor(i / 4) * 14} r="2.6" fill={i === 6 ? GOLD : "#9fd4e8"} opacity={i === 6 ? 1 : 0.4} />)}
          <rect x="59" y="32" width="14" height="12" rx="4" fill="none" stroke={GOLD} strokeWidth="1.6" />
        </Slab>

        {/* front row */}
        <Slab at={A} w={116} d={88} tone={BLUE} float={1.1}>
          <circle cx="24" cy="24" r="10" fill="rgba(52,171,200,.35)" stroke="#8fe0f5" />
          <Bar x={42} y={17} w={46} h={5} o={0.8} c="#e6f4f9" /><Bar x={42} y={27} w={30} o={0.4} />
          {[44, 54, 64].map((y, i) => <Bar key={y} x={14} y={y} w={[88, 74, 82][i]} o={0.32} />)}
          <rect x="14" y="74" width="24" height="9" rx="4.5" fill="rgba(34,191,155,.3)" stroke={GREEN} strokeWidth="0.8" />
          <rect x="42" y="74" width="20" height="9" rx="4.5" fill="rgba(52,171,200,.3)" stroke={BLUE} strokeWidth="0.8" />
          <rect x="66" y="74" width="26" height="9" rx="4.5" fill="rgba(240,191,76,.25)" stroke={GOLD} strokeWidth="0.8" />
        </Slab>
        {/* the scored jobs: three stacked cards, best on top */}
        {[2, 1, 0].map((i) => (
          <Slab key={i} at={[C[0], C[1] - i * 15]} w={108} d={80} depth={i === 2 ? 12 : 9} tone={i === 0 ? GREEN : BLUE} glow={i === 2} float={0.7}>
            {i === 0 ? (
              <>
                <circle cx="26" cy="26" r="15" fill="rgba(34,191,155,.16)" stroke={GREEN} strokeWidth="3" />
                <text x="26" y="30.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#eafff8">94</text>
                <Bar x={50} y={14} w={44} h={5} o={0.85} c="#e6f4f9" /><Bar x={50} y={24} w={30} o={0.4} />
                {[["Skills", 92], ["Role", 88], ["City", 100]].map(([l, v], k) => <g key={l as string}><Bar x={14} y={48 + k * 9} w={80} h={3} o={0.15} /><Bar x={14} y={48 + k * 9} w={0.8 * (v as number)} h={3} o={0.85} c={GREEN} /></g>)}
              </>
            ) : <><Bar x={14} y={22} w={60} o={0.35} /><Bar x={14} y={34} w={40} o={0.2} /></>}
          </Slab>
        ))}

        {/* captions */}
        <Caption at={[F[0], F[1] + 62]} text="Understands you" tone={BLUE} />
        <Caption at={[A[0], A[1] + 62]} text="Your resume" tone={BLUE} />
        <Caption at={[Bc[0], Bc[1] + 68]} text="Finds the fit" tone={BLUE} />
        <Caption at={[C[0], C[1] + 58]} text={job ? `${clip(job.title, 18)} · ${job.location.split(",")[0]}` : "Scored, honest matches"} tone={GREEN} />
        <Caption at={[D[0], D[1] + 52]} text="Interview ready" tone={GOLD} />
        <Caption at={[E[0], E[1] - 62]} text="Placed" tone={GREEN} />
      </svg>
    </div>
  );
}
