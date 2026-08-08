// src/components/__tests__/Header.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { testnetBradbury } from "genlayer-js/chains";
import { GrantOSProvider, useGrantOS } from "../../context/GrantOSContext";
import Header from "../Header";

function TestHarness() {
  const { contractAddress } = useGrantOS();
  return (
    <>
      <Header />
      <div data-testid="observed-address">{contractAddress}</div>
    </>
  );
}

const BRADBURY_CHAIN_ID = `0x${testnetBradbury.id.toString(16)}`;

function makeMockEthereum(initialAddress, overrides = {}) {
  const listeners = {};
  return {
    request: vi.fn((args) => {
      if (overrides[args.method]) return overrides[args.method](args);
      if (args.method === "eth_requestAccounts") return Promise.resolve([initialAddress]);
      if (args.method === "eth_chainId") return Promise.resolve(BRADBURY_CHAIN_ID);
      if (args.method === "wallet_revokePermissions") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    }),
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    removeListener: vi.fn(),
    __trigger: (event, ...args) => listeners[event]?.(...args),
  };
}

const ORIGINAL_ETHEREUM = global.window.ethereum;

beforeEach(() => {
  delete global.window.ethereum;
});

afterEach(() => {
  global.window.ethereum = ORIGINAL_ETHEREUM;
});

describe("Header — branding", () => {
  it("renders the brand mark icon alongside the GrantOS title", () => {
    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    expect(document.querySelector(".brand-mark")).toBeInTheDocument();
    expect(screen.getByText("GrantOS")).toBeInTheDocument();
  });
});

describe("Header — wallet connection", () => {
  it("shows a clear error when no injected wallet is present", async () => {
    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));
    await waitFor(() => {
      expect(screen.getByText(/No wallet found/i)).toBeInTheDocument();
    });
  });

  it("connects and displays a truncated address, replacing Connect with a Disconnect button", async () => {
    const fakeAddress = "0x1234567890abcdef1234567890abcdef12345678";
    global.window.ethereum = makeMockEthereum(fakeAddress);

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );

    fireEvent.click(screen.getByTestId("connect-btn"));

    await waitFor(() => {
      expect(global.window.ethereum.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    });
    expect(global.window.ethereum.request).toHaveBeenCalledWith({ method: "eth_chainId" });
    expect(global.window.ethereum.request).not.toHaveBeenCalledWith({ method: "wallet_getSnaps" });
    await waitFor(() => {
      expect(screen.getByTestId("account-pill").textContent).toMatch(/0x1234…5678/);
    });
    expect(screen.getByTestId("disconnect-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("connect-btn")).not.toBeInTheDocument();
  });

  it("connects when wallet_getSnaps is unsupported because wallet connection no longer requests it", async () => {
    const fakeAddress = "0x1234567890abcdef1234567890abcdef12345678";
    global.window.ethereum = makeMockEthereum(fakeAddress, {
      wallet_getSnaps: () => Promise.reject(new Error("method wallet_getSnaps doesn't have a corresponding handler")),
    });

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));

    await waitFor(() => expect(screen.getByTestId("account-pill")).toBeInTheDocument());
    expect(global.window.ethereum.request).not.toHaveBeenCalledWith({ method: "wallet_getSnaps" });
  });

  it("switches an existing wallet network to Bradbury", async () => {
    const fakeAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const switchNetwork = vi.fn().mockResolvedValue(undefined);
    global.window.ethereum = makeMockEthereum(fakeAddress, {
      eth_chainId: () => Promise.resolve("0x1"),
      wallet_switchEthereumChain: switchNetwork,
    });

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));

    await waitFor(() => expect(screen.getByTestId("account-pill")).toBeInTheDocument());
    expect(switchNetwork).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BRADBURY_CHAIN_ID }],
    });
  });

  it("adds Bradbury when the wallet does not know the chain yet", async () => {
    const fakeAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const missingChainError = Object.assign(new Error("Unrecognized chain"), { code: 4902 });
    const switchNetwork = vi.fn().mockRejectedValueOnce(missingChainError).mockResolvedValue(undefined);
    const addNetwork = vi.fn().mockResolvedValue(undefined);
    global.window.ethereum = makeMockEthereum(fakeAddress, {
      eth_chainId: () => Promise.resolve("0x1"),
      wallet_switchEthereumChain: switchNetwork,
      wallet_addEthereumChain: addNetwork,
    });

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));

    await waitFor(() => expect(screen.getByTestId("account-pill")).toBeInTheDocument());
    expect(addNetwork).toHaveBeenCalledWith({
      method: "wallet_addEthereumChain",
      params: [
        expect.objectContaining({
          chainId: BRADBURY_CHAIN_ID,
          rpcUrls: expect.any(Array),
          nativeCurrency: expect.objectContaining({ symbol: "GEN" }),
        }),
      ],
    });
    expect(switchNetwork).toHaveBeenCalledTimes(2);
  });

  it("propagates a wallet rejection as a visible error instead of failing silently", async () => {
    global.window.ethereum = makeMockEthereum(undefined, {
      eth_requestAccounts: () => Promise.reject(new Error("User rejected the request")),
    });

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));

    await waitFor(() => {
      expect(screen.getByText(/User rejected the request/)).toBeInTheDocument();
    });
  });

  it("updates shared context contractAddress as the user types (visible to every tab)", async () => {
    const user = userEvent.setup();
    render(
      <GrantOSProvider>
        <TestHarness />
      </GrantOSProvider>
    );
    await user.type(screen.getByTestId("contract-address-input"), "0xDEADBEEF");
    expect(screen.getByTestId("observed-address").textContent).toBe("0xDEADBEEF");
  });

  it("shows a visible hint when the contract address is malformed", async () => {
    const user = userEvent.setup();
    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    await user.type(screen.getByTestId("contract-address-input"), "not-a-real-address");
    expect(screen.getByTestId("contract-address-invalid-hint")).toBeInTheDocument();
  });

  it("shows no hint once the contract address is a properly formatted address", async () => {
    const user = userEvent.setup();
    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    await user.type(screen.getByTestId("contract-address-input"), "0x1234567890123456789012345678901234567890");
    expect(screen.queryByTestId("contract-address-invalid-hint")).not.toBeInTheDocument();
  });
});

describe("Header — wallet disconnect (real, user-initiated)", () => {
  // These test the actual disconnect feature: a real EIP-2255
  // wallet_revokePermissions call (MetaMask's own documented mechanism for a
  // dApp-initiated "log out"), with local state always cleared regardless of
  // whether the wallet supports that call.

  it("calls wallet_revokePermissions and returns to the disconnected state when the wallet supports it", async () => {
    const addr = "0x1111111111111111111111111111111111111a";
    const revokeSpy = vi.fn().mockResolvedValue(undefined);
    global.window.ethereum = makeMockEthereum(addr, {
      wallet_revokePermissions: (args) => revokeSpy(args),
    });

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));
    await waitFor(() => expect(screen.getByTestId("disconnect-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("disconnect-btn"));

    await waitFor(() => {
      expect(revokeSpy).toHaveBeenCalledWith({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("connect-btn")).toBeInTheDocument();
      expect(screen.getByTestId("connect-btn").textContent).toBe("Connect Wallet");
    });
    expect(screen.queryByTestId("account-pill")).not.toBeInTheDocument();
    expect(screen.queryByTestId("disconnect-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("wallet-notice").textContent).toMatch(/^Wallet disconnected\.$/);
  });

  it("still clears local state and returns to Connect Wallet even if the wallet doesn't support wallet_revokePermissions", async () => {
    const addr = "0x1111111111111111111111111111111111111a";
    global.window.ethereum = makeMockEthereum(addr, {
      wallet_revokePermissions: () => Promise.reject(new Error("Method not supported")),
    });

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));
    await waitFor(() => expect(screen.getByTestId("disconnect-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("disconnect-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("connect-btn")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("account-pill")).not.toBeInTheDocument();
    // Still tells the truth: this wallet doesn't support real revocation.
    expect(screen.getByTestId("wallet-notice").textContent).toMatch(/doesn't support revoking permissions/i);
  });

  it("shows 'Disconnecting…' while the request is in flight", async () => {
    const addr = "0x1111111111111111111111111111111111111a";
    let resolveRevoke;
    global.window.ethereum = makeMockEthereum(addr, {
      wallet_revokePermissions: () => new Promise((resolve) => { resolveRevoke = resolve; }),
    });

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));
    await waitFor(() => expect(screen.getByTestId("disconnect-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("disconnect-btn"));
    await waitFor(() => expect(screen.getByTestId("disconnect-btn").textContent).toBe("Disconnecting…"));

    resolveRevoke();
    await waitFor(() => expect(screen.getByTestId("connect-btn")).toBeInTheDocument());
  });

  it("does nothing (no crash) if disconnect is somehow triggered with no wallet present", async () => {
    // Defensive case: shouldn't be reachable via the UI (button only shows
    // when connected), but the underlying disconnectWallet() API should
    // still degrade gracefully rather than throw.
    const { disconnectWallet } = await import("../../lib/genlayerClient");
    await expect(disconnectWallet()).resolves.toBe(false);
  });
});

describe("Header — wallet account/network change events (regression)", () => {
  // Regression tests for a real gap: the app never listened for MetaMask's
  // accountsChanged/chainChanged events at all, so switching accounts or
  // networks in the wallet extension left the UI silently pointed at a
  // stale account -- still showing the old address while any write would
  // go out under whatever the wallet actually resolves at call time.

  it("updates the displayed account when accountsChanged fires with a new address", async () => {
    const addr1 = "0x1111111111111111111111111111111111111a";
    const addr2 = "0x2222222222222222222222222222222222222b";
    global.window.ethereum = makeMockEthereum(addr1);

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("account-pill").textContent).toMatch(/0x1111…111a/);
    });

    act(() => global.window.ethereum.__trigger("accountsChanged", [addr2]));

    await waitFor(() => {
      expect(screen.getByTestId("account-pill").textContent).toMatch(/0x2222…222b/);
    });
    expect(screen.getByTestId("wallet-notice").textContent).toMatch(/Switched to account/);
  });

  it("clears the connection when accountsChanged fires with no accounts (wallet disconnected from the wallet's own UI)", async () => {
    const addr1 = "0x1111111111111111111111111111111111111a";
    global.window.ethereum = makeMockEthereum(addr1);

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));
    await waitFor(() => expect(screen.getByTestId("account-pill")).toBeInTheDocument());

    act(() => global.window.ethereum.__trigger("accountsChanged", []));

    await waitFor(() => {
      expect(screen.getByTestId("connect-btn").textContent).toBe("Connect Wallet");
    });
    expect(screen.queryByTestId("account-pill")).not.toBeInTheDocument();
    expect(screen.getByTestId("wallet-notice").textContent).toMatch(/disconnected/i);
  });

  it("drops the connection and asks the user to reconnect when the wallet's network changes", async () => {
    const addr1 = "0x1111111111111111111111111111111111111a";
    global.window.ethereum = makeMockEthereum(addr1);

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    fireEvent.click(screen.getByTestId("connect-btn"));
    await waitFor(() => expect(screen.getByTestId("account-pill")).toBeInTheDocument());

    act(() => global.window.ethereum.__trigger("chainChanged", "0x999"));

    await waitFor(() => {
      expect(screen.getByTestId("connect-btn").textContent).toBe("Connect Wallet");
    });
    expect(screen.getByTestId("wallet-notice").textContent).toMatch(/network changed/i);
  });

  it("ignores accountsChanged events that fire before the user ever connected here", async () => {
    const addr1 = "0x1111111111111111111111111111111111111a";
    global.window.ethereum = makeMockEthereum(addr1);

    render(
      <GrantOSProvider>
        <Header />
      </GrantOSProvider>
    );
    // Never clicked Connect -- some wallets fire accountsChanged on page load anyway.
    act(() => global.window.ethereum.__trigger("accountsChanged", [addr1]));

    expect(screen.getByTestId("connect-btn").textContent).toBe("Connect Wallet");
    expect(screen.queryByTestId("wallet-notice")).not.toBeInTheDocument();
  });
});
