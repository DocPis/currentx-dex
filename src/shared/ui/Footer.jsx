import React from "react";

const FOOTER_LINKS = {
  docs: "#",
  twitter: "#",
  discord: "#",
  telegram: "#",
};

export default function Footer() {
  const iconClass =
    "h-4 w-4 text-slate-300 group-hover:text-sky-300 transition-colors";

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
      className="group h-9 w-9 rounded-full border border-slate-800 bg-slate-900/60 flex items-center justify-center hover:border-sky-500/50 hover:bg-sky-500/5 transition-all"
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
          <span className="text-slate-300">Built on Sepolia Testnet</span>
          <span className="text-slate-700">•</span>
          <LinkItem href={FOOTER_LINKS.docs}>Docs</LinkItem>
        </div>

        <div className="flex items-center gap-2">
          <IconButton href={FOOTER_LINKS.discord} label="Discord">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={iconClass}
            >
              <path d="M8.5 9.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm8.5 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
              <path d="M16.25 17.25s-1 .75-4.25.75-4.25-.75-4.25-.75M9.5 7.5c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25" />
              <path d="M16 7.5s2 .5 3.5 1.5v6.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9c1.5-1 3.5-1.5 3.5-1.5" />
            </svg>
          </IconButton>
          <IconButton href={FOOTER_LINKS.twitter} label="Twitter / X">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={iconClass}
            >
              <path d="M5 5.5 18.5 19M5.5 19 19 5" />
            </svg>
          </IconButton>
          <IconButton href={FOOTER_LINKS.telegram} label="Telegram">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={iconClass}
            >
              <path d="M19.5 4.5 4.75 10.75c-.89.37-.84 1.65.07 1.95L9.5 14.5l1.75 4.5c.32.83 1.5.87 1.89.05l6.36-13.66c.37-.8-.42-1.66-1.5-1.39Z" />
              <path d="m9.5 14.5 2.5-2.5" />
            </svg>
          </IconButton>
        </div>
      </div>
    </footer>
  );
}
