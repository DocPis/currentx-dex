import React, { useEffect, useMemo, useState } from "react";
import { DEFAULT_TOKEN_LOGO, TOKENS } from "../../shared/config/web3";

interface TokenLogoProps {
  address?: string;
  symbol?: string;
  logoUrl?: string;
  className?: string;
  loading?: "eager" | "lazy";
}

const IPFS_CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[0-9a-z]{20,})$/iu;

const normalizeLogoUrl = (value?: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^data:image\//iu.test(raw)) return raw;
  if (/^https?:\/\//iu.test(raw)) return raw;
  if (/^ipfs:\/\//iu.test(raw)) {
    const hash = raw.replace(/^ipfs:\/\//iu, "").replace(/^ipfs\//iu, "");
    return hash ? `https://gateway.pinata.cloud/ipfs/${hash}` : "";
  }
  if (/^(\/)?ipfs\//iu.test(raw)) {
    const hash = raw.replace(/^(\/)?ipfs\//iu, "");
    return hash ? `https://gateway.pinata.cloud/ipfs/${hash}` : "";
  }
  if (/^ar:\/\//iu.test(raw)) {
    const arId = raw.replace(/^ar:\/\//iu, "").trim();
    return arId ? `https://arweave.net/${arId}` : "";
  }
  if (IPFS_CID_RE.test(raw)) {
    return `https://gateway.pinata.cloud/ipfs/${raw}`;
  }
  return "";
};

const KNOWN_LOGOS_BY_ADDRESS = Object.values(TOKENS || {}).reduce<Record<string, string>>((acc, token) => {
  const address = String(token?.address || "").trim().toLowerCase();
  const logo = String(token?.logo || "").trim();
  if (!address || !logo) return acc;
  acc[address] = logo;
  return acc;
}, {});

const buildCandidates = (address?: string, logoUrl?: string): string[] => {
  const normalized = normalizeLogoUrl(logoUrl);
  const known = address ? KNOWN_LOGOS_BY_ADDRESS[String(address).toLowerCase()] || "" : "";
  const isEffigy = normalized.toLowerCase().includes("effigy.im/");
  const candidates = [
    normalized && !isEffigy ? normalized : "",
    known,
    normalized,
    DEFAULT_TOKEN_LOGO,
  ].filter(Boolean);
  return Array.from(new Set(candidates));
};

const TokenLogo = ({ address, symbol, logoUrl, className, loading = "lazy" }: TokenLogoProps) => {
  const candidates = useMemo(() => buildCandidates(address, logoUrl), [address, logoUrl]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates]);

  const src =
    candidates[Math.max(0, Math.min(candidateIndex, Math.max(0, candidates.length - 1)))] ||
    DEFAULT_TOKEN_LOGO;

  return (
    <img
      src={src}
      alt={`${symbol || "Token"} logo`}
      className={className}
      loading={loading}
      decoding="async"
      onError={() => {
        setCandidateIndex((prev) => Math.min(prev + 1, Math.max(0, candidates.length - 1)));
      }}
    />
  );
};

export default React.memo(TokenLogo);
