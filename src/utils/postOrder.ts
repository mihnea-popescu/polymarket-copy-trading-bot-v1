import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { getUserActivityModel } from '../models/userHistory';
import { ENV } from '../config/env';
import fetchData from './fetchData';

const RETRY_LIMIT = ENV.RETRY_LIMIT;
const USER_ADDRESS = ENV.USER_ADDRESS;
const UserActivity = getUserActivityModel(USER_ADDRESS);
const MIN_ORDER_SIZE_USDC = 0.01; // Internal minimum for validation
const POLYMARKET_MIN_ORDER_SIZE_USDC = 1.0; // Actual Polymarket minimum order size
const FALLBACK_MIN_ORDER_SIZE_USDC = 2.0;

const postOrder = async (
    clobClient: ClobClient,
    condition: string,
    my_position: UserPositionInterface | undefined,
    user_position: UserPositionInterface | undefined,
    trade: UserActivityInterface,
    my_balance: number,
    user_balance: number
) => {
    //Merge strategy
    if (condition === 'merge') {
        console.log('Merging Strategy...');
        if (!my_position) {
            console.log('my_position is undefined');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            return;
        }
        // Use my_position.asset as it's from the live API and should be correct
        const tokenId = my_position.asset || trade.asset;
        console.log(
            `Using token ID for merge: ${tokenId} (my_position.asset: ${my_position.asset}, trade.asset: ${trade.asset})`
        );
        let remaining = my_position.size;
        let retry = 0;
        while (remaining > 0 && retry < RETRY_LIMIT) {
            let orderBook;
            try {
                console.log(`Fetching orderbook for token ID: ${tokenId}`);
                orderBook = await clobClient.getOrderBook(tokenId);
            } catch (error: any) {
                console.log(
                    `Error fetching orderbook for token ${tokenId}:`,
                    error?.data?.error || error?.message || 'Unknown error'
                );
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            if (!orderBook || !orderBook.bids || orderBook.bids.length === 0) {
                console.log('No bids found or orderbook does not exist');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const maxPriceBid = orderBook.bids.reduce((max, bid) => {
                return parseFloat(bid.price) > parseFloat(max.price) ? bid : max;
            }, orderBook.bids[0]);

            console.log('Max price bid:', maxPriceBid);
            let order_arges;
            let calculatedAmount: number;
            if (remaining <= parseFloat(maxPriceBid.size)) {
                calculatedAmount = remaining;
            } else {
                calculatedAmount = parseFloat(maxPriceBid.size);
            }

            const orderValue = calculatedAmount * parseFloat(maxPriceBid.price);
            if (orderValue < MIN_ORDER_SIZE_USDC) {
                console.log(
                    `Order value ${orderValue} is below minimum ${MIN_ORDER_SIZE_USDC} USDC. Skipping order.`
                );
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            order_arges = {
                side: Side.SELL,
                tokenID: tokenId,
                amount: calculatedAmount,
                price: parseFloat(maxPriceBid.price),
            };
            console.log('Order args:', order_arges);
            const signedOrder = await clobClient.createMarketOrder(order_arges);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            if (resp.success === true) {
                retry = 0;
                console.log('Successfully posted order:', resp);
                remaining -= order_arges.amount;
            } else {
                retry += 1;
                console.log('Error posting order: retrying...', resp);
            }
        }
        if (retry >= RETRY_LIMIT) {
            await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: retry });
        } else {
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        }
    } else if (condition === 'buy') {
        //Buy strategy
        console.log('Buy Strategy...');

        // First, check if market is still active by fetching market info
        try {
            const market = await clobClient.getMarket(trade.conditionId);
            if (market) {
                if (
                    market.closed === true ||
                    market.accepting_orders === false ||
                    market.enable_order_book === false
                ) {
                    console.log(
                        `Market is closed or not accepting orders. Skipping trade. (closed: ${market.closed}, accepting_orders: ${market.accepting_orders}, enable_order_book: ${market.enable_order_book})`
                    );
                    await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                    return;
                }
            }
        } catch (marketCheckError: any) {
            console.log(
                `Could not check market status: ${marketCheckError?.message || 'Unknown error'}. Proceeding anyway...`
            );
        }

        // Always use ratio algorithm based on portfolio percentage
        const ratio = my_balance / (user_balance + trade.usdcSize);
        console.log('Portfolio ratio:', ratio);
        let remaining: number = trade.usdcSize * ratio;
        console.log(`Calculated order size based on ratio: ${remaining.toFixed(4)} USDC`);

        // Determine the correct token ID to use
        // Try multiple sources: user_position, market API, then trade.asset
        let tokenId = trade.asset;
        if (user_position && user_position.asset) {
            tokenId = user_position.asset;
            console.log(
                `Using token ID from user position: ${tokenId} (trade.asset was: ${trade.asset})`
            );
        } else {
            // Try to get token ID from market API using conditionId
            try {
                console.log(
                    `Attempting to fetch market info for conditionId: ${trade.conditionId}`
                );
                const market = await clobClient.getMarket(trade.conditionId);
                console.log(
                    `Market API response structure:`,
                    JSON.stringify(market, null, 2).substring(0, 500)
                );
                // Check different possible structures for token IDs
                if (market) {
                    let marketTokenId: string | undefined;
                    // Try market.tokens array
                    if (
                        market.tokens &&
                        Array.isArray(market.tokens) &&
                        market.tokens.length > trade.outcomeIndex
                    ) {
                        const tokenValue = market.tokens[trade.outcomeIndex];
                        // Handle both string and object formats
                        if (typeof tokenValue === 'string') {
                            marketTokenId = tokenValue;
                        } else if (tokenValue && typeof tokenValue === 'object') {
                            marketTokenId =
                                tokenValue.token_id || tokenValue.tokenId || tokenValue.tokenID;
                        }
                    }
                    // Try market.outcomes array
                    else if (
                        market.outcomes &&
                        Array.isArray(market.outcomes) &&
                        market.outcomes.length > trade.outcomeIndex
                    ) {
                        const outcomeValue = market.outcomes[trade.outcomeIndex];
                        if (typeof outcomeValue === 'string') {
                            marketTokenId = outcomeValue;
                        } else if (outcomeValue && typeof outcomeValue === 'object') {
                            marketTokenId =
                                outcomeValue.token_id ||
                                outcomeValue.tokenId ||
                                outcomeValue.tokenID;
                        }
                    }
                    // Try market.assets array
                    else if (
                        market.assets &&
                        Array.isArray(market.assets) &&
                        market.assets.length > trade.outcomeIndex
                    ) {
                        const assetValue = market.assets[trade.outcomeIndex];
                        if (typeof assetValue === 'string') {
                            marketTokenId = assetValue;
                        } else if (assetValue && typeof assetValue === 'object') {
                            marketTokenId =
                                assetValue.token_id || assetValue.tokenId || assetValue.tokenID;
                        }
                    }

                    if (marketTokenId && typeof marketTokenId === 'string') {
                        tokenId = marketTokenId;
                        console.log(
                            `Using token ID from market API: ${tokenId} (outcomeIndex: ${trade.outcomeIndex})`
                        );
                    } else {
                        console.log(
                            `Market API response does not contain valid token ID for outcomeIndex ${trade.outcomeIndex}`
                        );
                    }
                }
            } catch (marketError: any) {
                console.log(
                    `Could not fetch market info from CLOB API: ${marketError?.message || 'Unknown error'}`
                );
                // Try Polymarket data API as fallback
                try {
                    const marketData = await fetchData(
                        `https://data-api.polymarket.com/markets?condition_id=${trade.conditionId}`
                    );
                    console.log(
                        `Data API response:`,
                        JSON.stringify(marketData, null, 2).substring(0, 500)
                    );
                    if (marketData && marketData.length > 0) {
                        const marketItem = marketData[0];
                        let dataApiTokenId: string | undefined;
                        // Try different possible structures
                        if (
                            marketItem.tokens &&
                            Array.isArray(marketItem.tokens) &&
                            marketItem.tokens.length > trade.outcomeIndex
                        ) {
                            const tokenValue = marketItem.tokens[trade.outcomeIndex];
                            if (typeof tokenValue === 'string') {
                                dataApiTokenId = tokenValue;
                            } else if (tokenValue && typeof tokenValue === 'object') {
                                dataApiTokenId =
                                    tokenValue.token_id || tokenValue.tokenId || tokenValue.tokenID;
                            }
                        } else if (
                            marketItem.outcomes &&
                            Array.isArray(marketItem.outcomes) &&
                            marketItem.outcomes.length > trade.outcomeIndex
                        ) {
                            const outcomeValue = marketItem.outcomes[trade.outcomeIndex];
                            if (typeof outcomeValue === 'string') {
                                dataApiTokenId = outcomeValue;
                            } else if (outcomeValue && typeof outcomeValue === 'object') {
                                dataApiTokenId =
                                    outcomeValue.token_id ||
                                    outcomeValue.tokenId ||
                                    outcomeValue.tokenID;
                            }
                        }

                        if (dataApiTokenId && typeof dataApiTokenId === 'string') {
                            tokenId = dataApiTokenId;
                            console.log(
                                `Using token ID from Polymarket data API: ${tokenId} (outcomeIndex: ${trade.outcomeIndex})`
                            );
                        } else {
                            console.log(
                                `Data API response does not contain valid token ID for outcomeIndex ${trade.outcomeIndex}`
                            );
                        }
                    }
                } catch (dataApiError: any) {
                    console.log(
                        `Could not fetch market info from data API: ${dataApiError?.message || 'Unknown error'}`
                    );
                    console.log(`Falling back to trade.asset: ${tokenId}`);
                }
            }
        }

        let retry = 0;
        let useFallbackAmount = false;
        let consecutiveSignatureErrors = 0;
        const MAX_CONSECUTIVE_SIGNATURE_ERRORS = 3;
        while (remaining > 0 && retry < RETRY_LIMIT) {
            let orderBook;
            try {
                console.log(`Fetching orderbook for token ID: ${tokenId}`);
                orderBook = await clobClient.getOrderBook(tokenId);
            } catch (error: any) {
                console.log(
                    `Error fetching orderbook for token ${tokenId}:`,
                    error?.data?.error || error?.message || 'Unknown error'
                );
                // If we haven't tried user_position.asset yet, try it
                if (tokenId !== user_position?.asset && user_position && user_position.asset) {
                    console.log(`Retrying with user_position.asset: ${user_position.asset}`);
                    tokenId = user_position.asset;
                    continue;
                }
                // If we haven't tried market API yet, try it
                if (tokenId === trade.asset) {
                    try {
                        console.log(
                            `Attempting to fetch market info for conditionId: ${trade.conditionId}`
                        );
                        const market = await clobClient.getMarket(trade.conditionId);
                        if (market) {
                            let marketTokenId: string | undefined;
                            if (
                                market.tokens &&
                                Array.isArray(market.tokens) &&
                                market.tokens.length > trade.outcomeIndex
                            ) {
                                const tokenValue = market.tokens[trade.outcomeIndex];
                                if (typeof tokenValue === 'string') {
                                    marketTokenId = tokenValue;
                                } else if (tokenValue && typeof tokenValue === 'object') {
                                    marketTokenId =
                                        tokenValue.token_id ||
                                        tokenValue.tokenId ||
                                        tokenValue.tokenID;
                                }
                            }
                            if (
                                marketTokenId &&
                                typeof marketTokenId === 'string' &&
                                marketTokenId !== tokenId
                            ) {
                                console.log(
                                    `Retrying with token ID from market API: ${marketTokenId}`
                                );
                                tokenId = marketTokenId;
                                continue;
                            }
                        }
                    } catch (marketError: any) {
                        console.log(
                            `Could not fetch market info: ${marketError?.message || 'Unknown error'}`
                        );
                    }
                }
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            if (!orderBook || !orderBook.asks || orderBook.asks.length === 0) {
                console.log('No asks found or orderbook does not exist');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const minPriceAsk = orderBook.asks.reduce((min, ask) => {
                return parseFloat(ask.price) < parseFloat(min.price) ? ask : min;
            }, orderBook.asks[0]);

            console.log('Min price ask:', minPriceAsk);
            if (parseFloat(minPriceAsk.price) - 0.05 > trade.price) {
                console.log('Too big different price - do not copy');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const minAskValue = parseFloat(minPriceAsk.size) * parseFloat(minPriceAsk.price);
            const minAskPrice = parseFloat(minPriceAsk.price);
            let calculatedAmount: number;

            if (useFallbackAmount) {
                calculatedAmount = Math.min(
                    FALLBACK_MIN_ORDER_SIZE_USDC,
                    Math.min(minAskValue, my_balance)
                );
                console.log(
                    `Using fallback amount due to previous signature error: ${calculatedAmount.toFixed(4)} USDC`
                );
            } else if (remaining >= minAskValue) {
                // Use the minimum ask value if remaining is large enough
                calculatedAmount = Math.min(remaining, minAskValue);
            } else {
                // If calculated amount is too small, try to use minimum ask price and buy 1 share
                const oneShareValue = minAskPrice;

                // Check if 1 share meets Polymarket's minimum order size requirement
                if (oneShareValue < POLYMARKET_MIN_ORDER_SIZE_USDC) {
                    // If 1 share is below $1 minimum, calculate how many shares needed for $1
                    const sharesNeededForMin = Math.ceil(
                        POLYMARKET_MIN_ORDER_SIZE_USDC / minAskPrice
                    );
                    const minOrderValue = sharesNeededForMin * minAskPrice;

                    if (minOrderValue <= my_balance) {
                        calculatedAmount = minOrderValue;
                        console.log(
                            `Calculated amount ${remaining.toFixed(4)} USDC is below minimum ask ${minAskValue.toFixed(4)} USDC. One share (${oneShareValue.toFixed(4)} USDC) is below $1 minimum. Using minimum order size: ${calculatedAmount.toFixed(4)} USDC (${sharesNeededForMin} shares)`
                        );
                    } else if (oneShareValue < MIN_ORDER_SIZE_USDC) {
                        console.log(
                            `One share value ${oneShareValue.toFixed(4)} USDC is below internal minimum ${MIN_ORDER_SIZE_USDC} USDC. Skipping order.`
                        );
                        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                        break;
                    } else {
                        console.log(
                            `One share value ${oneShareValue.toFixed(4)} USDC is below Polymarket minimum $${POLYMARKET_MIN_ORDER_SIZE_USDC}. Cannot afford minimum order size (need $${minOrderValue.toFixed(4)}, have $${my_balance.toFixed(4)}). Skipping order.`
                        );
                        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                        break;
                    }
                } else {
                    // 1 share is >= $1, so we can buy 1 share
                    calculatedAmount = oneShareValue;
                    console.log(
                        `Calculated amount ${remaining.toFixed(4)} USDC is below minimum ask ${minAskValue.toFixed(4)} USDC. Using minimum ask price and buying 1 share (${calculatedAmount.toFixed(4)} USDC)`
                    );
                }
            }

            // Ensure order meets Polymarket's minimum order size requirement
            if (calculatedAmount < POLYMARKET_MIN_ORDER_SIZE_USDC) {
                console.log(
                    `Order amount ${calculatedAmount.toFixed(4)} USDC is below Polymarket minimum $${POLYMARKET_MIN_ORDER_SIZE_USDC}. Skipping order.`
                );
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            if (calculatedAmount < MIN_ORDER_SIZE_USDC) {
                console.log(
                    `Order amount ${calculatedAmount} is below absolute minimum ${MIN_ORDER_SIZE_USDC} USDC. Skipping order.`
                );
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            if (calculatedAmount > my_balance) {
                console.log(
                    `Calculated amount ${calculatedAmount} exceeds available balance ${my_balance}. Adjusting to available balance.`
                );
                if (my_balance >= POLYMARKET_MIN_ORDER_SIZE_USDC) {
                    // Calculate how many shares we can buy with available balance
                    const sharesWithBalance = Math.floor(my_balance / minAskPrice);
                    if (sharesWithBalance > 0) {
                        calculatedAmount = sharesWithBalance * minAskPrice;
                        console.log(
                            `Adjusted to ${calculatedAmount.toFixed(4)} USDC (${sharesWithBalance} shares) based on available balance`
                        );
                    } else {
                        console.log(
                            `Available balance ${my_balance} cannot buy even 1 share. Skipping order.`
                        );
                        await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                        break;
                    }
                } else {
                    console.log(
                        `Available balance ${my_balance} is below Polymarket minimum $${POLYMARKET_MIN_ORDER_SIZE_USDC}. Skipping order.`
                    );
                    await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                    break;
                }
            }

            let order_arges = {
                side: Side.BUY,
                tokenID: tokenId,
                amount: calculatedAmount,
                price: minAskPrice,
            };
            console.log('Order args:', order_arges);
            const signedOrder = await clobClient.createMarketOrder(order_arges);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            if (resp.success === true) {
                retry = 0;
                useFallbackAmount = false;
                consecutiveSignatureErrors = 0;
                console.log('Successfully posted order:', resp);
                remaining -= order_arges.amount;
            } else {
                const isSignatureError =
                    resp.error === 'invalid signature' ||
                    (resp as any)?.data?.error === 'invalid signature';
                if (isSignatureError) {
                    consecutiveSignatureErrors += 1;
                    console.log(
                        `Invalid signature error detected (${consecutiveSignatureErrors}/${MAX_CONSECUTIVE_SIGNATURE_ERRORS}). Will use fallback minimum order amount on next retry.`
                    );
                    useFallbackAmount = true;

                    // If we've had too many consecutive signature errors, stop retrying
                    if (consecutiveSignatureErrors >= MAX_CONSECUTIVE_SIGNATURE_ERRORS) {
                        console.log(
                            `Too many consecutive signature errors (${consecutiveSignatureErrors}). This likely indicates a configuration issue. Skipping trade.`
                        );
                        await UserActivity.updateOne(
                            { _id: trade._id },
                            { bot: true, botExcutedTime: retry }
                        );
                        break;
                    }
                } else {
                    consecutiveSignatureErrors = 0; // Reset counter on non-signature errors
                }
                retry += 1;
                console.log('Error posting order: retrying...', resp);
            }
        }
        if (retry >= RETRY_LIMIT) {
            await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: retry });
        } else {
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        }
    } else if (condition === 'sell') {
        //Sell strategy
        console.log('Sell Strategy...');
        let remaining = 0;
        if (!my_position) {
            console.log('No position to sell');
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
            return;
        }
        // Use my_position.asset as it's from the live API and should be correct
        const tokenId = my_position.asset || trade.asset;
        console.log(
            `Using token ID for sell: ${tokenId} (my_position.asset: ${my_position.asset}, trade.asset: ${trade.asset})`
        );
        if (!user_position) {
            remaining = my_position.size;
        } else {
            const ratio = trade.size / (user_position.size + trade.size);
            console.log('ratio', ratio);
            remaining = my_position.size * ratio;
        }
        let retry = 0;
        while (remaining > 0 && retry < RETRY_LIMIT) {
            let orderBook;
            try {
                console.log(`Fetching orderbook for token ID: ${tokenId}`);
                orderBook = await clobClient.getOrderBook(tokenId);
            } catch (error: any) {
                console.log(
                    `Error fetching orderbook for token ${tokenId}:`,
                    error?.data?.error || error?.message || 'Unknown error'
                );
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            if (!orderBook || !orderBook.bids || orderBook.bids.length === 0) {
                console.log('No bids found or orderbook does not exist');
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            const maxPriceBid = orderBook.bids.reduce((max, bid) => {
                return parseFloat(bid.price) > parseFloat(max.price) ? bid : max;
            }, orderBook.bids[0]);

            console.log('Max price bid:', maxPriceBid);
            let order_arges;
            let calculatedAmount: number;
            if (remaining <= parseFloat(maxPriceBid.size)) {
                calculatedAmount = remaining;
            } else {
                calculatedAmount = parseFloat(maxPriceBid.size);
            }

            const orderValue = calculatedAmount * parseFloat(maxPriceBid.price);
            if (orderValue < MIN_ORDER_SIZE_USDC) {
                console.log(
                    `Order value ${orderValue} is below minimum ${MIN_ORDER_SIZE_USDC} USDC. Skipping order.`
                );
                await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                break;
            }

            order_arges = {
                side: Side.SELL,
                tokenID: tokenId,
                amount: calculatedAmount,
                price: parseFloat(maxPriceBid.price),
            };
            console.log('Order args:', order_arges);
            const signedOrder = await clobClient.createMarketOrder(order_arges);
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
            if (resp.success === true) {
                retry = 0;
                console.log('Successfully posted order:', resp);
                remaining -= order_arges.amount;
            } else {
                retry += 1;
                console.log('Error posting order: retrying...', resp);
            }
        }
        if (retry >= RETRY_LIMIT) {
            await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: retry });
        } else {
            await UserActivity.updateOne({ _id: trade._id }, { bot: true });
        }
    } else {
        console.log('Condition not supported');
    }
};

export default postOrder;
