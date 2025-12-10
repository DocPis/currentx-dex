export default function ApproveButton({ tokenSymbol, onApprove, loading }) {
  return (
    <button
      onClick={onApprove}
      disabled={loading}
      className="mt-4 w-full rounded-full px-4 py-2.5 text-sm font-semibold
                 bg-purple-600 hover:bg-purple-500 text-white 
                 shadow-lg shadow-purple-600/40 disabled:opacity-50"
    >
      {loading ? `Approving ${tokenSymbol}...` : `Approve ${tokenSymbol}`}
    </button>
  );
}
