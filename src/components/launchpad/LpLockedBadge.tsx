import React from "react";
import { Lock } from "lucide-react";

const LpLockedBadge = () => {
  return (
    <span
      title="LP locked"
      aria-label="LP locked"
      className="inline-flex h-6 w-6 flex-none shrink-0 select-none items-center justify-center rounded-full border border-emerald-300/35 bg-emerald-400/12 text-emerald-100"
    >
      <Lock className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">LP locked</span>
    </span>
  );
};

export default React.memo(LpLockedBadge);
