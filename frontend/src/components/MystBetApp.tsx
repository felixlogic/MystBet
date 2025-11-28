import { useEffect, useMemo, useState } from 'react';
import { Contract } from 'ethers';
import { useAccount, useReadContract } from 'wagmi';
import { Header } from './Header';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../config/contracts';
import '../styles/MystBetApp.css';

const GAME_STATUS: Record<number, string> = {
  0: 'Waiting',
  1: 'Ready',
  2: 'In Progress',
  3: 'Finished',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type GameInfo = {
  id: bigint;
  creator: string;
  players: readonly [string, string];
  playerCount: number;
  status: number;
  currentRound: number;
  winner: string;
  isTie: boolean;
};

type PlayerStateResponse = readonly [boolean, `0x${string}`, `0x${string}`, `0x${string}`, boolean, number];
type PlayerStateObject = {
  registered: boolean;
  coins: `0x${string}`;
  score: `0x${string}`;
  lastSubmittedMove: `0x${string}`;
  hasSubmitted: boolean;
  lastRoundSubmitted: number | bigint;
};

function shortenAddress(address?: string) {
  if (!address || address === ZERO_ADDRESS) {
    return 'Waiting';
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function MystBetApp() {
  const { address, isConnected } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [selectedGameId, setSelectedGameId] = useState<bigint | null>(null);
  const [moveAmount, setMoveAmount] = useState<number>(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedStats, setDecryptedStats] = useState<{ coins: string; score: string } | null>(null);

  const {
    data: gamesRaw,
    refetch: refetchGames,
    isPending: isLoadingGames,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'listGames',
  });

  const parsedGames: GameInfo[] = useMemo(() => {
    if (!gamesRaw) {
      return [];
    }

    const normalize = (raw: any): GameInfo | null => {
      const id = raw?.id ?? raw?.[0];
      const creator = raw?.creator ?? raw?.[1] ?? ZERO_ADDRESS;
      const players = (raw?.players ?? raw?.[2]) as readonly [string, string] | undefined;
      const playerCount = raw?.playerCount ?? raw?.[3];
      const status = raw?.status ?? raw?.[4];
      const currentRound = raw?.currentRound ?? raw?.[5];
      const winner = raw?.winner ?? raw?.[6] ?? ZERO_ADDRESS;
      const isTie = raw?.isTie ?? raw?.[7] ?? false;

      if (id === undefined || !players) {
        return null;
      }

      return {
        id: BigInt(id),
        creator,
        players,
        playerCount: Number(playerCount ?? 0),
        status: Number(status ?? 0),
        currentRound: Number(currentRound ?? 0),
        winner,
        isTie: Boolean(isTie),
      };
    };

    return (gamesRaw as any[])
      .map(normalize)
      .filter((game): game is GameInfo => Boolean(game));
  }, [gamesRaw]);

  useEffect(() => {
    if (parsedGames.length === 0) {
      setSelectedGameId(null);
      return;
    }

    const hasSelection = selectedGameId && parsedGames.some(game => game.id === selectedGameId);
    if (!hasSelection) {
      setSelectedGameId(parsedGames[0].id);
    }
  }, [parsedGames, selectedGameId]);

  const selectedGame = useMemo(
    () => (selectedGameId ? parsedGames.find(game => game.id === selectedGameId) ?? null : null),
    [parsedGames, selectedGameId]
  );

  const {
    data: playerStateRaw,
    refetch: refetchPlayerState,
    isPending: isLoadingPlayerState,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getPlayerState',
    args: selectedGameId && address ? [selectedGameId, address] : undefined,
    query: {
      enabled: Boolean(selectedGameId && address),
    },
  });

  const playerState = useMemo(() => {
    if (!playerStateRaw) {
      return null;
    }

    const value = playerStateRaw as PlayerStateResponse | PlayerStateObject;
    const registered = (value as PlayerStateObject).registered ?? (value as PlayerStateResponse)[0];
    const coins = (value as PlayerStateObject).coins ?? (value as PlayerStateResponse)[1];
    const score = (value as PlayerStateObject).score ?? (value as PlayerStateResponse)[2];
    const lastSubmittedMove =
      (value as PlayerStateObject).lastSubmittedMove ?? (value as PlayerStateResponse)[3];
    const hasSubmitted = (value as PlayerStateObject).hasSubmitted ?? (value as PlayerStateResponse)[4];
    const lastRoundSubmittedRaw =
      (value as PlayerStateObject).lastRoundSubmitted ?? (value as PlayerStateResponse)[5] ?? 0;

    if (
      registered === undefined ||
      coins === undefined ||
      score === undefined ||
      lastSubmittedMove === undefined ||
      hasSubmitted === undefined
    ) {
      return null;
    }

    return {
      registered,
      coins,
      score,
      lastSubmittedMove,
      hasSubmitted,
      lastRoundSubmitted: Number(lastRoundSubmittedRaw),
    };
  }, [playerStateRaw]);

  const readyToTransact = Boolean(isConnected && signerPromise);

  const withFeedback = async (action: () => Promise<void>) => {
    try {
      setIsProcessing(true);
      setFeedback(null);
      await action();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Action failed';
      setFeedback(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateGame = async () => {
    if (!readyToTransact) {
      setFeedback('Connect wallet to create a game.');
      return;
    }
    await withFeedback(async () => {
      const signer = await signerPromise!;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setFeedback('Creating game...');
      const tx = await contract.createGame();
      await tx.wait();
      setFeedback('Game created. Refreshing list...');
      await refetchGames();
    });
  };

  const handleJoinGame = async () => {
    if (!readyToTransact || !selectedGameId) {
      setFeedback('Select a game and connect your wallet to join.');
      return;
    }
    await withFeedback(async () => {
      const signer = await signerPromise!;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setFeedback(`Joining game #${selectedGameId.toString()}...`);
      const tx = await contract.joinGame(selectedGameId);
      await tx.wait();
      setFeedback('Joined game.');
      setDecryptedStats(null);
      await Promise.all([refetchGames(), refetchPlayerState()]);
    });
  };

  const handleStartGame = async () => {
    if (!readyToTransact || !selectedGameId) {
      setFeedback('Select a game and connect your wallet to start.');
      return;
    }
    await withFeedback(async () => {
      const signer = await signerPromise!;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setFeedback('Starting game...');
      const tx = await contract.startGame(selectedGameId);
      await tx.wait();
      setFeedback('Game started.');
      await refetchGames();
    });
  };

  const handleSubmitMove = async () => {
    if (!instance) {
      setFeedback('Encryption service is not ready yet.');
      return;
    }
    if (!readyToTransact || !address || !selectedGameId) {
      setFeedback('Connect wallet and select a game to play.');
      return;
    }
    if (moveAmount < 0 || moveAmount > 10) {
      setFeedback('Move must be between 0 and 10 coins.');
      return;
    }

    await withFeedback(async () => {
      setFeedback('Encrypting move...');
      const buffer = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
      buffer.add32(moveAmount);
      const encryptedInput = await buffer.encrypt();

      const signer = await signerPromise!;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.submitEncryptedMove(
        selectedGameId,
        encryptedInput.handles[0],
        encryptedInput.inputProof
      );
      setFeedback('Submitting encrypted move...');
      await tx.wait();
      setFeedback('Move submitted.');
      setDecryptedStats(null);
      await Promise.all([refetchGames(), refetchPlayerState()]);
    });
  };

  const handleDecryptStats = async () => {
    if (!instance || !address || !playerState || !signerPromise) {
      setFeedback('Missing prerequisites to decrypt your stats.');
      return;
    }

    try {
      setIsDecrypting(true);
      setFeedback('Preparing secure decryption request...');

      const keypair = instance.generateKeypair();
      const handleContractPairs = [
        { handle: playerState.coins, contractAddress: CONTRACT_ADDRESS },
        { handle: playerState.score, contractAddress: CONTRACT_ADDRESS },
      ];
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [CONTRACT_ADDRESS];

      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays
      );

      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet signer unavailable.');
      }

      const signature = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message
      );

      const decrypted = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays
      );

      const coinsValue = decrypted[playerState.coins as string] ?? '0';
      const scoreValue = decrypted[playerState.score as string] ?? '0';
      setDecryptedStats({
        coins: coinsValue.toString(),
        score: scoreValue.toString(),
      });
      setFeedback('Decrypted stats updated.');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Decryption failed';
      setFeedback(message);
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <div className="mystbet-app">
      <Header />
      <main className="mystbet-main">
        <section className="left-panel">
          <div className="panel-card">
            <div className="panel-header">
              <h2>Game Controls</h2>
              <button className="ghost-button" onClick={() => refetchGames()} disabled={isLoadingGames}>
                Refresh
              </button>
            </div>
            <div className="control-grid">
              <button onClick={handleCreateGame} disabled={isProcessing || !readyToTransact}>
                Create Game
              </button>
              <button
                onClick={handleJoinGame}
                disabled={isProcessing || !readyToTransact || !selectedGameId}
              >
                Join Selected
              </button>
              <button
                onClick={handleStartGame}
                disabled={
                  isProcessing ||
                  !readyToTransact ||
                  !selectedGame ||
                  selectedGame.status !== 1
                }
              >
                Start Game
              </button>
            </div>
            {!isConnected && <p className="helper-text">Connect your wallet to manage games.</p>}
          </div>

          <div className="panel-card">
            <h2>Submit Encrypted Coins</h2>
            <p className="helper-text">
              Each player starts with 10 coins. Higher encrypted bid wins the round.
            </p>
            <div className="input-row">
              <label htmlFor="moveAmount">Coins</label>
              <input
                id="moveAmount"
                type="number"
                min={0}
                max={10}
                value={moveAmount}
                onChange={event => setMoveAmount(Number(event.target.value))}
              />
            </div>
            <button
              onClick={handleSubmitMove}
              disabled={
                isProcessing ||
                !readyToTransact ||
                !selectedGame ||
                selectedGame.status !== 2 ||
                zamaLoading
              }
            >
              Submit Move
            </button>
            {zamaError && <p className="error-text">{zamaError}</p>}
            {zamaLoading && <p className="helper-text">Connecting to encryption service...</p>}
          </div>

          <div className="panel-card">
            <h2>My Encrypted Stats</h2>
            {address ? (
              playerState && playerState.registered ? (
                <>
                  <div className="stats-grid">
                    <div>
                      <p className="stat-label">Submitted This Round</p>
                      <p className="stat-value">{playerState.hasSubmitted ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="stat-label">Last Round Played</p>
                      <p className="stat-value">{playerState.lastRoundSubmitted}</p>
                    </div>
                    <div>
                      <p className="stat-label">Encrypted Coins</p>
                      <p className="stat-value truncated">{playerState.coins}</p>
                    </div>
                    <div>
                      <p className="stat-label">Encrypted Score</p>
                      <p className="stat-value truncated">{playerState.score}</p>
                    </div>
                  </div>
                  <button onClick={handleDecryptStats} disabled={isDecrypting}>
                    {isDecrypting ? 'Decrypting...' : 'Decrypt Balance'}
                  </button>
                  {decryptedStats && (
                    <div className="decrypted-card">
                      <div>
                        <span className="stat-label">Coins Left</span>
                        <span className="stat-value">{decryptedStats.coins}</span>
                      </div>
                      <div>
                        <span className="stat-label">Score</span>
                        <span className="stat-value">{decryptedStats.score}</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="helper-text">
                  Join the selected game to view and decrypt your state.
                </p>
              )
            ) : (
              <p className="helper-text">Connect your wallet to view player stats.</p>
            )}
          </div>

          {feedback && <div className="feedback-card">{feedback}</div>}
        </section>

        <section className="right-panel">
          <div className="panel-card">
            <h2>Active Games</h2>
            {isLoadingGames ? (
              <p>Loading games...</p>
            ) : parsedGames.length === 0 ? (
              <p className="helper-text">No games yet. Create one to start playing.</p>
            ) : (
              <div className="game-list">
                {parsedGames.map(game => (
                  <button
                    key={game.id.toString()}
                    className={`game-card ${selectedGameId === game.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedGameId(game.id);
                      setDecryptedStats(null);
                    }}
                  >
                    <div className="game-card-header">
                      <span>Game #{game.id.toString()}</span>
                      <span className={`status-pill status-${game.status}`}>
                        {GAME_STATUS[game.status] ?? 'Unknown'}
                      </span>
                    </div>
                    <div className="game-card-body">
                      <p>Players: {game.playerCount}/2</p>
                      <p>Current Round: {game.currentRound}</p>
                      {game.status === 3 && (
                        <p>
                          Result:{' '}
                          {game.isTie ? 'Tie game' : `Winner ${shortenAddress(game.winner)}`}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedGame ? (
            <div className="panel-card">
              <h2>Game #{selectedGame.id.toString()} Overview</h2>
              <div className="game-details">
                <div>
                  <p className="stat-label">Status</p>
                  <p className={`stat-value status-${selectedGame.status}`}>
                    {GAME_STATUS[selectedGame.status] ?? 'Unknown'}
                  </p>
                </div>
                <div>
                  <p className="stat-label">Round</p>
                  <p className="stat-value">{selectedGame.currentRound}</p>
                </div>
                <div>
                  <p className="stat-label">Creator</p>
                  <p className="stat-value">{shortenAddress(selectedGame.creator)}</p>
                </div>
              </div>

              <ul className="players-list">
                {selectedGame.players.map((player, index) => (
                  <li key={`${player}-${index}`}>
                    <div>
                      <strong>Player {index + 1}</strong>
                      <span className="player-address">
                        {shortenAddress(player)}{' '}
                        {player !== ZERO_ADDRESS && player === address && (
                          <span className="pill">You</span>
                        )}
                      </span>
                    </div>
                    <div className="player-status">
                      {player === ZERO_ADDRESS ? 'Waiting to join' : 'Ready'}
                    </div>
                  </li>
                ))}
              </ul>
              {selectedGame.status === 3 && (
                <div className="result-bar">
                  {selectedGame.isTie
                    ? 'Game finished in a tie.'
                    : `Winner: ${shortenAddress(selectedGame.winner)}`}
                </div>
              )}
            </div>
          ) : (
            <div className="panel-card">
              <p className="helper-text">Select a game to view detailed information.</p>
            </div>
          )}
        </section>
      </main>
      {(isLoadingPlayerState || isProcessing) && (
        <div className="inline-status">Working... Please keep this tab open.</div>
      )}
    </div>
  );
}
