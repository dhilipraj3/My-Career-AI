export interface HeroJob { title: string; company: string; location: string; pay?: string }

/**
 * The job journey as a rendered glass illustration: resume and profile flow into the AI core, out to scored matches, an
 * interview, and "placed". The picture is prepared by scripts/hero-image.mjs (design/hero-journey-source.png) and served
 * as WebP in three sizes. Its edges fade into the hero background so it never looks like a pasted rectangle, and it
 * drifts very slowly (off for reduced motion and low-data mode). The score in the picture is illustrative; one real,
 * live job is named beneath it.
 */
export default function HeroJourney({ jobs }: { jobs: HeroJob[] }) {
  const job = jobs[0];
  return (
    <div className="hj relative mx-auto w-full max-w-[760px] lg:max-w-none lg:-mr-16 lg:scale-[1.18] xl:-mr-24 xl:scale-[1.28]">
      <div className="hj-glow pointer-events-none absolute inset-[8%] rounded-full" aria-hidden />
      <img
        src="/hero/journey-1600.webp"
        srcSet="/hero/journey-900.webp 900w, /hero/journey-1600.webp 1600w, /hero/journey-2400.webp 2400w"
        sizes="(min-width: 1280px) 760px, (min-width: 1024px) 52vw, 100vw"
        width={2624} height={1632}
        alt="Your resume and profile flow into an AI core, which finds scored job matches, gets you interview-ready, and ends with you placed."
        fetchPriority="high" decoding="async"
        className="hj-img relative h-auto w-full"
      />
      {job && (
        <p className="relative z-10 mx-auto -mt-2 w-fit max-w-full truncate rounded-full border border-emerald-400/30 bg-[#08131c]/80 px-3 py-1 text-xs font-medium text-[#dbe9f0] backdrop-blur">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />Live now: {job.title} · {job.location.split(",")[0]}
        </p>
      )}
    </div>
  );
}
