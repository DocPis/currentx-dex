import React from "react";
import discordIcon from "../../assets/social/discord.png";
import twitterIcon from "../../assets/social/x.png";
import telegramIcon from "../../assets/social/telegram.png";

const FOOTER_LINKS = {
  docs: "https://docs.currentx.app/",
  twitter: "https://x.com/currentxdex",
  discord: "https://discord.gg/g33rC3RT",
  telegram: "https://t.co/VLEkH8Z2fD",
};

export default function Footer() {
  const LinkItem = ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sm text-slate-300 hover:text-sky-300 transition-colors"
    >
      {children}
    </a>
  );

  const IconButton = ({ href, label, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group h-10 w-10 rounded-full border border-slate-800 bg-slate-900/60 flex items-center justify-center hover:border-sky-500/50 hover:bg-sky-500/5 transition-all overflow-hidden"
      aria-label={label}
      title={label}
    >
      {children}
    </a>
  );

  return (
    <footer className="mt-10 border-t border-slate-800 bg-[#050915]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span className="text-slate-300">Built on MegaETH</span>
          <span className="text-slate-700">|</span>
          <LinkItem href={FOOTER_LINKS.docs}>Docs</LinkItem>
        </div>

        <div className="flex items-center gap-2">
          <IconButton href={FOOTER_LINKS.discord} label="Discord">
            <img
              src={discordIcon}
              alt="Discord"
              className="h-full w-full object-contain"
              style={{ transform: "scale(1.3)" }}
            />
          </IconButton>
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
      </div>
    </footer>
  );
}
