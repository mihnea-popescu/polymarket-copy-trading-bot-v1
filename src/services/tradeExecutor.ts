import { ClobClient } from '@polymarket/clob-client';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { ENV } from '../config/env';
import { getUserActivityModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';
import spinner from '../utils/spinner';
import getMyBalance from '../utils/getMyBalance';
import postOrder from '../utils/postOrder';

const USER_ADDRESS = ENV.USER_ADDRESS;
const RETRY_LIMIT = ENV.RETRY_LIMIT;
const PROXY_WALLET = ENV.PROXY_WALLET;

let temp_trades: UserActivityInterface[] = [];

const UserActivity = getUserActivityModel(USER_ADDRESS);

const readTempTrade = async () => {
    temp_trades = (
        await UserActivity.find({
            $and: [{ type: 'TRADE' }, { bot: false }, { botExcutedTime: { $lt: RETRY_LIMIT } }],
        }).exec()
    )
        .map((trade) => trade as UserActivityInterface)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // Sort in decreasing chronological order (newest first)
};

const doTrading = async (clobClient: ClobClient) => {
    const now = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
    const MAX_AGE_SECONDS = 5 * 60; // 5 minutes in seconds
    
    for (const trade of temp_trades) {
        console.log('Trade to copy:', trade);
        
        // Skip trades older than 5 minutes
        if (trade.timestamp && (now - trade.timestamp) > MAX_AGE_SECONDS) {
            const ageMinutes = ((now - trade.timestamp) / 60).toFixed(2);
            console.log(`Trade is ${ageMinutes} minutes old (more than 5 minutes). Skipping.`);
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            continue;
        }
        
        try {
            const my_positions: UserPositionInterface[] = await fetchData(
                `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
            );
            const user_positions: UserPositionInterface[] = await fetchData(
                `https://data-api.polymarket.com/positions?user=${USER_ADDRESS}`
            );
            const my_position = my_positions.find(
                (position: UserPositionInterface) => position.conditionId === trade.conditionId
            );
            const user_position = user_positions.find(
                (position: UserPositionInterface) => position.conditionId === trade.conditionId
            );
            const my_balance = await getMyBalance(PROXY_WALLET);
            const user_balance = await getMyBalance(USER_ADDRESS);
            console.log('My current balance:', my_balance);
            console.log('User current balance:', user_balance);
            
            let condition: 'buy' | 'sell' | 'merge' = 'buy';
            
            if (trade.side === 'SELL' || trade.side === 'sell') {
                if (my_position && user_position && my_position.size > user_position.size) {
                    condition = 'merge';
                } else {
                    condition = 'sell';
                }
            } else if (trade.side === 'BUY' || trade.side === 'buy') {
                condition = 'buy';
            }
            
            console.log('Determined condition:', condition);
            await postOrder(
                clobClient,
                condition,
                my_position,
                user_position,
                trade,
                my_balance,
                user_balance
            );
        } catch (error) {
            console.error('Error executing trade:', error);
            await UserActivity.updateOne({ _id: trade._id }, { botExcutedTime: RETRY_LIMIT });
        }
    }
};

const tradeExcutor = async (clobClient: ClobClient) => {
    console.log(`Executing Copy Trading`);

    while (true) {
        await readTempTrade();
        if (temp_trades.length > 0) {
            console.log('💥 New transactions found 💥');
            spinner.stop();
            await doTrading(clobClient);
        } else {
            spinner.start('Waiting for new transactions');
        }
    }
};

export default tradeExcutor;
