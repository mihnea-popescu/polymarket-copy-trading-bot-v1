import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { ENV } from '../config/env';
import { UserPositionInterface } from '../interfaces/User';
import fetchData from '../utils/fetchData';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL;
const CLAIM_INTERVAL = 60 * 1000; // 1 minute in milliseconds

// ConditionalTokens contract address on Polygon (Gnosis ConditionalTokens)
const CONDITIONAL_TOKENS_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// ABI for redeemPositions function - simplified version that accepts token IDs
const CONDITIONAL_TOKENS_ABI = [
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets, uint256[] calldata amounts) external',
    'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) external'
];

const claimPositions = async (clobClient: ClobClient) => {
    try {
        console.log('Checking for redeemable positions...');
        
        const positions: UserPositionInterface[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
        );
        
        const redeemablePositions = positions.filter(
            (position) => position.redeemable === true && position.size > 0
        );
        
        if (redeemablePositions.length === 0) {
            console.log('No redeemable positions found.');
            return;
        }
        
        console.log(`Found ${redeemablePositions.length} redeemable position(s) to claim.`);
        
        const polygonNetwork = {
            name: 'polygon',
            chainId: 137,
        };
        const rpcProvider = new ethers.providers.StaticJsonRpcProvider(RPC_URL, polygonNetwork);
        const wallet = new ethers.Wallet(PRIVATE_KEY as string, rpcProvider);
        
        const conditionalTokensContract = new ethers.Contract(
            CONDITIONAL_TOKENS_ADDRESS,
            CONDITIONAL_TOKENS_ABI,
            wallet
        );
        
        for (const position of redeemablePositions) {
            try {
                console.log(`Claiming position: ${position.title} - ${position.outcome} (Condition ID: ${position.conditionId})`);
                
                const tokenId = position.asset;
                
                if (!tokenId) {
                    console.error(`No token ID found for position ${position.conditionId}. Skipping.`);
                    continue;
                }
                
                const positionSize = ethers.utils.parseUnits(position.size.toString(), 18);
                const indexSet = position.outcomeIndex;
                
                const collateralToken = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC on Polygon
                const parentCollectionId = ethers.constants.HashZero;
                const conditionId = position.conditionId;
                
                if (!conditionId || conditionId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
                    console.error(`Invalid condition ID for position. Skipping.`);
                    continue;
                }
                
                const indexSets = [indexSet];
                const amounts = [positionSize];
                
                console.log(`Redeeming with params:`, {
                    collateralToken,
                    parentCollectionId,
                    conditionId,
                    indexSets,
                    amounts: amounts.map(a => ethers.utils.formatUnits(a, 18))
                });
                
                const tx = await conditionalTokensContract.redeemPositions(
                    collateralToken,
                    parentCollectionId,
                    conditionId,
                    indexSets,
                    amounts,
                    { gasLimit: 500000 }
                );
                
                console.log(`Transaction submitted: ${tx.hash}`);
                const receipt = await tx.wait();
                
                if (receipt.status === 1) {
                    console.log(`✅ Successfully claimed position: ${position.title} - ${position.outcome}`);
                    console.log(`Transaction hash: ${tx.hash}`);
                } else {
                    console.error(`❌ Transaction failed for position: ${position.title} - ${position.outcome}`);
                }
            } catch (error: any) {
                console.error(`Error claiming position ${position.conditionId}:`, error.message || error);
                if (error.reason) {
                    console.error(`Reason: ${error.reason}`);
                }
                if (error.data) {
                    console.error(`Error data:`, error.data);
                }
            }
        }
    } catch (error: any) {
        console.error('Error in claimPositions:', error.message || error);
    }
};

const positionClaimer = async (clobClient: ClobClient) => {
    console.log('Position Claimer started. Will check for redeemable positions every minute.');
    
    while (true) {
        await claimPositions(clobClient);
        await new Promise((resolve) => setTimeout(resolve, CLAIM_INTERVAL));
    }
};

export default positionClaimer;

