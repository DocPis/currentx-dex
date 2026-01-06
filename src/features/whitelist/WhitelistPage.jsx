import React, { useState } from "react";
import currentxLogo from "../../assets/currentxlogo.png";

export default function WhitelistPage() {
  const [wallet, setWallet] = useState("");
  const [discord, setDiscord] = useState("");
  const [telegram, setTelegram] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3500);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-50 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -left-24 top-12 h-72 w-72 bg-sky-500/15 blur-[120px]" />
        <div className="absolute right-0 top-0 h-80 w-80 bg-indigo-500/15 blur-[140px]" />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[-160px] h-96 w-96 bg-purple-500/12 blur-[170px]" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="flex items-center gap-3 mb-10">
          <div className="h-14 w-14 rounded-2xl bg-slate-900/80 border border-slate-800 p-2 shadow-lg shadow-black/30">
            <img
              src={currentxLogo}
              alt="CurrentX logo"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
              Presale whitelist
            </span>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white leading-tight">
              CurrentX Token Presale Access
            </h1>
            <p className="text-sm text-slate-400">
              Blocca il tuo posto per la presale di CurrentX e per i drop dedicati alla community.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.05fr] gap-8 items-stretch">
          <div className="relative rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900/80 to-slate-950 border border-slate-800 shadow-2xl shadow-black/40 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.18),transparent_36%),radial-gradient(circle_at_80%_10%,rgba(147,51,234,0.16),transparent_32%)]" />
            <div className="relative p-8 flex flex-col items-center text-center">
              <div className="h-60 w-60 sm:h-72 sm:w-72 rounded-[32px] bg-slate-950/70 border border-slate-800/60 shadow-[0_20px_60px_-30px_rgba(56,189,248,0.65)] flex items-center justify-center">
                <img
                  src={currentxLogo}
                  alt="CurrentX brand mark"
                  className="h-full w-full object-contain drop-shadow-[0_16px_28px_rgba(14,165,233,0.45)]"
                />
              </div>
              <div className="mt-8 space-y-3 w-full max-w-lg">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-[11px] uppercase tracking-[0.16em] text-sky-100 shadow-[0_0_22px_rgba(14,165,233,0.3)]">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
                  Limited allocation
                </div>
                <p className="text-lg font-semibold text-slate-50">
                  Un posto prioritario per acquistare il token CurrentX in presale, prima dell&apos;apertura pubblica.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                  {[
                    "Allocazione prioritaria per la presale del token CurrentX.",
                    "Aggiornamenti su prezzo, fase e finestra temporale della presale.",
                    "Canali diretti (Discord/Telegram) per conferma e claim.",
                    "Benefici futuri su DEX: fee ridotte e accesso anticipato a nuove pool.",
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-200 shadow-inner shadow-black/20"
                    >
                      <span className="mt-1 h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.7)]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="relative rounded-3xl bg-[#0a1229]/90 border border-slate-800 shadow-2xl shadow-black/40 p-6 sm:p-8 backdrop-blur-sm"
          >
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-sky-500/60 to-transparent opacity-70" />
            <div className="mb-8 space-y-1.5">
              <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                Whitelist presale
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Inserisci i tuoi dati per essere contattato sulla presale del token CurrentX. Ti avviseremo su Discord o
                Telegram quando la tua allocazione viene confermata.
              </p>
            </div>

            <div className="space-y-5">
              <label className="flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
                  Wallet address <span className="text-rose-300">*</span>
                </div>
                <input
                  required
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="0x44Ae6939BEDD4F59E0C4Efa9Bc948b83Bcc0564F"
                  className="w-full rounded-xl bg-slate-950/70 border border-slate-800 px-3.5 py-3 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500/60 transition"
                />
              </label>

              <label className="flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
                  Discord username <span className="text-rose-300">*</span>
                </div>
                <input
                  required
                  value={discord}
                  onChange={(e) => setDiscord(e.target.value)}
                  placeholder="username"
                  className="w-full rounded-xl bg-slate-950/70 border border-slate-800 px-3.5 py-3 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500/60 transition"
                />
              </label>

              <label className="flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
                  Telegram username (optional)
                </div>
                <input
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  placeholder="@username"
                  className="w-full rounded-xl bg-slate-950/70 border border-slate-800 px-3.5 py-3 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500/60 transition"
                />
                <p className="text-xs text-slate-500">
                  Prefer Telegram over Discord? Add it so we can ping you when you&apos;re in.
                </p>
              </label>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-slate-400">
                Slot limitati. L&apos;inserimento non garantisce l&apos;allocazione finché non ricevi conferma.
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold text-white bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-600 shadow-[0_12px_40px_-18px_rgba(56,189,248,0.75)] hover:scale-[1.01] active:scale-[0.99] transition"
              >
                Registrati
              </button>
            </div>

            {submitted && (
              <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.25)]">
                Received. We&apos;ll review and follow up through your contact handle.
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
