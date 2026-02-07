import React from "react";
import discordIcon from "../../assets/social/discord.png";
import twitterIcon from "../../assets/social/x.png";
import telegramIcon from "../../assets/social/telegram.png";
import geckoTerminalIcon from "../../assets/social/geckoterminal.svg";
import megaLogo from "../../tokens/megaeth.png";
import {
  GECKOTERMINAL_URL,
  SHOW_GECKOTERMINAL_ATTRIBUTION,
} from "./GeckoTerminalAttribution";

const FOOTER_LINKS = {
  docs: "https://docs.currentx.app/",
  twitter: "https://x.com/currentxdex",
  discord: "https://discord.gg/hebSwdXwVv",
  telegram: "https://t.co/VLEkH8Z2fD",
};

const LinkItem = ({ href, children, external = true }) => {
  const handleClick = (event) => {
    if (external || typeof window === "undefined") return;
    event.preventDefault();
    const target = href?.startsWith?.("/") ? href : `/${href || ""}`;
    if (window.location.pathname === target) return;
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
  <a
    href={href}
    target={external ? "_blank" : undefined}
    rel={external ? "noreferrer" : undefined}
    onClick={handleClick}
    className="text-sm text-slate-300 hover:text-sky-300 transition-colors"
  >
    {children}
  </a>
  );
};

const IconButton = ({ href, label, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="group h-10 w-10 rounded-full border border-slate-800 bg-slate-900/60 flex items-center justify-center hover:border-sky-500/50 hover:bg-sky-500/5 transition-all overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    aria-label={label}
    title={label}
  >
    {children}
  </a>
);

export default function Footer() {
  return (
    <footer className="mt-10 border-t border-slate-800 bg-[#050915]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span className="inline-flex items-center gap-1 text-slate-300">
            Built on
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 p-0.5">
              <img src={megaLogo} alt="MegaETH" className="h-full w-full" />
            </span>
          </span>
          <span className="text-slate-700">|</span>
          <LinkItem href={FOOTER_LINKS.docs}>Docs</LinkItem>
          <LinkItem href="/about" external={false}>
            About
          </LinkItem>
        </div>

        <div className="flex w-full flex-col items-center gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full items-center justify-center gap-2 sm:w-auto sm:justify-end">
            <IconButton href={FOOTER_LINKS.discord} label="Discord">
              <img
                src={discordIcon}
                alt="Discord"
                className="h-full w-full object-contain"
                style={{ transform: "scale(1.3)" }}
              />
            </IconButton>
            {SHOW_GECKOTERMINAL_ATTRIBUTION && (
              <IconButton href={GECKOTERMINAL_URL} label="GeckoTerminal">
                <img
                  src={geckoTerminalIcon}
                  alt="GeckoTerminal"
                  className="h-full w-full object-contain"
                  style={{ transform: "scale(1.4)" }}
                />
              </IconButton>
            )}
            <IconButton href={FOOTER_LINKS.twitter} label="Twitter / X">
              <img
                src={twitterIcon}
                alt="Twitter / X"
                className="h-full w-full object-contain"
                style={{ transform: "scale(1.35)" }}
              />
            </IconButton>
            <IconButton href={FOOTER_LINKS.telegram} label="Telegram">
              <img
                src={telegramIcon}
                alt="Telegram"
                className="h-full w-full object-contain"
                style={{ transform: "scale(1.7)" }}
              />
            </IconButton>
          </div>
          {SHOW_GECKOTERMINAL_ATTRIBUTION && (
            <div className="w-full text-[12px] text-slate-300/70 text-center sm:w-auto sm:text-right">
              Powered by GeckoTerminal
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
