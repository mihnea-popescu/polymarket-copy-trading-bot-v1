import { ethers } from 'ethers';
import { ENV } from '../config/env';

const RPC_URL = ENV.RPC_URL;
const USDC_CONTRACT_ADDRESS = ENV.USDC_CONTRACT_ADDRESS;

const USDC_ABI = ['function balanceOf(address owner) view returns (uint256)'];

const getMyBalance = async (address: string): Promise<number> => {
    const polygonNetwork = {
        name: 'polygon',
        chainId: 137,
    };
    const rpcProvider = new ethers.providers.StaticJsonRpcProvider(RPC_URL, polygonNetwork);

    try {
        await rpcProvider.getNetwork();
    } catch (error) {
        console.error(
            'RPC connection error. Please check your RPC_URL:',
            RPC_URL ? `${RPC_URL.substring(0, 30)}...` : 'undefined'
        );
        throw new Error(
            `Failed to connect to RPC endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, rpcProvider);
    const balance_usdc = await usdcContract.balanceOf(address);
    const balance_usdc_real = ethers.utils.formatUnits(balance_usdc, 6);
    return parseFloat(balance_usdc_real);
};

export default getMyBalance;
