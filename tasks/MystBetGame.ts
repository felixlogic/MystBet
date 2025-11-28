import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

const CONTRACT_NAME = "MystBetGame";

task("task:game-address", "Prints the MystBetGame address").setAction(async function (_taskArguments, hre) {
  const { deployments } = hre;
  const contractDeployment = await deployments.get(CONTRACT_NAME);
  console.log(`${CONTRACT_NAME} address: ${contractDeployment.address}`);
});

task("task:create-game", "Creates a new MystBet game")
  .addOptionalParam("address", "Override address of deployed MystBetGame contract")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get(CONTRACT_NAME);
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);

    console.log(`Creating game from ${await signer.getAddress()}...`);
    const tx = await contract.connect(signer).createGame();
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:join-game", "Joins an existing MystBet game")
  .addParam("game", "Game id to join")
  .addOptionalParam("address", "Override address of deployed MystBetGame contract")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get(CONTRACT_NAME);
    const [_, joiner] = await ethers.getSigners();
    const contract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
    const gameId = BigInt(taskArgs.game);

    console.log(`Joining game ${gameId} from ${await joiner.getAddress()}...`);
    const tx = await contract.connect(joiner).joinGame(gameId);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:start-game", "Starts a MystBet game that has two players")
  .addParam("game", "Game id to start")
  .addOptionalParam("address", "Override address of deployed MystBetGame contract")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get(CONTRACT_NAME);
    const contract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
    const gameId = BigInt(taskArgs.game);

    console.log(`Starting game ${gameId}...`);
    const tx = await contract.startGame(gameId);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:submit-move", "Submits encrypted coins for a MystBet round")
  .addParam("game", "Game id")
  .addParam("value", "Coin amount (integer)")
  .addOptionalParam("address", "Override address of deployed MystBetGame contract")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;
    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get(CONTRACT_NAME);
    const [_, player] = await ethers.getSigners();
    const contract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
    const gameId = BigInt(taskArgs.game);
    const wager = parseInt(taskArgs.value);
    if (!Number.isInteger(wager) || wager < 0) {
      throw new Error("--value must be a non-negative integer");
    }

    await fhevm.initializeCLIApi();
    const encryptedInput = await fhevm
      .createEncryptedInput(deployment.address, await player.getAddress())
      .add32(wager)
      .encrypt();

    console.log(`Submitting encrypted move ${wager} for game ${gameId}...`);
    const tx = await contract
      .connect(player)
      .submitEncryptedMove(gameId, encryptedInput.handles[0], encryptedInput.inputProof);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:decrypt-state", "Decrypts a player's encrypted coins and score")
  .addParam("game", "Game id")
  .addParam("player", "Player address")
  .addOptionalParam("address", "Override address of deployed MystBetGame contract")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;
    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get(CONTRACT_NAME);
    const contract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
    const gameId = BigInt(taskArgs.game);
    const playerAddress = taskArgs.player as string;

    await fhevm.initializeCLIApi();
    const state = await contract.getPlayerState(gameId, playerAddress);

    const signer = await ethers.getSigner(playerAddress);
    const coins = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      state.coins,
      deployment.address,
      signer,
    );
    const score = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      state.score,
      deployment.address,
      signer,
    );

    console.log(`Player ${playerAddress}`);
    console.log(`  Coins: ${coins}`);
    console.log(`  Score: ${score}`);
  });
