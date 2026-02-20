import React from "react";
import { Lock } from "lucide-react";

type TokenStatusBadgeVariant = "lpLocked";

interface TokenStatusBadgeProps {
  variant: TokenStatusBadgeVariant;
}

const BASE_BADGE_CLASS =
  "inline-flex h-6 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-semibold leading-none tracking-[0.01em]";

const VARIANT_MAP: Record<
  TokenStatusBadgeVariant,
  {
    label: string;
    ariaLabel: string;
    className: string;
    Icon: typeof Lock;
  }
> = {
  lpLocked: {
    label: "LP locked",
    ariaLabel: "Token liquidity pool is locked",
    className: "border-emerald-300/35 bg-emerald-400/12 text-emerald-100",
    Icon: Lock,
  },
};

const TokenStatusBadge = ({ variant }: TokenStatusBadgeProps) => {
  const config = VARIANT_MAP[variant];
  const Icon = config.Icon;

  return (
    <span className={`${BASE_BADGE_CLASS} ${config.className}`} aria-label={config.ariaLabel}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="leading-none">{config.label}</span>
    </span>
  );
};

export default React.memo(TokenStatusBadge);
