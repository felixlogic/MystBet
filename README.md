# MystBet

MystBet is a two-player, fully homomorphic encryption (FHE) powered wagering game on Ethereum. Players create or join a match, submit encrypted coin bids, and let the contract decide each round without ever revealing their move sizes. Every bid, coin balance, and score stays encrypted on-chain while still being verifiable and deterministic.

## Why MystBet
- Private competitive play: encrypted wagers keep player strategies secret while the contract enforces the rules.
- Fair by default: all logic resolves on-chain with auditable events for game creation, joins, starts, moves, and results.
- Simple game loop: two players, ten coins each, highest encrypted bid wins the round until both are out of coins.
- Built for FHE experimentation: showcases how Zama's FHEVM stack can power transparent yet privacy-preserving dapps.

## Problems MystBet Tackles
- **Leaking strategies:** Bids stay encrypted end-to-end, preventing copycats and frontrunning.
- **Off-chain trust assumptions:** Round resolution happens entirely in the contract; no external referee is needed.
- **Manual accounting mistakes:** Enforced coin limits stop overspending and guarantee the game ends cleanly.
- **Opaque scoring:** Players can decrypt their own encrypted balances and scores through the relayer flow to verify outcomes.

## Core Gameplay
- Create a game: anyone can open a lobby; the creator is auto-registered as player one.
- Join a game: any address can fill the open slot while status is `WaitingForPlayers`.
- Start the match: once two players are registered, either player can begin the game.
- Submit encrypted coins: each player starts with `10` coins; submit an encrypted integer per round (cannot exceed remaining balance).
- Resolve rounds: the higher encrypted bid wins the round and gains one encrypted point; balances decrease by the submitted amounts.
- Finish: when both players have spent every coin, the contract marks the winner (or tie) and emits a `GameFinished` event.

## Tech Stack
- **Smart contracts:** Solidity `0.8.27`, Hardhat, `@fhevm/solidity` for encrypted types and operations, `hardhat-deploy`, TypeChain, and coverage/gas tooling.
- **Frontend:** React + Vite + TypeScript, RainbowKit + Wagmi (viem reads, ethers writes), Zama relayer SDK for encryption/decryption, CSS-based styling (no Tailwind).
- **Testing:** Hardhat tests exercise encrypted flows (coin spending, scoring, and game finalization) using the FHEVM plugin.
- **Network:** Sepolia configuration via Infura; local Hardhat network for development.

## Repository Layout
- `contracts/` — `MystBetGame.sol` encrypted two-player game contract.
- `deploy/` — Hardhat deploy script for MystBetGame.
- `tasks/` — Hardhat tasks for inspecting addresses, creating/joining/starting games, submitting moves, and decrypting player state.
- `test/` — Contract tests covering game setup, encrypted rounds, limits, and completion.
- `frontend/` — React application for playing MystBet with wallet connectivity and encrypted move flows.
- `docs/` — Zama FHEVM references for contracts and relayer usage.

## Getting Started (Contracts)
Prerequisites: Node.js ≥ 20 and npm.

1) Install dependencies  
`npm install`

2) Set environment variables in a local `.env` (private key only; no mnemonic)  
- `PRIVATE_KEY=<your_sepolia_private_key>`  
- `INFURA_API_KEY=<your_infura_key>`  
- `ETHERSCAN_API_KEY=<optional_for_verification>`  

3) Compile and test  
`npm run compile`  
`npm test`

4) Run a local node and deploy for development  
`npm run chain` (starts Hardhat node)  
`npm run deploy:localhost` (deploys MystBetGame locally)

5) Deploy to Sepolia (uses `PRIVATE_KEY` and `INFURA_API_KEY`)  
`npm run deploy:sepolia`  
`npm run verify:sepolia <DEPLOYED_ADDRESS>` (optional, with `ETHERSCAN_API_KEY`)

Deployment artifacts from `hardhat-deploy` will be written to `deployments/<network>/MystBetGame.json`; use this ABI/address when updating the frontend config.

## Hardhat Tasks
- `npx hardhat task:game-address --network <network>` — print the deployed MystBetGame address.
- `npx hardhat task:create-game --network <network>` — create a new game as the caller.
- `npx hardhat task:join-game --game <id> --network <network>` — join a waiting game as the second player.
- `npx hardhat task:start-game --game <id> --network <network>` — start a ready game.
- `npx hardhat task:submit-move --game <id> --value <coins> --network <network>` — submit an encrypted bid.
- `npx hardhat task:decrypt-state --game <id> --player <address> --network <network>` — decrypt coins and score for a player (requires relayer initialization).

## Frontend App
- Install dependencies: `cd frontend && npm install`.
- Update contract bindings: copy `address` and `abi` from `deployments/sepolia/MystBetGame.json` into `frontend/src/config/contracts.ts` (the frontend does not use environment variables or local JSON imports).
- Run locally: `npm run dev` inside `frontend` and connect with a Sepolia-enabled wallet.
- Flow: connect wallet → create or join a game → start when two players are present → submit encrypted moves each round → decrypt your own coins/score with “Decrypt Balance.”
- Connectivity: Wagmi/RainbowKit handle wallet connections on Sepolia; reads go through viem, writes through ethers; the Zama relayer SDK handles encryption and user-side decryption of FHE ciphertexts.

## Advantages
- Privacy-first gameplay without sacrificing on-chain verifiability.
- Deterministic enforcement of coin balances and scoring, removing trust in off-chain arbiters.
- Clear audit trail through events (`GameCreated`, `PlayerJoined`, `GameStarted`, `MoveSubmitted`, `RoundResolved`, `GameFinished`).
- Separation of concerns: secure contract logic, typed tasks, and a focused frontend that never touches local storage or localhost networks.

## Future Plans
- Richer UI cues (round history, decrypted summaries, and winner banners per round).
- Leaderboards or shared lobbies sourced from on-chain game listings.
- Multi-game support per wallet with better filtering/search across `listGames`.
- Additional relayer tooling to cache connections and improve decryption UX.
- Extended test coverage for edge cases (simultaneous submissions, replay resistance, and pause/resume mechanics).
- Optional support for more chains once FHEVM gateways are available beyond Sepolia.
