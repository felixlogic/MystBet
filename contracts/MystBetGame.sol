// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title MystBetGame - two player encrypted wagering game
/// @notice Players create games, join, and submit encrypted coin bids. Higher bid wins the round and increments score.
contract MystBetGame is ZamaEthereumConfig {
    uint32 public constant INITIAL_COINS = 10;

    enum GameStatus {
        WaitingForPlayers,
        ReadyToStart,
        InProgress,
        Finished
    }

    struct Game {
        uint256 id;
        address creator;
        address[2] players;
        uint8 playerCount;
        GameStatus status;
        uint32 currentRound;
        address winner;
        bool isTie;
    }

    struct PlayerState {
        bool registered;
        euint32 coins;
        euint32 score;
        euint32 lastSubmittedMove;
        bool hasSubmitted;
        uint32 lastRoundSubmitted;
    }

    struct PlayerStateView {
        bool registered;
        euint32 coins;
        euint32 score;
        euint32 lastSubmittedMove;
        bool hasSubmitted;
        uint32 lastRoundSubmitted;
    }

    uint256 private _nextGameId = 1;
    mapping(uint256 => Game) private _games;
    mapping(uint256 => mapping(address => PlayerState)) private _playerStates;
    uint256[] private _gameIds;

    event GameCreated(uint256 indexed gameId, address indexed creator);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event GameStarted(uint256 indexed gameId, uint32 round);
    event MoveSubmitted(uint256 indexed gameId, address indexed player, uint32 round);
    event RoundResolved(uint256 indexed gameId, uint32 round, address winner);
    event GameFinished(uint256 indexed gameId, address winner, bool isTie);

    /// @notice Creates a new game with the caller as the first player.
    /// @return gameId Newly created game id.
    function createGame() external returns (uint256 gameId) {
        gameId = _nextGameId;
        _nextGameId += 1;

        Game storage game = _games[gameId];
        game.id = gameId;
        game.creator = msg.sender;
        game.status = GameStatus.WaitingForPlayers;

        _gameIds.push(gameId);
        _addPlayer(game, msg.sender);

        emit GameCreated(gameId, msg.sender);
    }

    /// @notice Join an existing game that is still waiting for players.
    /// @param gameId Identifier of the game to join.
    function joinGame(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        require(game.status == GameStatus.WaitingForPlayers, "Game is not open");
        _addPlayer(game, msg.sender);
    }

    /// @notice Starts a game that has two registered players.
    /// @param gameId Identifier of the game to start.
    function startGame(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        require(game.status == GameStatus.ReadyToStart, "Game is not ready");
        require(_isPlayer(game, msg.sender), "Caller is not a player");

        game.status = GameStatus.InProgress;
        game.currentRound = 1;

        emit GameStarted(gameId, game.currentRound);
    }

    /// @notice Submit encrypted coins for the current round.
    /// @param gameId Identifier of the game.
    /// @param encryptedCoins Encrypted number of coins.
    /// @param inputProof Input proof returned by the relayer.
    function submitEncryptedMove(
        uint256 gameId,
        externalEuint32 encryptedCoins,
        bytes calldata inputProof
    ) external {
        Game storage game = _getGame(gameId);
        require(game.status == GameStatus.InProgress, "Game is not active");

        PlayerState storage state = _playerStates[gameId][msg.sender];
        require(state.registered, "Player is not registered");
        require(!state.hasSubmitted || state.lastRoundSubmitted < game.currentRound, "Already submitted this round");

        euint32 coinsToSpend = FHE.fromExternal(encryptedCoins, inputProof);
        ebool canSpend = FHE.le(coinsToSpend, state.coins);
        euint32 spendAmount = FHE.select(canSpend, coinsToSpend, state.coins);

        state.lastSubmittedMove = spendAmount;
        state.hasSubmitted = true;
        state.lastRoundSubmitted = game.currentRound;

        FHE.allowThis(state.lastSubmittedMove);
        FHE.allow(state.lastSubmittedMove, msg.sender);

        emit MoveSubmitted(gameId, msg.sender, game.currentRound);

        if (_bothPlayersReady(game)) {
            _resolveRound(gameId);
        }
    }

    /// @notice Returns information about a specific game.
    function getGame(uint256 gameId) external view returns (Game memory) {
        Game storage game = _getGame(gameId);
        return game;
    }

    /// @notice Returns ids for every game that has been created.
    function getGameIds() external view returns (uint256[] memory ids) {
        ids = new uint256[](_gameIds.length);
        for (uint256 i = 0; i < _gameIds.length; i++) {
            ids[i] = _gameIds[i];
        }
    }

    /// @notice Returns all games.
    function listGames() external view returns (Game[] memory gamesList) {
        gamesList = new Game[](_gameIds.length);
        for (uint256 i = 0; i < _gameIds.length; i++) {
            gamesList[i] = _games[_gameIds[i]];
        }
    }

    /// @notice Returns the encrypted state for a player.
    function getPlayerState(uint256 gameId, address player) external view returns (PlayerStateView memory) {
        PlayerState storage state = _playerStates[gameId][player];
        return
            PlayerStateView({
                registered: state.registered,
                coins: state.coins,
                score: state.score,
                lastSubmittedMove: state.lastSubmittedMove,
                hasSubmitted: state.hasSubmitted,
                lastRoundSubmitted: state.lastRoundSubmitted
            });
    }

    function _getGame(uint256 gameId) private view returns (Game storage) {
        Game storage game = _games[gameId];
        require(game.id != 0, "Game does not exist");
        return game;
    }

    function _isPlayer(Game storage game, address account) private view returns (bool) {
        return (game.players[0] == account || game.players[1] == account);
    }

    function _addPlayer(Game storage game, address player) private {
        PlayerState storage state = _playerStates[game.id][player];
        require(!state.registered, "Player already joined");
        require(game.playerCount < 2, "Game is full");

        state.registered = true;
        state.coins = FHE.asEuint32(INITIAL_COINS);
        state.score = FHE.asEuint32(0);
        state.lastSubmittedMove = FHE.asEuint32(0);
        state.lastRoundSubmitted = 0;
        state.hasSubmitted = false;

        FHE.allowThis(state.coins);
        FHE.allow(state.coins, player);
        FHE.allowThis(state.score);
        FHE.allow(state.score, player);
        FHE.allowThis(state.lastSubmittedMove);
        FHE.allow(state.lastSubmittedMove, player);

        game.players[game.playerCount] = player;
        game.playerCount += 1;

        emit PlayerJoined(game.id, player);

        if (game.playerCount == 2) {
            game.status = GameStatus.ReadyToStart;
        }
    }

    function _bothPlayersReady(Game storage game) private view returns (bool) {
        if (game.playerCount < 2) {
            return false;
        }
        PlayerState storage first = _playerStates[game.id][game.players[0]];
        PlayerState storage second = _playerStates[game.id][game.players[1]];
        return
            first.hasSubmitted &&
            second.hasSubmitted &&
            first.lastRoundSubmitted == game.currentRound &&
            second.lastRoundSubmitted == game.currentRound;
    }

    function _resolveRound(uint256 gameId) private {
        Game storage game = _games[gameId];
        address playerAAddress = game.players[0];
        address playerBAddress = game.players[1];
        PlayerState storage playerA = _playerStates[gameId][playerAAddress];
        PlayerState storage playerB = _playerStates[gameId][playerBAddress];
        uint32 roundToResolve = game.currentRound;

        euint32 moveA = playerA.lastSubmittedMove;
        euint32 moveB = playerB.lastSubmittedMove;

        playerA.coins = FHE.sub(playerA.coins, moveA);
        playerB.coins = FHE.sub(playerB.coins, moveB);
        FHE.allowThis(playerA.coins);
        FHE.allow(playerA.coins, playerAAddress);
        FHE.allowThis(playerB.coins);
        FHE.allow(playerB.coins, playerBAddress);

        ebool playerAWins = FHE.gt(moveA, moveB);
        ebool playerBWins = FHE.gt(moveB, moveA);
        euint32 increment = FHE.asEuint32(1);

        playerA.score = FHE.select(playerAWins, FHE.add(playerA.score, increment), playerA.score);
        playerB.score = FHE.select(playerBWins, FHE.add(playerB.score, increment), playerB.score);
        FHE.allowThis(playerA.score);
        FHE.allow(playerA.score, playerAAddress);
        FHE.allowThis(playerB.score);
        FHE.allow(playerB.score, playerBAddress);

        playerA.hasSubmitted = false;
        playerB.hasSubmitted = false;
        playerA.lastSubmittedMove = FHE.asEuint32(0);
        playerB.lastSubmittedMove = FHE.asEuint32(0);
        FHE.allowThis(playerA.lastSubmittedMove);
        FHE.allow(playerA.lastSubmittedMove, playerAAddress);
        FHE.allowThis(playerB.lastSubmittedMove);
        FHE.allow(playerB.lastSubmittedMove, playerBAddress);

        emit RoundResolved(gameId, roundToResolve, address(0));

        game.currentRound = roundToResolve + 1;
    }

    /// @notice Allows both players to make their encrypted balances and scores publicly decryptable for finalization.
    /// @param gameId Identifier of the game to prepare.
    function prepareDecryption(uint256 gameId) external {
        Game storage game = _getGame(gameId);
        require(game.status == GameStatus.InProgress, "Game is not active");
        require(_isPlayer(game, msg.sender), "Caller is not a player");

        address playerAAddress = game.players[0];
        address playerBAddress = game.players[1];
        PlayerState storage playerA = _playerStates[gameId][playerAAddress];
        PlayerState storage playerB = _playerStates[gameId][playerBAddress];

        FHE.makePubliclyDecryptable(playerA.coins);
        FHE.makePubliclyDecryptable(playerB.coins);
        FHE.makePubliclyDecryptable(playerA.score);
        FHE.makePubliclyDecryptable(playerB.score);
    }

    /// @notice Finalizes the game using a public decryption proof for coins and scores.
    /// @param gameId Identifier of the game.
    /// @param abiEncodedClearValues ABI-encoded (playerA coins, playerB coins, playerA score, playerB score) returned by the relayer.
    /// @param decryptionProof Decryption proof from the relayer for the provided handles and clear values.
    function finalizeWithProof(uint256 gameId, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Game storage game = _getGame(gameId);
        require(game.status == GameStatus.InProgress, "Game is not active");

        address playerAAddress = game.players[0];
        address playerBAddress = game.players[1];
        PlayerState storage playerA = _playerStates[gameId][playerAAddress];
        PlayerState storage playerB = _playerStates[gameId][playerBAddress];

        require(!playerA.hasSubmitted && !playerB.hasSubmitted, "Round still in progress");

        bytes32[] memory handles = new bytes32[](4);
        handles[0] = FHE.toBytes32(playerA.coins);
        handles[1] = FHE.toBytes32(playerB.coins);
        handles[2] = FHE.toBytes32(playerA.score);
        handles[3] = FHE.toBytes32(playerB.score);

        FHE.checkSignatures(handles, abiEncodedClearValues, decryptionProof);

        (uint32 coinsA, uint32 coinsB, uint32 scoreA, uint32 scoreB) = abi.decode(
            abiEncodedClearValues,
            (uint32, uint32, uint32, uint32)
        );

        require(coinsA == 0 && coinsB == 0, "Coins remain");

        if (scoreA > scoreB) {
            game.winner = playerAAddress;
            game.isTie = false;
        } else if (scoreB > scoreA) {
            game.winner = playerBAddress;
            game.isTie = false;
        } else {
            game.winner = address(0);
            game.isTie = true;
        }

        game.status = GameStatus.Finished;
        emit GameFinished(gameId, game.winner, game.isTie);
    }
}
