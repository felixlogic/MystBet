import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div>
          <p className="eyebrow">MystBet Arena</p>
          <h1>Encrypted head-to-head gaming</h1>
          <p className="subtitle">
            Spin up a private match, send Zama-encrypted bids, and let the contract decide the winner
            without exposing your move sizes.
          </p>
        </div>
        <ConnectButton />
      </div>
    </header>
  );
}
