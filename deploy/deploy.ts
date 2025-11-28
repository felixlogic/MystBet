import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedMystBetGame = await deploy("MystBetGame", {
    from: deployer,
    log: true,
  });

  console.log(`MystBetGame contract: `, deployedMystBetGame.address);
};
export default func;
func.id = "deploy_mystBetGame"; // id required to prevent reexecution
func.tags = ["MystBetGame"];
