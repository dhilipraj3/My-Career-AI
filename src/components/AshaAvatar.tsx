import Asha from "./Asha";
import type { GuidePose } from "../lib/guide";
import { cn } from "../ui";

/** Asha's face in a round frame, for the chat header and her messages. */
export default function AshaAvatar({ pose = "idle", mouthOpen, className }: { pose?: GuidePose; mouthOpen?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-brand-100 to-accent-100 ring-1 ring-brand-200", className)}>
      <Asha pose={pose} mouthOpen={mouthOpen} face className="h-full w-full" />
    </span>
  );
}
