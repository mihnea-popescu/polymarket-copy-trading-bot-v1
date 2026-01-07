import moment from 'moment';
import { ENV } from '../config/env';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { getUserActivityModel, getUserPositionModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';

const USER_ADDRESS = ENV.USER_ADDRESS;
const TOO_OLD_TIMESTAMP = ENV.TOO_OLD_TIMESTAMP;
const FETCH_INTERVAL = ENV.FETCH_INTERVAL;

if (!USER_ADDRESS) {
    throw new Error('USER_ADDRESS is not defined');
}

const UserActivity = getUserActivityModel(USER_ADDRESS);
const UserPosition = getUserPositionModel(USER_ADDRESS);

let temp_trades: UserActivityInterface[] = [];

const init = async () => {
    temp_trades = (await UserActivity.find().exec()).map((trade) => trade as UserActivityInterface);
};

const fetchTradeData = async () => {
    try {
        const activities: UserActivityInterface[] = await fetchData(
            `https://data-api.polymarket.com/activity?user=${USER_ADDRESS}`
        );
        
        const now = moment().unix();
        const tooOldTimestamp = now - TOO_OLD_TIMESTAMP * 3600;
        
        for (const activity of activities) {
            if (activity.type === 'TRADE' && activity.timestamp > tooOldTimestamp) {
                const existingTrade = await UserActivity.findOne({
                    transactionHash: activity.transactionHash,
                }).exec();
                
                if (!existingTrade) {
                    const newTrade = new UserActivity({
                        ...activity,
                        proxyWallet: USER_ADDRESS,
                        bot: false,
                        botExcutedTime: 0,
                    });
                    await newTrade.save();
                    console.log('New trade detected:', activity.transactionHash);
                }
            }
        }
    } catch (error) {
        console.error('Error fetching trade data:', error);
    }
};

const tradeMonitor = async () => {
    console.log('Trade Monitor is running every', FETCH_INTERVAL, 'seconds');
    await init();    //Load my oders before sever downs
    while (true) {
        await fetchTradeData();     //Fetch all user activities
        await new Promise((resolve) => setTimeout(resolve, FETCH_INTERVAL * 1000));     //Fetch user activities every second
    }
};

export default tradeMonitor;
