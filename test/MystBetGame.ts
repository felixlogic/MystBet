import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { MystBetGame, MystBetGame__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import hre from "hardhat";

type Signers = {
  creator: HardhatEthersSigner;
  challenger: HardhatEthersSigner;
  spectator: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("MystBetGame")) as MystBetGame__factory;
  const contract = (await factory.deploy()) as MystBetGame;
  const contractAddress = await contract.getAddress();
  return { mystBetGame: contract, contractAddress };
}

describe("MystBetGame", function () {
  let signers: Signers;
  let mystBetGame: MystBetGame;
  let mystBetGameAddress: string;

  before(async function () {
    const [creator, challenger, spectator] = await ethers.getSigners();
    signers = { creator, challenger, spectator };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    ({ mystBetGame, contractAddress: mystBetGameAddress } = await deployFixture());
  });

  async function encryptMove(amount: number, player: HardhatEthersSigner) {
    return fhevm.createEncryptedInput(mystBetGameAddress, player.address).add32(amount).encrypt();
  }

  async function startDefaultGame() {
    const predictedId = await mystBetGame.connect(signers.creator).createGame.staticCall();
    await mystBetGame.connect(signers.creator).createGame();
    await mystBetGame.connect(signers.challenger).joinGame(predictedId);
    await mystBetGame.connect(signers.creator).startGame(predictedId);
    return predictedId;
  }

  it("allows players to create and join games", async function () {
    const predictedId = await mystBetGame.connect(signers.creator).createGame.staticCall();
    await mystBetGame.connect(signers.creator).createGame();

    const createdGame = await mystBetGame.getGame(predictedId);
    expect(createdGame.creator).to.eq(signers.creator.address);
    expect(createdGame.playerCount).to.eq(1);
    expect(createdGame.players[0]).to.eq(signers.creator.address);
    expect(createdGame.status).to.eq(0);

    await mystBetGame.connect(signers.challenger).joinGame(predictedId);
    const readyGame = await mystBetGame.getGame(predictedId);
    expect(readyGame.playerCount).to.eq(2);
    expect(readyGame.status).to.eq(1);
  });

  it("plays encrypted rounds and updates coins and scores", async function () {
    const gameId = await startDefaultGame();

    const creatorMove = await encryptMove(3, signers.creator);
    await mystBetGame
      .connect(signers.creator)
      .submitEncryptedMove(gameId, creatorMove.handles[0], creatorMove.inputProof);

    const challengerMove = await encryptMove(5, signers.challenger);
    await mystBetGame
      .connect(signers.challenger)
      .submitEncryptedMove(gameId, challengerMove.handles[0], challengerMove.inputProof);

    const creatorState = await mystBetGame.getPlayerState(gameId, signers.creator.address);
    const challengerState = await mystBetGame.getPlayerState(gameId, signers.challenger.address);

    const creatorCoins = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      creatorState.coins,
      mystBetGameAddress,
      signers.creator,
    );
    const challengerCoins = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      challengerState.coins,
      mystBetGameAddress,
      signers.challenger,
    );
    const creatorScore = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      creatorState.score,
      mystBetGameAddress,
      signers.creator,
    );
    const challengerScore = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      challengerState.score,
      mystBetGameAddress,
      signers.challenger,
    );

    expect(creatorCoins).to.eq(7);
    expect(challengerCoins).to.eq(5);
    expect(creatorScore).to.eq(0);
    expect(challengerScore).to.eq(1);

    const game = await mystBetGame.getGame(gameId);
    expect(game.status).to.eq(2);
    expect(game.currentRound).to.eq(2);
  });

  it("prevents spending more coins than available", async function () {
    const gameId = await startDefaultGame();
    const invalidMove = await encryptMove(11, signers.creator);

    await mystBetGame
      .connect(signers.creator)
      .submitEncryptedMove(gameId, invalidMove.handles[0], invalidMove.inputProof);

    // challenger submits to resolve the round
    const challengerMove = await encryptMove(0, signers.challenger);
    await mystBetGame
      .connect(signers.challenger)
      .submitEncryptedMove(gameId, challengerMove.handles[0], challengerMove.inputProof);

    const creatorState = await mystBetGame.getPlayerState(gameId, signers.creator.address);
    const creatorCoins = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      creatorState.coins,
      mystBetGameAddress,
      signers.creator,
    );

    expect(creatorCoins).to.eq(0);
  });

  it("finishes once both players have spent every coin", async function () {
    const gameId = await startDefaultGame();

    const pattern = [
      { creator: 2, challenger: 2 },
      { creator: 2, challenger: 2 },
      { creator: 3, challenger: 3 },
      { creator: 3, challenger: 3 },
    ];

    for (const round of pattern) {
      const creatorMove = await encryptMove(round.creator, signers.creator);
      await mystBetGame
        .connect(signers.creator)
        .submitEncryptedMove(gameId, creatorMove.handles[0], creatorMove.inputProof);

      const challengerMove = await encryptMove(round.challenger, signers.challenger);
      await mystBetGame
        .connect(signers.challenger)
        .submitEncryptedMove(gameId, challengerMove.handles[0], challengerMove.inputProof);
    }

    await mystBetGame.prepareDecryption(gameId);

    const playerAState = await mystBetGame.getPlayerState(gameId, signers.creator.address);
    const playerBState = await mystBetGame.getPlayerState(gameId, signers.challenger.address);

    const handles = [
      playerAState.coins,
      playerBState.coins,
      playerAState.score,
      playerBState.score,
    ];

    const publicDecryption = await hre.fhevm.publicDecrypt(handles);

    await mystBetGame.finalizeWithProof(
      gameId,
      publicDecryption.abiEncodedClearValues,
      publicDecryption.decryptionProof,
    );

    const finalGame = await mystBetGame.getGame(gameId);
    expect(finalGame.status).to.eq(3);
    expect(finalGame.isTie).to.eq(true);
    expect(finalGame.winner).to.eq(ethers.ZeroAddress);
  });
});
