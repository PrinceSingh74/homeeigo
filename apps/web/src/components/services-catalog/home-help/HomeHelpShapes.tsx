/** Decorative curve + square language on the home-page mint canvas. */
export function HomeHelpShapes({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <span className="absolute -left-20 -top-8 size-64 rounded-[3.5rem] bg-emerald-400/12" />
      <span className="absolute left-28 top-16 size-36 rounded-full bg-teal-300/16" />
      <span className="absolute -right-16 -top-12 size-80 rotate-[14deg] rounded-[3.25rem] bg-emerald-500/8" />
      <span className="absolute right-24 top-1/2 size-20 rounded-2xl bg-teal-400/15" />
      <span className="absolute bottom-10 right-[18%] size-28 rounded-full border border-emerald-500/20" />
      <span className="absolute bottom-16 left-[36%] size-14 rounded-[1.15rem] bg-emerald-400/12" />
      <span className="absolute -bottom-10 left-8 size-44 rounded-full bg-teal-400/10 blur-2xl" />
    </div>
  );
}
