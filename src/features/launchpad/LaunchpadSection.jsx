import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, formatUnits, id, isAddress, parseEther, parseUnits } from "ethers";
import {
  CURRENTX_ADDRESS,
  CURRENTX_VAULT_ADDRESS,
  EXPLORER_BASE_URL,
  LP_LOCKER_V2_ADDRESS,
  MEGAETH_CHAIN_ID_HEX,
  NETWORK_NAME,
  TOKENS,
  WETH_ADDRESS,
  getProvider,
  getReadOnlyProvider,
} from "../../shared/config/web3";
import {
  CURRENTX_ABI,
  CURRENTX_VAULT_ABI,
  ERC20_ABI,
  LP_LOCKER_V2_ABI,
} from "../../shared/config/abis";

const EXPLORER_LABEL = `${NETWORK_NAME} Explorer`;
const DAY = 86400;
const defaultChainId = (() => {
  const parsed = Number.parseInt(String(MEGAETH_CHAIN_ID_HEX || "0x10e6"), 16);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4326;
})();

const shorten = (value) =>
  value && value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || "";

const parseUint = (value, field, fallback = "0") => {
  const raw = String(value ?? "").trim() || fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(`${field} must be an unsigned integer.`);
  return raw;
};

const parseSignedInt24 = (value, field) => {
  const raw = String(value ?? "").trim();
  if (!/^-?\d+$/u.test(raw)) throw new Error(`${field} must be an integer.`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < -8388608 || n > 8388607) {
    throw new Error(`${field} is out of int24 bounds.`);
  }
  return n;
};

const parseEthAmount = (value) => {
  const raw = String(value ?? "0").trim() || "0";
  if (!/^\d+(\.\d+)?$/u.test(raw)) throw new Error("Invalid ETH value.");
  return parseEther(raw);
};

const parseTokenAmount = (value, decimals, label) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${label} is required.`);
  if (!/^\d+(\.\d+)?$/u.test(raw)) throw new Error(`${label} is invalid.`);
  return parseUnits(raw, decimals);
};

const toBytes32Salt = (value, walletAddress) => {
  const raw = String(value ?? "").trim();
  if (/^0x[a-fA-F0-9]{64}$/u.test(raw)) return raw;
  if (raw) return id(raw);
  return id(`currentx-launchpad:${walletAddress || "anon"}:${Date.now()}`);
};

const formatAmount = (value, decimals = 18, max = 6) => {
  try {
    const num = Number(formatUnits(value ?? 0n, decimals));
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString(undefined, { maximumFractionDigits: max });
  } catch {
    return "0";
  }
};

const formatDate = (unix) => {
  if (!unix) return "--";
  const d = new Date(Number(unix) * 1000);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString();
};

const errMsg = (error, fallback) => {
  const raw = error?.shortMessage || error?.reason || error?.message || "";
  const lower = String(raw).toLowerCase();
  const code =
    error?.code ?? error?.info?.error?.code ?? error?.error?.code ?? error?.data?.code ?? null;
  if (code === 4001 || code === "ACTION_REJECTED") return "Transaction rejected in wallet.";
  if (lower.includes("insufficient funds")) return "Insufficient ETH for value + gas.";
  if (lower.includes("execution reverted")) return raw || "Transaction reverted by contract.";
  return raw || fallback || "Transaction failed.";
};

const buildTokenMap = () => {
  const out = {};
  Object.values(TOKENS || {}).forEach((token) => {
    if (!token?.address) return;
    out[token.address.toLowerCase()] = token;
  });
  return out;
};

const KNOWN_TOKENS = buildTokenMap();

function ActionInfo({ state }) {
  if (!state?.error && !state?.hash && !state?.message) return null;
  return (
    <div className="mt-2 space-y-2 text-xs">
      {state.error ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-100">
          {state.error}
        </div>
      ) : null}
      {state.message ? (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sky-100">
          {state.message}
        </div>
      ) : null}
      {state.hash ? (
        <a
          href={`${EXPLORER_BASE_URL}/tx/${state.hash}`}
          target="_blank"
          rel="noreferrer"
          className="text-sky-300 underline hover:text-sky-200"
        >
          View transaction on {EXPLORER_LABEL}
        </a>
      ) : null}
    </div>
  );
}

function AddressField({ label, value, onChange, required = false }) {
  const invalid = required ? !isAddress(value) : value && !isAddress(value);
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="0x..."
        className={`w-full rounded-xl border px-3 py-2 text-sm bg-slate-900 text-slate-100 ${
          invalid ? "border-rose-500/50" : "border-slate-800"
        }`}
      />
    </div>
  );
}

const defaultDeployForm = () => ({
  name: "",
  symbol: "",
  salt: "",
  image: "",
  metadata: "",
  context: "",
  originatingChainId: String(defaultChainId),
  pairedToken: WETH_ADDRESS || "",
  tickIfToken0IsNewToken: "0",
  vaultPercentage: "0",
  vaultDurationDays: "30",
  pairedTokenPoolFee: "3000",
  pairedTokenSwapAmountOutMinimum: "0",
  creatorReward: "0",
  creatorAdmin: "",
  creatorRewardRecipient: "",
  interfaceAdmin: "",
  interfaceRewardRecipient: "",
  txValueEth: "0",
  useCustomTeamRewardRecipient: false,
  teamRewardRecipient: "",
});

const defaultVaultForm = () => ({
  token: "",
  approveAmount: "",
  depositAmount: "",
  depositUnlockAt: "",
  depositAdmin: "",
  withdrawAmount: "",
  withdrawTo: "",
});

export default function LaunchpadSection({ address, onConnect }) {
  const [contracts, setContracts] = useState({
    currentx: CURRENTX_ADDRESS || "",
    vault: CURRENTX_VAULT_ADDRESS || "",
    locker: LP_LOCKER_V2_ADDRESS || "",
  });
  const [protocol, setProtocol] = useState({
    loading: false,
    error: "",
    maxCreatorReward: null,
    maxVaultPercentage: null,
    tickSpacing: null,
    poolFee: null,
    tokenSupply: null,
    weth: "",
  });
  const [deployForm, setDeployForm] = useState(defaultDeployForm);
  const [deployAction, setDeployAction] = useState({ loading: false, error: "", hash: "", message: "" });
  const [deployResult, setDeployResult] = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [deploymentsError, setDeploymentsError] = useState("");
  const [claimAction, setClaimAction] = useState({ loadingKey: "", error: "", hash: "", message: "" });

  const [vaultForm, setVaultForm] = useState(defaultVaultForm);
  const [vaultInfo, setVaultInfo] = useState({ loading: false, error: "", allocation: null, minimumVaultTime: null });
  const [vaultTokenMeta, setVaultTokenMeta] = useState(null);
  const [vaultAction, setVaultAction] = useState({ loadingKey: "", error: "", hash: "", message: "" });

  const [locker, setLocker] = useState({
    loading: false,
    error: "",
    ids: [],
    selectedId: "",
    teamReward: null,
    maxCreatorReward: null,
    tokenReward: null,
  });
  const [lockerAction, setLockerAction] = useState({ loadingKey: "", error: "", hash: "", message: "" });

  const tokenMetaCache = useRef({});

  const resolveTokenMeta = useCallback(async (tokenAddress, providerOverride) => {
    if (!isAddress(tokenAddress)) return null;
    const lower = tokenAddress.toLowerCase();
    if (tokenMetaCache.current[lower]) return tokenMetaCache.current[lower];

    const known = KNOWN_TOKENS[lower];
    if (known) {
      const meta = {
        address: tokenAddress,
        symbol: known.displaySymbol || known.symbol || "TOKEN",
        decimals: Number(known.decimals || 18),
      };
      tokenMetaCache.current[lower] = meta;
      return meta;
    }

    const provider = providerOverride || getReadOnlyProvider(false, true);
    const erc20 = new Contract(tokenAddress, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      erc20.symbol().catch(() => "TOKEN"),
      erc20.decimals().catch(() => 18),
    ]);
    const meta = { address: tokenAddress, symbol: String(symbol || "TOKEN"), decimals: Number(decimals || 18) };
    tokenMetaCache.current[lower] = meta;
    return meta;
  }, []);

  const refreshProtocol = useCallback(async () => {
    if (!isAddress(contracts.currentx)) {
      setProtocol((prev) => ({ ...prev, error: "Set a valid CurrentX address." }));
      return;
    }
    try {
      setProtocol((prev) => ({ ...prev, loading: true, error: "" }));
      const provider = getReadOnlyProvider(false, true);
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, provider);
      const [maxCreatorReward, maxVaultPercentage, tickSpacing, poolFee, tokenSupply, weth] =
        await Promise.all([
          currentx.MAX_CREATOR_REWARD(),
          currentx.MAX_VAULT_PERCENTAGE(),
          currentx.TICK_SPACING(),
          currentx.POOL_FEE(),
          currentx.TOKEN_SUPPLY(),
          currentx.weth(),
        ]);
      setProtocol({
        loading: false,
        error: "",
        maxCreatorReward,
        maxVaultPercentage,
        tickSpacing,
        poolFee,
        tokenSupply,
        weth,
      });
    } catch (error) {
      setProtocol((prev) => ({ ...prev, loading: false, error: errMsg(error, "Unable to load CurrentX constants.") }));
    }
  }, [contracts.currentx]);

  const refreshDeployments = useCallback(async () => {
    if (!address || !isAddress(contracts.currentx)) {
      setDeployments([]);
      return;
    }
    try {
      setDeploymentsLoading(true);
      setDeploymentsError("");
      const provider = getReadOnlyProvider(false, true);
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, provider);
      const list = await currentx.getTokensDeployedByUser(address);
      setDeployments(
        (list || []).map((item) => ({
          token: item.token,
          positionId: String(item.positionId || ""),
          locker: item.locker,
        }))
      );
    } catch (error) {
      setDeployments([]);
      setDeploymentsError(errMsg(error, "Unable to load deployed tokens."));
    } finally {
      setDeploymentsLoading(false);
    }
  }, [address, contracts.currentx]);

  const refreshVault = useCallback(async () => {
    if (!isAddress(contracts.vault) || !isAddress(vaultForm.token)) {
      setVaultInfo((prev) => ({ ...prev, allocation: null, error: "" }));
      setVaultTokenMeta(null);
      return;
    }
    try {
      setVaultInfo((prev) => ({ ...prev, loading: true, error: "" }));
      const provider = getReadOnlyProvider(false, true);
      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, provider);
      const [allocation, minimumVaultTime, meta] = await Promise.all([
        vault.allocation(vaultForm.token),
        vault.minimumVaultTime(),
        resolveTokenMeta(vaultForm.token, provider),
      ]);
      setVaultTokenMeta(meta);
      setVaultInfo({
        loading: false,
        error: "",
        allocation: {
          token: allocation.token,
          amount: allocation.amount,
          endTime: allocation.endTime,
          admin: allocation.admin,
        },
        minimumVaultTime,
      });
    } catch (error) {
      setVaultInfo((prev) => ({ ...prev, loading: false, error: errMsg(error, "Unable to load vault info.") }));
    }
  }, [contracts.vault, resolveTokenMeta, vaultForm.token]);

  const refreshLocker = useCallback(async () => {
    if (!address || !isAddress(contracts.locker)) {
      setLocker({ loading: false, error: "", ids: [], selectedId: "", teamReward: null, maxCreatorReward: null, tokenReward: null });
      return;
    }
    try {
      setLocker((prev) => ({ ...prev, loading: true, error: "" }));
      const provider = getReadOnlyProvider(false, true);
      const lockerContract = new Contract(contracts.locker, LP_LOCKER_V2_ABI, provider);
      const [idsRaw, teamReward, maxCreatorReward] = await Promise.all([
        lockerContract.getLpTokenIdsForCreator(address),
        lockerContract.TEAM_REWARD(),
        lockerContract.MAX_CREATOR_REWARD(),
      ]);
      const ids = (idsRaw || []).map((item) => String(item));
      setLocker((prev) => ({
        ...prev,
        loading: false,
        error: "",
        ids,
        selectedId: prev.selectedId && ids.includes(prev.selectedId) ? prev.selectedId : ids[0] || "",
        teamReward,
        maxCreatorReward,
        tokenReward: null,
      }));
    } catch (error) {
      setLocker((prev) => ({ ...prev, loading: false, error: errMsg(error, "Unable to load locker data."), ids: [], selectedId: "", tokenReward: null }));
    }
  }, [address, contracts.locker]);

  const refreshLockerReward = useCallback(async () => {
    if (!isAddress(contracts.locker) || !locker.selectedId) {
      setLocker((prev) => ({ ...prev, tokenReward: null }));
      return;
    }
    try {
      const provider = getReadOnlyProvider(false, true);
      const lockerContract = new Contract(contracts.locker, LP_LOCKER_V2_ABI, provider);
      const info = await lockerContract.tokenRewards(BigInt(locker.selectedId));
      setLocker((prev) => ({
        ...prev,
        tokenReward: {
          lpTokenId: String(info.lpTokenId || ""),
          creatorReward: info.creatorReward,
          creatorAdmin: info.creator?.admin || "",
          creatorRecipient: info.creator?.recipient || "",
          interfaceAdmin: info.interfacer?.admin || "",
          interfaceRecipient: info.interfacer?.recipient || "",
        },
      }));
    } catch (error) {
      setLocker((prev) => ({ ...prev, error: errMsg(error, "Unable to load selected reward info."), tokenReward: null }));
    }
  }, [contracts.locker, locker.selectedId]);

  useEffect(() => {
    if (!address) return;
    setDeployForm((prev) => ({
      ...prev,
      creatorAdmin: prev.creatorAdmin || address,
      creatorRewardRecipient: prev.creatorRewardRecipient || address,
      interfaceAdmin: prev.interfaceAdmin || address,
      interfaceRewardRecipient: prev.interfaceRewardRecipient || address,
      teamRewardRecipient: prev.teamRewardRecipient || address,
    }));
    setVaultForm((prev) => ({ ...prev, depositAdmin: prev.depositAdmin || address, withdrawTo: prev.withdrawTo || address }));
  }, [address]);

  useEffect(() => {
    refreshProtocol();
  }, [refreshProtocol]);

  useEffect(() => {
    refreshDeployments();
  }, [refreshDeployments]);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  useEffect(() => {
    refreshLocker();
  }, [refreshLocker]);

  useEffect(() => {
    refreshLockerReward();
  }, [refreshLockerReward]);

  useEffect(() => {
    if (protocol.weth && !isAddress(deployForm.pairedToken)) {
      setDeployForm((prev) => ({ ...prev, pairedToken: protocol.weth }));
    }
    if (protocol.poolFee && (!deployForm.pairedTokenPoolFee || deployForm.pairedTokenPoolFee === "3000")) {
      setDeployForm((prev) => ({ ...prev, pairedTokenPoolFee: String(protocol.poolFee) }));
    }
  }, [deployForm.pairedToken, deployForm.pairedTokenPoolFee, protocol.poolFee, protocol.weth]);

  const handleDeploy = async (event) => {
    event.preventDefault();
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    if (!isAddress(contracts.currentx)) {
      setDeployAction({ loading: false, error: "CurrentX address is invalid.", hash: "", message: "" });
      return;
    }

    try {
      setDeployAction({ loading: true, error: "", hash: "", message: "Submitting deployment..." });
      setDeployResult(null);

      const name = String(deployForm.name || "").trim();
      const symbol = String(deployForm.symbol || "").trim();
      if (!name) throw new Error("Token name is required.");
      if (!symbol) throw new Error("Token symbol is required.");
      if (!isAddress(deployForm.pairedToken)) throw new Error("Paired token is invalid.");
      if (!isAddress(deployForm.creatorAdmin)) throw new Error("Creator admin is invalid.");
      if (!isAddress(deployForm.creatorRewardRecipient)) throw new Error("Creator reward recipient is invalid.");
      if (!isAddress(deployForm.interfaceAdmin)) throw new Error("Interface admin is invalid.");
      if (!isAddress(deployForm.interfaceRewardRecipient)) throw new Error("Interface reward recipient is invalid.");
      if (deployForm.useCustomTeamRewardRecipient && !isAddress(deployForm.teamRewardRecipient)) {
        throw new Error("Team reward recipient is invalid.");
      }

      const tick = parseSignedInt24(deployForm.tickIfToken0IsNewToken, "Starting tick");
      const spacing = Number(protocol.tickSpacing || 0);
      if (spacing > 0 && tick % spacing !== 0) {
        throw new Error(`Starting tick must be a multiple of ${spacing}.`);
      }

      const deploymentConfig = {
        tokenConfig: {
          name,
          symbol,
          salt: toBytes32Salt(deployForm.salt, address),
          image: String(deployForm.image || "").trim(),
          metadata: String(deployForm.metadata || "").trim(),
          context: String(deployForm.context || "").trim(),
          originatingChainId: BigInt(parseUint(deployForm.originatingChainId, "Originating chain id")),
        },
        vaultConfig: {
          vaultPercentage: Number(parseUint(deployForm.vaultPercentage, "Vault percentage")),
          vaultDuration: BigInt(Math.floor(Number(parseUint(deployForm.vaultDurationDays, "Vault days")) * DAY)),
        },
        poolConfig: {
          pairedToken: deployForm.pairedToken,
          tickIfToken0IsNewToken: tick,
        },
        initialBuyConfig: {
          pairedTokenPoolFee: Number(parseUint(deployForm.pairedTokenPoolFee, "Paired token pool fee")),
          pairedTokenSwapAmountOutMinimum: BigInt(parseUint(deployForm.pairedTokenSwapAmountOutMinimum, "Initial buy min out")),
        },
        rewardsConfig: {
          creatorReward: BigInt(parseUint(deployForm.creatorReward, "Creator reward")),
          creatorAdmin: deployForm.creatorAdmin,
          creatorRewardRecipient: deployForm.creatorRewardRecipient,
          interfaceAdmin: deployForm.interfaceAdmin,
          interfaceRewardRecipient: deployForm.interfaceRewardRecipient,
        },
      };

      const txValue = parseEthAmount(deployForm.txValueEth);
      const overrides = txValue > 0n ? { value: txValue } : {};

      const provider = await getProvider();
      const signer = await provider.getSigner();
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, signer);
      const tx = deployForm.useCustomTeamRewardRecipient
        ? await currentx.deployTokenWithCustomTeamRewardRecipient(
            deploymentConfig,
            deployForm.teamRewardRecipient,
            overrides
          )
        : await currentx.deployToken(deploymentConfig, overrides);

      setDeployAction({ loading: true, error: "", hash: tx.hash || "", message: "Waiting confirmation..." });
      const receipt = await tx.wait();

      let tokenAddress = "";
      let positionId = "";
      try {
        for (const log of receipt.logs || []) {
          const parsed = currentx.interface.parseLog(log);
          if (parsed?.name !== "TokenCreated") continue;
          tokenAddress = parsed.args?.tokenAddress || "";
          positionId = String(parsed.args?.positionId || "");
          break;
        }
      } catch {
        // ignore log parsing failures
      }

      if (!tokenAddress) {
        try {
          const list = await currentx.getTokensDeployedByUser(address);
          const latest = list?.[list.length - 1];
          tokenAddress = latest?.token || "";
          positionId = String(latest?.positionId || "");
        } catch {
          // ignore
        }
      }

      setDeployResult({ tokenAddress, positionId, txHash: receipt.hash || tx.hash || "" });
      setDeployAction({ loading: false, error: "", hash: receipt.hash || tx.hash || "", message: "Token deployed." });
      await Promise.all([refreshDeployments(), refreshLocker()]);
    } catch (error) {
      setDeployAction({ loading: false, error: errMsg(error, "Deploy failed."), hash: "", message: "" });
    }
  };

  const handleClaimRewards = async (tokenAddress) => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setClaimAction({ loadingKey: tokenAddress.toLowerCase(), error: "", hash: "", message: "Claiming rewards..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, signer);
      const tx = await currentx.claimRewards(tokenAddress);
      const receipt = await tx.wait();
      setClaimAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Rewards claimed." });
    } catch (error) {
      setClaimAction({ loadingKey: "", error: errMsg(error, "Claim failed."), hash: "", message: "" });
    }
  };

  const handleVaultApprove = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setVaultAction({ loadingKey: "approve", error: "", hash: "", message: "Approving vault..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const meta = await resolveTokenMeta(vaultForm.token, provider);
      const amount = parseTokenAmount(vaultForm.approveAmount, meta.decimals, "Approve amount");
      const erc20 = new Contract(vaultForm.token, ERC20_ABI, signer);
      const tx = await erc20.approve(contracts.vault, amount);
      const receipt = await tx.wait();
      setVaultAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Allowance updated." });
    } catch (error) {
      setVaultAction({ loadingKey: "", error: errMsg(error, "Approve failed."), hash: "", message: "" });
    }
  };

  const handleVaultDeposit = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setVaultAction({ loadingKey: "deposit", error: "", hash: "", message: "Depositing..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const meta = await resolveTokenMeta(vaultForm.token, provider);
      const amount = parseTokenAmount(vaultForm.depositAmount, meta.decimals, "Deposit amount");
      const unlockMs = Date.parse(vaultForm.depositUnlockAt || "");
      if (!Number.isFinite(unlockMs)) throw new Error("Unlock date is invalid.");
      const unlockTime = Math.floor(unlockMs / 1000);
      const now = Math.floor(Date.now() / 1000);
      if (unlockTime <= now) throw new Error("Unlock date must be in the future.");
      const minTime = Number(vaultInfo.minimumVaultTime || 0n);
      if (minTime > 0 && unlockTime - now < minTime) {
        throw new Error(`Unlock date must be at least ${minTime} seconds from now.`);
      }
      const admin = vaultForm.depositAdmin || address;
      if (!isAddress(admin)) throw new Error("Deposit admin is invalid.");

      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, signer);
      const tx = await vault.deposit(vaultForm.token, amount, unlockTime, admin);
      const receipt = await tx.wait();
      setVaultAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Deposit completed." });
      await refreshVault();
    } catch (error) {
      setVaultAction({ loadingKey: "", error: errMsg(error, "Deposit failed."), hash: "", message: "" });
    }
  };

  const handleVaultWithdraw = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setVaultAction({ loadingKey: "withdraw", error: "", hash: "", message: "Withdrawing..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const meta = await resolveTokenMeta(vaultForm.token, provider);
      const amount = parseTokenAmount(vaultForm.withdrawAmount, meta.decimals, "Withdraw amount");
      const to = vaultForm.withdrawTo || address;
      if (!isAddress(to)) throw new Error("Withdraw recipient is invalid.");

      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, signer);
      const tx = await vault.withdraw(vaultForm.token, amount, to);
      const receipt = await tx.wait();
      setVaultAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Withdraw completed." });
      await refreshVault();
    } catch (error) {
      setVaultAction({ loadingKey: "", error: errMsg(error, "Withdraw failed."), hash: "", message: "" });
    }
  };

  const handleCollectLocker = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    if (!locker.selectedId) {
      setLockerAction({ loadingKey: "", error: "Select LP token ID first.", hash: "", message: "" });
      return;
    }
    try {
      setLockerAction({ loadingKey: "collect", error: "", hash: "", message: "Collecting fees..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const lockerContract = new Contract(contracts.locker, LP_LOCKER_V2_ABI, signer);
      const tx = await lockerContract.collectRewards(BigInt(locker.selectedId));
      const receipt = await tx.wait();
      setLockerAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Fees collected." });
      await refreshLockerReward();
    } catch (error) {
      setLockerAction({ loadingKey: "", error: errMsg(error, "Collect failed."), hash: "", message: "" });
    }
  };

  const invalidAddressCount = useMemo(
    () => [contracts.currentx, contracts.vault, contracts.locker].filter((v) => !isAddress(v)).length,
    [contracts.currentx, contracts.vault, contracts.locker]
  );

  return (
    <section className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Launchpad</h2>
          <p className="text-sm text-slate-400">
            Deploy token + V3 setup through CurrentX, then manage CurrentxVault and LpLockerv2.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              refreshProtocol();
              refreshDeployments();
              refreshVault();
              refreshLocker();
            }}
            className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200"
          >
            Refresh all
          </button>
          {!address ? (
            <button
              type="button"
              onClick={onConnect}
              className="rounded-full border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-100"
            >
              Connect wallet
            </button>
          ) : (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100">
              {shorten(address)}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="text-sm font-semibold text-slate-100">Contract addresses</div>
        <div className="mt-1 text-xs text-slate-400">
          {invalidAddressCount > 0 ? `${invalidAddressCount} invalid/missing address(es).` : "All addresses are valid."}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <AddressField
            label="CurrentX"
            value={contracts.currentx}
            onChange={(value) => setContracts((prev) => ({ ...prev, currentx: value }))}
            required
          />
          <AddressField
            label="CurrentxVault"
            value={contracts.vault}
            onChange={(value) => setContracts((prev) => ({ ...prev, vault: value }))}
            required
          />
          <AddressField
            label="LpLockerv2"
            value={contracts.locker}
            onChange={(value) => setContracts((prev) => ({ ...prev, locker: value }))}
            required
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Deploy Token</div>
              <div className="text-xs text-slate-400">`deployToken` / `deployTokenWithCustomTeamRewardRecipient`</div>
            </div>
            {protocol.loading ? <span className="text-xs text-slate-400">Loading...</span> : null}
          </div>

          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">MAX_CREATOR_REWARD: {protocol.maxCreatorReward ? String(protocol.maxCreatorReward) : "--"}</div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">MAX_VAULT_PERCENTAGE: {protocol.maxVaultPercentage ? String(protocol.maxVaultPercentage) : "--"}</div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">TICK_SPACING: {protocol.tickSpacing ? String(protocol.tickSpacing) : "--"}</div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">POOL_FEE: {protocol.poolFee ? String(protocol.poolFee) : "--"}</div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 md:col-span-2">TOKEN_SUPPLY: {protocol.tokenSupply ? formatAmount(protocol.tokenSupply, 18, 2) : "--"}</div>
          </div>
          {protocol.error ? (
            <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{protocol.error}</div>
          ) : null}

          <form className="mt-4 space-y-3" onSubmit={handleDeploy}>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={deployForm.name}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Token name"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.symbol}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                placeholder="Symbol"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.salt}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, salt: e.target.value }))}
                placeholder="Salt"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.originatingChainId}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, originatingChainId: e.target.value }))}
                placeholder="Originating chain id"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.image}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, image: e.target.value }))}
                placeholder="Image URI"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.metadata}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, metadata: e.target.value }))}
                placeholder="Metadata URI"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
            </div>

            <input
              value={deployForm.context}
              onChange={(e) => setDeployForm((prev) => ({ ...prev, context: e.target.value }))}
              placeholder="Context"
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
            />

            <div className="grid gap-3 md:grid-cols-2">
              <AddressField
                label="Paired token"
                value={deployForm.pairedToken}
                onChange={(value) => setDeployForm((prev) => ({ ...prev, pairedToken: value }))}
                required
              />
              <input
                value={deployForm.tickIfToken0IsNewToken}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, tickIfToken0IsNewToken: e.target.value }))}
                placeholder="Starting tick"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.vaultPercentage}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, vaultPercentage: e.target.value }))}
                placeholder="Vault %"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.vaultDurationDays}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, vaultDurationDays: e.target.value }))}
                placeholder="Vault days"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.pairedTokenPoolFee}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, pairedTokenPoolFee: e.target.value }))}
                placeholder="Paired pool fee"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.pairedTokenSwapAmountOutMinimum}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, pairedTokenSwapAmountOutMinimum: e.target.value }))}
                placeholder="Initial buy min out (raw)"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={deployForm.creatorReward}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, creatorReward: e.target.value }))}
                placeholder="Creator reward (raw)"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                value={deployForm.txValueEth}
                onChange={(e) => setDeployForm((prev) => ({ ...prev, txValueEth: e.target.value }))}
                placeholder="Tx value ETH"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <AddressField
                label="Creator admin"
                value={deployForm.creatorAdmin}
                onChange={(value) => setDeployForm((prev) => ({ ...prev, creatorAdmin: value }))}
                required
              />
              <AddressField
                label="Creator reward recipient"
                value={deployForm.creatorRewardRecipient}
                onChange={(value) => setDeployForm((prev) => ({ ...prev, creatorRewardRecipient: value }))}
                required
              />
              <AddressField
                label="Interface admin"
                value={deployForm.interfaceAdmin}
                onChange={(value) => setDeployForm((prev) => ({ ...prev, interfaceAdmin: value }))}
                required
              />
              <AddressField
                label="Interface reward recipient"
                value={deployForm.interfaceRewardRecipient}
                onChange={(value) => setDeployForm((prev) => ({ ...prev, interfaceRewardRecipient: value }))}
                required
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={deployForm.useCustomTeamRewardRecipient}
                onChange={(e) =>
                  setDeployForm((prev) => ({ ...prev, useCustomTeamRewardRecipient: e.target.checked }))
                }
              />
              Use custom team reward recipient
            </label>
            {deployForm.useCustomTeamRewardRecipient ? (
              <AddressField
                label="Team reward recipient"
                value={deployForm.teamRewardRecipient}
                onChange={(value) => setDeployForm((prev) => ({ ...prev, teamRewardRecipient: value }))}
                required
              />
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeployForm(defaultDeployForm())}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={deployAction.loading}
                className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 disabled:opacity-60"
              >
                {deployAction.loading ? "Deploying..." : "Deploy token"}
              </button>
            </div>
          </form>

          {deployResult ? (
            <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              <div>Token: {deployResult.tokenAddress || "--"}</div>
              <div>Position ID: {deployResult.positionId || "--"}</div>
            </div>
          ) : null}
          <ActionInfo state={deployAction} />
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">My Deployments</div>
              <div className="text-xs text-slate-400">`getTokensDeployedByUser` + `claimRewards`</div>
            </div>
            <button
              type="button"
              onClick={refreshDeployments}
              className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs"
            >
              Reload
            </button>
          </div>

          {deploymentsError ? (
            <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{deploymentsError}</div>
          ) : null}

          {deploymentsLoading ? <div className="mt-3 text-sm text-slate-400">Loading...</div> : null}
          {!deploymentsLoading && address && deployments.length === 0 ? (
            <div className="mt-3 text-sm text-slate-400">No deployments found for this wallet.</div>
          ) : null}
          {!address ? <div className="mt-3 text-sm text-slate-400">Connect wallet to load deployments.</div> : null}

          <div className="mt-3 space-y-2">
            {deployments.map((item) => (
              <div key={`${item.token}-${item.positionId}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-xs text-slate-500">Token</div>
                <div className="font-mono text-sm break-all">{item.token}</div>
                <div className="mt-1 text-xs text-slate-300">Position ID: {item.positionId || "--"}</div>
                <div className="text-xs text-slate-300">Locker: {item.locker || "--"}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={claimAction.loadingKey === item.token.toLowerCase()}
                    onClick={() => handleClaimRewards(item.token)}
                    className="rounded-full border border-sky-500/50 bg-sky-500/10 px-3 py-1 text-xs text-sky-100 disabled:opacity-60"
                  >
                    {claimAction.loadingKey === item.token.toLowerCase() ? "Claiming..." : "Claim rewards"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVaultForm((prev) => ({ ...prev, token: item.token }))}
                    className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs"
                  >
                    Use in vault
                  </button>
                </div>
              </div>
            ))}
          </div>
          <ActionInfo state={claimAction} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">CurrentxVault</div>
              <div className="text-xs text-slate-400">`allocation`, `deposit`, `withdraw`</div>
            </div>
            <button
              type="button"
              onClick={refreshVault}
              className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs"
            >
              Reload
            </button>
          </div>

          <div className="mt-3 space-y-3">
            <AddressField
              label="Token"
              value={vaultForm.token}
              onChange={(value) => setVaultForm((prev) => ({ ...prev, token: value }))}
              required
            />
            <div className="text-xs text-slate-400">
              Token meta: {vaultTokenMeta ? `${vaultTokenMeta.symbol} (${vaultTokenMeta.decimals} decimals)` : "--"}
            </div>
            {vaultInfo.error ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{vaultInfo.error}</div>
            ) : null}

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-200 space-y-1">
              <div>
                Allocation amount: {vaultInfo.allocation ? `${formatAmount(vaultInfo.allocation.amount, vaultTokenMeta?.decimals || 18, 6)} ${vaultTokenMeta?.symbol || ""}` : "--"}
              </div>
              <div>Unlock time: {vaultInfo.allocation ? formatDate(vaultInfo.allocation.endTime) : "--"}</div>
              <div>Admin: {vaultInfo.allocation?.admin ? shorten(vaultInfo.allocation.admin) : "--"}</div>
              <div>Minimum vault time: {vaultInfo.minimumVaultTime ? `${vaultInfo.minimumVaultTime}s` : "--"}</div>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                value={vaultForm.approveAmount}
                onChange={(e) => setVaultForm((prev) => ({ ...prev, approveAmount: e.target.value }))}
                placeholder="Approve amount"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleVaultApprove}
                disabled={vaultAction.loadingKey === "approve"}
                className="rounded-xl border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 disabled:opacity-60"
              >
                {vaultAction.loadingKey === "approve" ? "Approving..." : "Approve"}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <input
                value={vaultForm.depositAmount}
                onChange={(e) => setVaultForm((prev) => ({ ...prev, depositAmount: e.target.value }))}
                placeholder="Deposit amount"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <input
                type="datetime-local"
                value={vaultForm.depositUnlockAt}
                onChange={(e) => setVaultForm((prev) => ({ ...prev, depositUnlockAt: e.target.value }))}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <AddressField
                label="Deposit admin"
                value={vaultForm.depositAdmin}
                onChange={(value) => setVaultForm((prev) => ({ ...prev, depositAdmin: value }))}
                required
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleVaultDeposit}
                disabled={vaultAction.loadingKey === "deposit"}
                className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 disabled:opacity-60"
              >
                {vaultAction.loadingKey === "deposit" ? "Depositing..." : "Deposit"}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <input
                value={vaultForm.withdrawAmount}
                onChange={(e) => setVaultForm((prev) => ({ ...prev, withdrawAmount: e.target.value }))}
                placeholder="Withdraw amount"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              />
              <AddressField
                label="Withdraw recipient"
                value={vaultForm.withdrawTo}
                onChange={(value) => setVaultForm((prev) => ({ ...prev, withdrawTo: value }))}
                required
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleVaultWithdraw}
                disabled={vaultAction.loadingKey === "withdraw"}
                className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 disabled:opacity-60"
              >
                {vaultAction.loadingKey === "withdraw" ? "Withdrawing..." : "Withdraw"}
              </button>
            </div>
          </div>
          <ActionInfo state={vaultAction} />
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">LpLockerv2</div>
              <div className="text-xs text-slate-400">`getLpTokenIdsForCreator`, `tokenRewards`, `collectRewards`</div>
            </div>
            <button
              type="button"
              onClick={refreshLocker}
              className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs"
            >
              Reload
            </button>
          </div>

          {locker.error ? (
            <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{locker.error}</div>
          ) : null}

          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">TEAM_REWARD: {locker.teamReward ? String(locker.teamReward) : "--"}</div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">MAX_CREATOR_REWARD: {locker.maxCreatorReward ? String(locker.maxCreatorReward) : "--"}</div>
          </div>

          <div className="mt-3 space-y-3">
            <select
              value={locker.selectedId}
              onChange={(e) => setLocker((prev) => ({ ...prev, selectedId: e.target.value }))}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
            >
              {!locker.ids.length ? <option value="">No LP token IDs</option> : null}
              {locker.ids.map((tokenId) => (
                <option key={tokenId} value={tokenId}>
                  {tokenId}
                </option>
              ))}
            </select>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-200 space-y-1">
              <div>Creator reward: {locker.tokenReward ? String(locker.tokenReward.creatorReward) : "--"}</div>
              <div>Creator admin: {locker.tokenReward?.creatorAdmin || "--"}</div>
              <div>Creator recipient: {locker.tokenReward?.creatorRecipient || "--"}</div>
              <div>Interface admin: {locker.tokenReward?.interfaceAdmin || "--"}</div>
              <div>Interface recipient: {locker.tokenReward?.interfaceRecipient || "--"}</div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCollectLocker}
                disabled={lockerAction.loadingKey === "collect" || !locker.selectedId}
                className="rounded-xl border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 disabled:opacity-60"
              >
                {lockerAction.loadingKey === "collect" ? "Collecting..." : "Collect rewards"}
              </button>
            </div>
          </div>

          <ActionInfo state={lockerAction} />
        </div>
      </div>
    </section>
  );
}
