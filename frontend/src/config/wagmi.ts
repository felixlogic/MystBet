import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'MystBet',
  projectId: '6767c4acf5f053fd9e66f5648432c05e',
  chains: [sepolia],
  ssr: false,
});
