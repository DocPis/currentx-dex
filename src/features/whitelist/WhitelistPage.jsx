import React, { useState } from "react";
import currentxLogo from "../../assets/currentxlogo.png";

const PRESALE_ENDPOINT =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_PRESALE_ENDPOINT) ||
  "";

export default function WhitelistPage() {
  const [wallet, setWallet] = useState("");
  const [discord, setDiscord] = useState("");
  const [telegram, setTelegram] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastSubmitAt, setLastSubmitAt] = useState(0);
  const COOLDOWN_MS = 10_000;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");

    if (!discord.trim() && !telegram.trim()) {
      setSubmitError("Please provide at least a Discord or Telegram handle.");
      return;
    }

    const payload = {
      wallet: wallet.trim(),
      discord: discord.trim(),
      telegram: telegram.trim(),
      source: "currentx-presale",
      ts: Date.now(),
    };

    const submit = async () => {
      if (!PRESALE_ENDPOINT) return;
      const resp = await fetch(PRESALE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        let message = "Submission failed. Please try again or contact us on Discord.";
        try {
          const data = await resp.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }
    };

    try {
      const now = Date.now();
      if (now - lastSubmitAt < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - (now - lastSubmitAt)) / 1000);
        setSubmitError(`Please wait ${waitSec}s before submitting again.`);
        return;
      }

      setSubmitting(true);
      await submit();
      setSubmitted(true);
      setLastSubmitAt(Date.now());
      setTimeout(() => setSubmitted(false), 15000);
    } catch (err) {
      setSubmitError(
        err?.message ||
          "Submission failed. Please try again or contact us on Discord."
      );
    } finally {
      setSubmitting(false);
    }
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
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
              Presale whitelist
            </span>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white leading-tight">
              CurrentX Token Presale Access
            </h1>
            <p className="text-sm text-slate-400">
              Lock in your spot for the CurrentX token presale and for community-only drops.
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
                  Priority allocation to buy the CurrentX token in presale, before the public window opens.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                  {[
                    "Priority allocation for the CurrentX token presale.",
                    "Updates on price, phase, and presale time windows.",
                    "Direct channels (Discord/Telegram) for confirmation and claim.",
                    "Future DEX perks: lower fees and early access to new pools.",
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
                Enter your details to be contacted about the CurrentX token presale. We&apos;ll ping you on Discord or
                Telegram when your allocation is confirmed.
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
                  placeholder="0x0000000000000000000000000000000000000000"
                  className="w-full rounded-xl bg-slate-950/70 border border-slate-800 px-3.5 py-3 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500/60 transition"
                />
              </label>

              <label className="flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
                  Discord username
                </div>
                <input
                  value={discord}
                  onChange={(e) => setDiscord(e.target.value)}
                  placeholder="username"
                  className="w-full rounded-xl bg-slate-950/70 border border-slate-800 px-3.5 py-3 text-sm text-slate-50 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500/60 transition"
                />
              </label>

              <label className="flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
                  Telegram username
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
                Slots are limited. Submission does not guarantee allocation until you receive confirmation.
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold text-white bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-600 shadow-[0_12px_40px_-18px_rgba(56,189,248,0.75)] hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Register"}
              </button>
            </div>

            {submitError && (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 shadow-[0_0_20px_rgba(248,113,113,0.25)]">
                {submitError}
              </div>
            )}
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
