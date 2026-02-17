import { describe, expect, it } from "vitest";
import { id } from "ethers";
import { WETH_ADDRESS } from "../../../shared/config/web3";
import { findActualOutput } from "../swapReceiptUtils";

const TRANSFER_TOPIC = id("Transfer(address,address,uint256)").toLowerCase();
const WETH_WITHDRAWAL_TOPIC = id("Withdrawal(address,uint256)").toLowerCase();
const WETH_DEPOSIT_TOPIC = id("Deposit(address,uint256)").toLowerCase();

const toTopicAddress = (address) =>
  `0x${String(address || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

const toData = (value) => `0x${BigInt(value).toString(16)}`;

describe("findActualOutput", () => {
  it("sums multiple transfer outputs to the same user", () => {
    const user = "0x1111111111111111111111111111111111111111";
    const token = "0x2222222222222222222222222222222222222222";
    const other = "0x3333333333333333333333333333333333333333";

    const receipt = {
      logs: [
        {
          address: token,
          topics: [TRANSFER_TOPIC, toTopicAddress(other), toTopicAddress(user)],
          data: toData(5n),
        },
        {
          address: token,
          topics: [TRANSFER_TOPIC, toTopicAddress(other), toTopicAddress(user)],
          data: toData(2n),
        },
        {
          address: token,
          topics: [TRANSFER_TOPIC, toTopicAddress(other), toTopicAddress(other)],
          data: toData(99n),
        },
      ],
    };

    const actual = findActualOutput(receipt, token, user);
    expect(actual).toBe(7n);
  });

  it("prefers WETH Withdrawal events when captureWithdrawal is enabled", () => {
    const user = "0x1111111111111111111111111111111111111111";
    const router = "0x4444444444444444444444444444444444444444";

    const receipt = {
      logs: [
        {
          address: WETH_ADDRESS,
          topics: [TRANSFER_TOPIC, toTopicAddress(router), toTopicAddress(user)],
          data: toData(12n),
        },
        {
          address: WETH_ADDRESS,
          topics: [WETH_WITHDRAWAL_TOPIC, toTopicAddress(user)],
          data: toData(10n),
        },
      ],
    };

    const actual = findActualOutput(receipt, WETH_ADDRESS, user, {
      captureWithdrawal: true,
    });
    expect(actual).toBe(10n);
  });

  it("prefers WETH Deposit events when captureDeposit is enabled", () => {
    const user = "0x1111111111111111111111111111111111111111";
    const router = "0x4444444444444444444444444444444444444444";

    const receipt = {
      logs: [
        {
          address: WETH_ADDRESS,
          topics: [TRANSFER_TOPIC, toTopicAddress(router), toTopicAddress(user)],
          data: toData(12n),
        },
        {
          address: WETH_ADDRESS,
          topics: [WETH_DEPOSIT_TOPIC, toTopicAddress(user)],
          data: toData(10n),
        },
      ],
    };

    const actual = findActualOutput(receipt, WETH_ADDRESS, user, {
      captureDeposit: true,
    });
    expect(actual).toBe(10n);
  });
});

