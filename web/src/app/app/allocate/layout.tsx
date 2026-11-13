import { Suspense } from "react";

/** The allocator reads ?plan and ?amount from the URL, which is only known at request time. */
export default function AllocateLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4" aria-busy="true">
          <span className="skeleton h-8 w-1/3" />
          <span className="skeleton h-4 w-2/3" />
          <span className="skeleton h-72 w-full" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
