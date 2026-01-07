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
let botStartTimestamp: number | null = null;

const UserActivity = getUserActivityModel(USER_ADDRESS);

const readTempTrade = async () => {
    const allTrades = (
        await UserActivity.find({
            $and: [{ type: 'TRADE' }, { bot: false }, { botExcutedTime: { $lt: RETRY_LIMIT } }],
        }).exec()
    )
        .map((trade) => trade as UserActivityInterface)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // Sort in decreasing chronological order (newest first)
    
    // Filter trades: only include those that occurred after bot started and contain "Bitcoin"
    let filteredTrades = allTrades;
    
    // Only include trades that occurred after the bot started
    // Both timestamps are Unix timestamps in seconds (timezone-independent)
    if (botStartTimestamp !== null) {
        filteredTrades = filteredTrades.filter((trade) => {
            if (!trade.timestamp) return false;
            return trade.timestamp >= botStartTimestamp!;
        });
    }
    
    // Only include trades that contain "Bitcoin" in title, name, or outcome
    temp_trades = filteredTrades.filter((trade) => {
        const searchText = 'Bitcoin';
        const title = (trade.title || '').toLowerCase();
        const name = (trade.name || '').toLowerCase();
        const outcome = (trade.outcome || '').toLowerCase();
        const searchLower = searchText.toLowerCase();
        
        return title.includes(searchLower) || name.includes(searchLower) || outcome.includes(searchLower);
    });
};

const doTrading = async (clobClient: ClobClient) => {
    const now = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
    const MAX_AGE_SECONDS = 5 * 60; // 5 minutes in seconds
    
    for (const trade of temp_trades) {
        console.log('Trade to copy:', trade);
        
        // Skip trades that don't contain "Bitcoin" (safety check)
        const searchText = 'Bitcoin';
        const title = (trade.title || '').toLowerCase();
        const name = (trade.name || '').toLowerCase();
        const outcome = (trade.outcome || '').toLowerCase();
        const searchLower = searchText.toLowerCase();
        
        if (!title.includes(searchLower) && !name.includes(searchLower) && !outcome.includes(searchLower)) {
            console.log(`Trade does not contain "Bitcoin". Skipping. (title: ${trade.title}, name: ${trade.name}, outcome: ${trade.outcome})`);
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            continue;
        }
        
        // Skip trades that occurred before the bot started
        if (botStartTimestamp !== null && trade.timestamp && trade.timestamp < botStartTimestamp) {
            console.log(`Trade occurred before bot started (trade timestamp: ${trade.timestamp}, bot start: ${botStartTimestamp}). Skipping.`);
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            continue;
        }
        
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
    // Set bot start timestamp when the bot starts
    // Using Unix timestamp in seconds (timezone-independent, UTC-based)
    // This matches the format of trade.timestamp from the Polymarket API
    botStartTimestamp = Math.floor(Date.now() / 1000);
    console.log(`Executing Copy Trading`);
    console.log(`Bot started at timestamp: ${botStartTimestamp} (will only copy trades after this time)`);
    console.log(`Filter: Only copying trades that contain "Bitcoin" in title, name, or outcome`);

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
