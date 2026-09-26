import React, { useId } from "react";
import type { GuidePose } from "../lib/guide";

/**
 * Asha, the guide: an illustrated career coach drawn in SVG, so she is crisp at any size, weighs a few KB and can
 * move. Each pose changes her arms, eyebrows, eyes and mouth; she blinks on her own and her mouth moves while she
 * speaks. Palette: peacock blazer, white top, gold pendant and earrings, teal headset.
 */
export default function Asha({ pose, mouthOpen = false, face = false, className }: { pose: GuidePose; mouthOpen?: boolean; face?: boolean; className?: string }) {
  const u = useId().replace(/:/g, "");
  const id = (n: string) => `${u}-${n}`;
  const happy = pose === "celebrating" || pose === "encouraging" || pose === "waving";
  const talking = pose === "talking" || mouthOpen;

  // Eyebrows: raised when happy or listening, one lifted when thinking.
  const brows = pose === "thinking"
    ? ["M79 96 q9 -6 18 -2", "M113 90 q10 -5 19 2"]
    : happy || pose === "listening"
      ? ["M79 93 q9 -7 18 -2", "M113 91 q9 -5 18 2"]
      : ["M79 96 q9 -5 18 -1", "M113 95 q9 -4 18 1"];

  return (
    <svg viewBox={face ? "52 44 106 106" : "0 0 210 250"} className={className} role="img" aria-label={`Asha, ${pose}`}>
      <defs>
        <linearGradient id={id("skin")} x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#e3a47c" /><stop offset="1" stopColor="#c7835c" /></linearGradient>
        <linearGradient id={id("skinS")} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#b8704b" /><stop offset="1" stopColor="#d3926b" /></linearGradient>
        <linearGradient id={id("hair")} x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#2b2230" /><stop offset="1" stopColor="#15111a" /></linearGradient>
        <linearGradient id={id("coat")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1596bd" /><stop offset="0.55" stopColor="#0a7399" /><stop offset="1" stopColor="#07526e" /></linearGradient>
        <linearGradient id={id("coatD")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0b6a8c" /><stop offset="1" stopColor="#063f55" /></linearGradient>
        <linearGradient id={id("gold")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#d9a431" /></linearGradient>
        <radialGradient id={id("cheek")}><stop offset="0" stopColor="#e2766f" stopOpacity="0.45" /><stop offset="1" stopColor="#e2766f" stopOpacity="0" /></radialGradient>
        <radialGradient id={id("glow")}><stop offset="0" stopColor="#34abc8" stopOpacity="0.35" /><stop offset="1" stopColor="#34abc8" stopOpacity="0" /></radialGradient>
      </defs>

      {/* soft halo so she reads on any background */}
      {!face && <ellipse cx="105" cy="150" rx="100" ry="96" fill={`url(#${id("glow")})`} />}

      {/* ponytail behind */}
      <path d="M140 92 c22 8 30 40 22 70 c-4 16 -12 26 -20 30 c6 -18 8 -38 0 -58 c-4 -12 -8 -24 -2 -42z" fill={`url(#${id("hair")})`} />

      {/* arms behind the body (celebrating: both up) */}
      {pose === "celebrating" && (
        <g>
          <path d="M44 196 C30 170 24 140 30 112" stroke={`url(#${id("coat")})`} strokeWidth="22" strokeLinecap="round" fill="none" />
          <path d="M166 196 C180 170 186 140 180 112" stroke={`url(#${id("coat")})`} strokeWidth="22" strokeLinecap="round" fill="none" />
          <circle cx="30" cy="104" r="11" fill={`url(#${id("skin")})`} /><circle cx="180" cy="104" r="11" fill={`url(#${id("skin")})`} />
        </g>
      )}

      {/* body: blazer, white top, lapels */}
      <path d="M22 250 C24 204 50 180 80 174 L105 190 L130 174 C160 180 186 204 188 250z" fill={`url(#${id("coat")})`} />
      <path d="M80 174 L105 214 L130 174 L120 170 L105 190 L90 170z" fill="#f5fbfd" />
      <path d="M80 174 L96 222 L86 250 L66 250 L70 206z" fill={`url(#${id("coatD")})`} opacity="0.55" />
      <path d="M130 174 L114 222 L124 250 L144 250 L140 206z" fill={`url(#${id("coatD")})`} opacity="0.55" />
      <path d="M80 174 L98 212 M130 174 L112 212" stroke="#5ec6e0" strokeOpacity="0.45" strokeWidth="1.4" fill="none" />
      {/* pendant */}
      <path d="M92 176 q13 22 26 0" stroke={`url(#${id("gold")})`} strokeWidth="1.3" fill="none" />
      <path d="M105 196 l4.5 5 -4.5 5 -4.5 -5z" fill={`url(#${id("gold")})`} />

      {/* neck */}
      <path d="M92 150 L92 176 Q105 186 118 176 L118 150z" fill={`url(#${id("skinS")})`} />

      {/* head */}
      <ellipse cx="72" cy="112" rx="7" ry="11" fill={`url(#${id("skinS")})`} />
      <ellipse cx="138" cy="112" rx="7" ry="11" fill={`url(#${id("skinS")})`} />
      <circle cx="72" cy="126" r="3" fill={`url(#${id("gold")})`} />
      <path d="M74 100 C74 72 88 58 105 58 C122 58 136 72 136 100 C136 134 122 156 105 156 C88 156 74 134 74 100z" fill={`url(#${id("skin")})`} />
      <ellipse cx="86" cy="124" rx="10" ry="6" fill={`url(#${id("cheek")})`} />
      <ellipse cx="124" cy="124" rx="10" ry="6" fill={`url(#${id("cheek")})`} />

      {/* hair: side part, sweeping fringe, a loose strand */}
      <path d="M70 104 C66 66 88 48 108 48 C132 48 146 66 140 104 C136 90 128 78 116 72 C108 84 92 90 76 92 C74 96 72 100 70 104z" fill={`url(#${id("hair")})`} />
      <path d="M116 72 C124 80 132 90 136 104" stroke="#3a2f40" strokeWidth="1.2" fill="none" />
      <path d="M78 92 C74 106 74 118 78 128" stroke={`url(#${id("hair")})`} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M88 56 C96 52 110 52 118 56" stroke="#4a3d52" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />

      {/* eyebrows */}
      <path d={brows[0]} stroke="#2b2230" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d={brows[1]} stroke="#2b2230" strokeWidth="2.6" strokeLinecap="round" fill="none" />

      {/* eyes (blink on their own) */}
      <g className="asha-blink">
        {pose === "celebrating" ? (
          <>
            <path d="M81 108 q7 -7 14 0" stroke="#2b2230" strokeWidth="2.8" strokeLinecap="round" fill="none" />
            <path d="M115 108 q7 -7 14 0" stroke="#2b2230" strokeWidth="2.8" strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <ellipse cx="88" cy="108" rx="7" ry="5.4" fill="#fff" />
            <ellipse cx="122" cy="108" rx="7" ry="5.4" fill="#fff" />
            <circle cx={pose === "thinking" ? 90 : pose === "pointing" ? 85 : 88} cy={pose === "thinking" ? 106 : 108} r="4.1" fill="#3b2418" />
            <circle cx={pose === "thinking" ? 124 : pose === "pointing" ? 119 : 122} cy={pose === "thinking" ? 106 : 108} r="4.1" fill="#3b2418" />
            <circle cx={pose === "thinking" ? 91.5 : pose === "pointing" ? 86.5 : 89.5} cy="106.5" r="1.3" fill="#fff" />
            <circle cx={pose === "thinking" ? 125.5 : pose === "pointing" ? 120.5 : 123.5} cy="106.5" r="1.3" fill="#fff" />
            <path d="M80 104 q8 -5 16 0 M114 104 q8 -5 16 0" stroke="#2b2230" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </>
        )}
      </g>

      {/* nose */}
      <path d="M104 114 q-3 10 1 13 q3 1 5 -1" stroke="#a9623f" strokeWidth="1.6" strokeLinecap="round" fill="none" />

      {/* mouth */}
      {talking ? (
        <g>
          <path d={mouthOpen ? "M94 135 q11 13 22 0 q-11 -4 -22 0z" : "M95 135 q10 8 20 0 q-10 -3 -20 0z"} fill="#7c2d38" />
          <path d={mouthOpen ? "M97 135.5 q8 -2 16 0 l0 2 q-8 -1 -16 0z" : "M98 135.5 q7 -1.5 14 0 l0 1.4 q-7 -1 -14 0z"} fill="#fff" />
        </g>
      ) : happy ? (
        <g>
          <path d="M91 132 q14 17 28 0z" fill="#7c2d38" />
          <path d="M93.5 132.6 q11.5 3 23 0 l-1 3 q-10.5 2 -21 0z" fill="#fff" />
        </g>
      ) : pose === "thinking" ? (
        <path d="M97 136 q8 -3 15 1" stroke="#8a3a44" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M94 133 q11 9 22 0" stroke="#8a3a44" strokeWidth="2.8" strokeLinecap="round" fill="none" />
      )}

      {/* headset: band over the head, ear cup on her right, mic boom towards the mouth */}
      <path d="M74 96 C72 58 138 58 138 96" stroke="#0d3142" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.85" />
      <rect x="132" y="98" width="13" height="22" rx="6" fill="#22bf9b" stroke="#0d6e5a" strokeWidth="1.5" />
      <path d="M138 118 C136 136 128 142 118 140" stroke="#0d3142" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="117" cy="140" r="3.4" fill="#22bf9b" />

      {/* arms in front */}
      {pose === "waving" && (
        <g className="asha-wave">
          <path d="M170 214 C184 190 186 162 176 138" stroke={`url(#${id("coat")})`} strokeWidth="22" strokeLinecap="round" fill="none" />
          <path d="M168 132 C166 118 172 108 178 110 C180 104 186 104 188 110 C192 106 197 110 194 118 C198 120 196 130 190 134 C184 140 172 140 168 132z" fill={`url(#${id("skin")})`} />
        </g>
      )}
      {pose === "pointing" && (
        <g>
          <path d="M40 222 C30 206 26 190 30 176" stroke={`url(#${id("coat")})`} strokeWidth="22" strokeLinecap="round" fill="none" />
          <path d="M30 176 L16 168" stroke={`url(#${id("skin")})`} strokeWidth="13" strokeLinecap="round" />
          <path d="M14 166 L4 162" stroke={`url(#${id("skin")})`} strokeWidth="6" strokeLinecap="round" />
        </g>
      )}
      {pose === "thinking" && (
        <g>
          <path d="M150 232 C142 204 128 184 116 168" stroke={`url(#${id("coat")})`} strokeWidth="21" strokeLinecap="round" fill="none" />
          <path d="M104 156 C104 148 112 144 118 148 C124 150 126 160 120 166 C114 170 104 166 104 156z" fill={`url(#${id("skin")})`} />
        </g>
      )}
      {pose === "encouraging" && (
        <g>
          <path d="M164 238 C170 220 170 202 162 188" stroke={`url(#${id("coat")})`} strokeWidth="21" strokeLinecap="round" fill="none" />
          <path d="M150 186 C150 176 158 172 168 174 L172 174 C178 174 178 184 172 186 L168 188 C166 194 156 196 150 192z" fill={`url(#${id("skin")})`} />
          <path d="M160 176 C160 164 162 156 166 154 C170 154 170 162 168 176z" fill={`url(#${id("skin")})`} />
        </g>
      )}
      {pose === "listening" && (
        <g>
          <path d="M178 240 C184 210 176 170 158 138" stroke={`url(#${id("coat")})`} strokeWidth="20" strokeLinecap="round" fill="none" />
          <path d="M146 116 C150 108 160 108 162 116 C166 124 160 134 152 132 C146 130 144 122 146 116z" fill={`url(#${id("skin")})`} />
        </g>
      )}
      {pose === "celebrating" && (
        <g className="asha-confetti">
          {[[24, 70, "#f0bf4c"], [188, 64, "#22bf9b"], [14, 132, "#34abc8"], [198, 128, "#f0bf4c"], [52, 40, "#22bf9b"], [160, 36, "#34abc8"]].map(([x, y, c], i) => (
            <path key={i} d={`M${x} ${Number(y) - 6} l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z`} fill={String(c)} />
          ))}
        </g>
      )}
      {pose === "thinking" && <g fill="#8fdaee"><circle cx="160" cy="62" r="3" /><circle cx="170" cy="50" r="4.2" /><circle cx="183" cy="36" r="5.5" /></g>}
    </svg>
  );
}
