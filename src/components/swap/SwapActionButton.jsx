export default function SwapActionButton({
  canSwap,
  disabled,
  onClick,
  label,
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`mt-3 w-full rounded-full px-4 py-2.5 text-sm font-semibold
      ${canSwap && !disabled
        ? "bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-600/40"
        : "bg-slate-800 text-slate-400"
      } disabled:opacity-70`}
    >
      {label}
    </button>
  );
}
