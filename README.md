# Polymarket Copy Trading Bot

## Introduction

This project is a Polymarket Copy Trading Bot that allows users to automatically copy trades from a selected trader on Polymarket.

## Features

- **Automated Trading**: Automatically copy trades from a selected trader.
- **Real-time Monitoring**: Continuously monitor the selected trader's activity.
- **Customizable Settings**: Configure trading parameters and risk management.

## Installation

1. Install latest version of Node.js and npm
2. Navigate to the project directory:
    ```bash
    cd polymarket_copy_trading_bot
    ```
3. Create `.env` file:
    ```bash
    touch .env
    ```
4. Configure env variables:

    ```typescript
    USER_ADDRESS = 'Selected account wallet address to copy';

    PROXY_WALLET = 'Your Polymarket account address';
    PRIVATE_KEY = 'My wallet private key';

    CLOB_HTTP_URL = 'https://clob.polymarket.com/';
    CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws';

    FETCH_INTERVAL = 1; // default is 1 second
    TOO_OLD_TIMESTAMP = 1; // default is 1 hour
    RETRY_LIMIT = 3; // default is 3 times

    RPC_URL = 'https://polygon-mainnet.infura.io/v3/90ee27dc8b934739ba9a55a075229744';

    USDC_CONTRACT_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    ```

5. Install the required dependencies:
    ```bash
    npm install
    ```
6. Build the project:
    ```bash
    npm run build
    ```
7. Run BOT:
    ```bash
    npm run start
    ```
8. ⚠ Choose reasonable location for the bot(Many users faced this problem, read this carefully before setting up the bot):

    For users facing IP address-related access issues with Polymarket due to geographic restrictions, I recommend using [tradingvps.io](https://app.tradingvps.io/link.php?id=11) with the Netherlands location. This VPS service offers ultra-low latency and is physically close to Polymarket's servers, ensuring faster response times and a smoother trading experience. It is specifically optimized for traders and easy to set up, making it an excellent choice for both beginners and experienced users looking to avoid IP-based blocks.

## Docker Installation (Recommended)

This setup includes both the application and a self-hosted MongoDB instance.

1. **Prerequisites**: Install [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

2. **Create `.env` file** in the project root:

    ```bash
    touch .env
    ```

3. **Configure environment variables** in `.env`:

    ```bash
    USER_ADDRESS=Selected account wallet address to copy
    PROXY_WALLET=Your Polymarket account address
    PRIVATE_KEY=My wallet private key

    CLOB_HTTP_URL=https://clob.polymarket.com/
    CLOB_WS_URL=wss://ws-subscriptions-clob.polymarket.com/ws

    FETCH_INTERVAL=1
    TOO_OLD_TIMESTAMP=24
    RETRY_LIMIT=3

    RPC_URL=https://polygon-mainnet.infura.io/v3/YOUR_API_KEY
    USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174

    # Note: MONGO_URI is automatically set by docker-compose
    ```

4. **Build and start the containers**:

    ```bash
    docker-compose up -d
    ```

5. **View logs**:

    ```bash
    docker-compose logs -f app
    ```

6. **Stop the containers**:

    ```bash
    docker-compose down
    ```

7. **Stop and remove volumes** (removes MongoDB data):
    ```bash
    docker-compose down -v
    ```

**Note**: The MongoDB data is persisted in a Docker volume named `mongodb_data`. The MongoDB container is accessible on `localhost:27017` if you need to connect with external tools.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request. And if you are interested in this project, please consider giving it a star✨.

## Contact

For updated version or any questions, please contact me at [Telegram](https://t.me/trust4120).
