// src/context/GrantOSContext.jsx
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { connectWallet as connectWalletApi, disconnectWallet as disconnectWalletApi, makeClient } from "../lib/genlayerClient";

const GrantOSContext = createContext(null);
const DEFAULT_CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() || "";

export function GrantOSProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [client, setClient] = useState(() => makeClient());
  const [contractAddress, setContractAddress] = useState(DEFAULT_CONTRACT_ADDRESS);
  const [connectError, setConnectError] = useState(null);
  const [walletNotice, setWalletNotice] = useState(null);
  // Tracks whether *this app* initiated the connection, so an accountsChanged
  // event firing before the user ever clicked "Connect Wallet" (some wallets
  // fire one on page load) doesn't spuriously flip us into a connected state.
  const hasConnectedRef = useRef(false);

  const connect = useCallback(async () => {
    setConnectError(null);
    setWalletNotice(null);
    try {
      const { address, client: connectedClient } = await connectWalletApi();
      hasConnectedRef.current = true;
      setAccount(address);
      setClient(connectedClient);
      return address;
    } catch (err) {
      setConnectError(err.message);
      throw err;
    }
  }, []);

  const disconnect = useCallback(async () => {
    setConnectError(null);
    const revoked = await disconnectWalletApi();
    setAccount(null);
    setClient(makeClient());
    hasConnectedRef.current = false;
    setWalletNotice(
      revoked
        ? "Wallet disconnected."
        : "Disconnected. (Your wallet doesn't support revoking permissions yet, so it may reconnect automatically next time -- you can also disconnect this site from within your wallet's settings.)"
    );
  }, []);

  // Without these listeners, switching accounts or networks in the wallet
  // extension leaves this app silently pointed at a stale account/chain --
  // still showing "Connected: 0xOLD…" and letting the user attempt writes
  // that either go to the wrong place or fail with a confusing error.
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const ethereum = window.ethereum; // capture now -- don't re-read window.ethereum in
    // cleanup, since it can become undefined between mount and unmount (extension
    // disabled/uninstalled, another wallet extension overwriting the global, etc).

    function handleAccountsChanged(accounts) {
      if (!hasConnectedRef.current) return; // ignore events before the user ever connected here
      if (!accounts || accounts.length === 0) {
        setAccount(null);
        setClient(makeClient());
        setWalletNotice("Wallet disconnected.");
        hasConnectedRef.current = false;
        return;
      }
      const newAddress = accounts[0];
      setAccount(newAddress);
      setClient(makeClient(newAddress, ethereum));
      setWalletNotice(`Switched to account ${newAddress.slice(0, 6)}…${newAddress.slice(-4)}.`);
    }

    function handleChainChanged() {
      // The connected genlayer-js client is bound to a specific chain
      // (Bradbury) at creation time; if the wallet's active network changes
      // underneath it, the safest thing is to drop back to a disconnected
      // state and ask the user to reconnect, rather than silently attempt
      // transactions against a client/chain mismatch.
      if (!hasConnectedRef.current) return;
      setAccount(null);
      setClient(makeClient());
      hasConnectedRef.current = false;
      setWalletNotice("Your wallet's network changed. Please reconnect to continue on Bradbury.");
    }

    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const value = {
    account,
    client,
    contractAddress,
    setContractAddress,
    connect,
    disconnect,
    connectError,
    walletNotice,
    isReady: Boolean(account && contractAddress),
  };

  return <GrantOSContext.Provider value={value}>{children}</GrantOSContext.Provider>;
}

export function useGrantOS() {
  const ctx = useContext(GrantOSContext);
  if (!ctx) throw new Error("useGrantOS must be used within a GrantOSProvider");
  return ctx;
}
