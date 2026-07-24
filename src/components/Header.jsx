// src/components/Header.jsx
import { useState } from "react";
import { useGrantOS } from "../context/GrantOSContext";
import { isValidAddress } from "../lib/genlayerClient";
import BrandMark from "./BrandMark";

export default function Header() {
  const { account, connect, disconnect, connectError, contractAddress, setContractAddress, walletNotice } = useGrantOS();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  async function handleConnectClick() {
    setIsConnecting(true);
    try {
      await connect();
    } catch {
      // connect() already surfaces the error via connectError; swallow the
      // re-thrown rejection here so it doesn't escape as an unhandled
      // promise rejection on every failed connection attempt.
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnectClick() {
    setIsDisconnecting(true);
    try {
      await disconnect();
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <header>
      <div className="brand">
        <div className="brand-row">
          <BrandMark />
          <h1>GrantOS</h1>
        </div>
        <div className="tag">Milestone verification &middot; GenLayer Bradbury Testnet</div>
        <a className="back-to-site" href="#" data-testid="back-to-site-link">&larr; Back to site</a>
      </div>
      <div className="conn">
        <span className={`status-dot ${account ? "on" : "off"}`} aria-hidden="true" />
        <input
          data-testid="contract-address-input"
          placeholder="0x… deployed GrantOS contract address"
          value={contractAddress}
          onChange={(e) => setContractAddress(e.target.value.trim())}
          className={contractAddress && !isValidAddress(contractAddress) ? "invalid" : ""}
        />
        {contractAddress && !isValidAddress(contractAddress) && (
          <span className="msg msg-error conn-error" data-testid="contract-address-invalid-hint">
            Not a valid contract address
          </span>
        )}

        {account ? (
          <>
            <span className="account-pill" data-testid="account-pill">
              {account.slice(0, 6)}…{account.slice(-4)}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={handleDisconnectClick}
              disabled={isDisconnecting}
              data-testid="disconnect-btn"
            >
              {isDisconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={handleConnectClick}
            disabled={isConnecting}
            data-testid="connect-btn"
          >
            {isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}

        {connectError && <span className="msg msg-error conn-error">{connectError}</span>}
        {!connectError && walletNotice && <span className="msg msg-pending conn-error" data-testid="wallet-notice">{walletNotice}</span>}
      </div>
    </header>
  );
}
