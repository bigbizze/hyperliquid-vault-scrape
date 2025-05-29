// Vault API Data Scraper - Clean API-based approach
(async function() {
    console.log('Starting Vault Data Extraction via APIs...');

    // --- Configuration ---
    const TVL_THRESHOLD = 10000;  // Minimum TVL to process a vault
    const APR_THRESHOLD = 0.05; // Minimum APR (5%)
    const ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING = false; // Set to number to limit, false for all
    const BLACKLIST_ADDRESSES = [
        "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303", // Hyperliquidity Provider (HLP)
        "0x63c621a33714ec48660e32f2374895c8026a3a00"  // Liquidator
    ];

    // Include additional data (can be slow for vaults with lots of activity)
    const INCLUDE_TRADE_HISTORY = true;
    const INCLUDE_DEPOSITS_WITHDRAWALS = true;
    const INCLUDE_FUNDING_HISTORY = true;

    // --- API Endpoints ---
    const VAULTS_LIST_URL = "https://stats-data.hyperliquid.xyz/Mainnet/vaults";
    const VAULT_DETAILS_URL = "https://api-ui.hyperliquid.xyz/info";

    // --- Utility Functions ---
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function downloadJSON(data, filename) {
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log(`JSON file "${filename}" downloaded.`);
    }

    async function fetchWithRetry(url, options = {}, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    if (response.status === 429) {
                        console.warn(`Rate limit hit. Retrying after ${1000 * attempt}ms...`);
                        await sleep(1000 * attempt); // Exponential backoff
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return await response.json();
            } catch (error) {
                console.warn(`Fetch attempt ${attempt}/${maxRetries} failed:`, error.message);
                if (attempt === maxRetries) throw error;
                await sleep(1000 * attempt); // Exponential backoff
            }
        }
    }

    // --- Data Fetching Functions ---
    async function fetchVaultsList() {
        console.log('Fetching vaults list...');
        return await fetchWithRetry(VAULTS_LIST_URL);
    }

    async function fetchVaultDetails(vaultAddress) {
        console.log(`Fetching details for vault: ${vaultAddress}`);
        return await fetchWithRetry(VAULT_DETAILS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "type": "vaultDetails",
                "vaultAddress": vaultAddress
            })
        });
    }

    async function fetchTradeHistory(vaultAddress) {
        console.log(`Fetching trade history for vault: ${vaultAddress}`);
        return await fetchWithRetry(VAULT_DETAILS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "aggregateByTime": true, // This is important for getting structured fills
                "type": "userFills",
                "user": vaultAddress
            })
        });
    }

    async function fetchDepositsWithdrawals(vaultAddress) {
        console.log(`Fetching deposits/withdrawals for vault: ${vaultAddress}`);
        return await fetchWithRetry(VAULT_DETAILS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "type": "userNonFundingLedgerUpdates",
                "user": vaultAddress
            })
        });
    }

    async function fetchFundingHistory(vaultAddress) {
        console.log(`Fetching funding history for vault: ${vaultAddress}`);
        return await fetchWithRetry(VAULT_DETAILS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "type": "userFunding",
                "user": vaultAddress
            })
        });
    }

    // --- Data Processing Functions ---

    /**
     * Calculates the maximum drawdown from a series of account values.
     * @param {Array<Array<number>>} accountValueHistory - Array of [timestamp, value] pairs.
     * @returns {number|string} The maximum drawdown as a percentage (e.g., 0.1 for 10%), or "N/A".
     */
    function calculateMaxDrawdown(accountValueHistory) {
        if (!accountValueHistory || accountValueHistory.length < 2) {
            return "N/A";
        }

        let peak = -Infinity;
        let maxDrawdown = 0;

        for (const [timestamp, valueStr] of accountValueHistory) {
            const value = parseFloat(valueStr);
            if (isNaN(value)) continue; // Skip if value is not a number

            if (value > peak) {
                peak = value;
            }

            if (peak > 0) { // Avoid division by zero or issues with negative peaks if data is unusual
                const drawdown = (peak - value) / peak;
                if (drawdown > maxDrawdown) {
                    maxDrawdown = drawdown;
                }
            }
        }
        return maxDrawdown; // Returns as a decimal, e.g., 0.1 for 10%
    }

    /**
     * Calculates the cumulative PnL from a PnL history.
     * @param {Array<Array<number>>} pnlHistory - Array of [timestamp, pnl_value] pairs, assumed to be cumulative.
     * @returns {number|string} The final cumulative PnL, or "N/A".
     */
    function calculateCumulativePnl(pnlHistory) {
        if (!pnlHistory || pnlHistory.length === 0) {
            return "N/A";
        }
        // Assuming pnlHistory stores cumulative PnL at each timestamp,
        // the last entry's PnL value is the total cumulative PnL.
        const lastPnlEntry = pnlHistory[pnlHistory.length - 1];
        if (lastPnlEntry && typeof lastPnlEntry[1] !== 'undefined') {
            return parseFloat(lastPnlEntry[1]);
        }
        return "N/A";
    }


    function isVaultEligible(vault) {
        const apr = vault.apr || 0;
        const tvl = parseFloat(vault.summary?.tvl || "0");

        if (tvl < TVL_THRESHOLD) {
            console.log(`Skipping "${vault.summary?.name}" - TVL ${tvl} below threshold (${TVL_THRESHOLD})`);
            return false;
        }

        if (apr < APR_THRESHOLD) {
            console.log(`Skipping "${vault.summary?.name}" - APR ${(apr * 100).toFixed(2)}% below threshold (${APR_THRESHOLD * 100}%)`);
            return false;
        }

        const address = vault.summary?.vaultAddress?.toLowerCase();
        if (BLACKLIST_ADDRESSES.includes(address)) {
            console.log(`Skipping "${vault.summary?.name}" - Address ${address} is blacklisted`);
            return false;
        }
        return true;
    }

    function extractVaultPerformanceFromAPI(vault, vaultDetails) {
        const portfolio = vaultDetails.portfolio || [];
        const allTimeDataEntry = portfolio.find(([period]) => period === "allTime");
        const allTimeData = allTimeDataEntry ? allTimeDataEntry[1] : {}; // allTimeData[1] holds the actual data object

        let vlm = "N/A";
        if (allTimeData && allTimeData.vlm) {
            vlm = allTimeData.vlm;
        }

        // Calculate PnL and Max Drawdown using the new functions
        const pnlHistory = allTimeData.pnlHistory || [];
        const accountValueHistory = allTimeData.accountValueHistory || [];

        const cumulativePnl = calculateCumulativePnl(pnlHistory);
        const maxDrawdown = calculateMaxDrawdown(accountValueHistory);

        return {
            apr: vault.apr || 0,
            aprText: `${((vault.apr || 0) * 100).toFixed(2)}%`,
            tvl: vault.summary?.tvl || "0",
            tvlText: `$${parseFloat(vault.summary?.tvl || "0").toLocaleString()}`,
            volume: vlm,
            maxDrawdown: typeof maxDrawdown === 'number' ? `${(maxDrawdown * 100).toFixed(2)}%` : maxDrawdown, // Store as percentage string
            pnl: typeof cumulativePnl === 'number' ? cumulativePnl.toFixed(2) : cumulativePnl, // Store as formatted string
            profitShare: `${((vaultDetails.leaderCommission || 0) * 100).toFixed(2)}%`
        };
    }

    function processFollowers(followers) {
        return followers.map(follower => ({
            depositor: follower.user,
            vaultAmount: follower.vaultEquity,
            unrealizedPnl: follower.pnl,
            allTimePnl: follower.allTimePnl,
            daysFollowing: follower.daysFollowing.toString(),
            vaultEntryTime: follower.vaultEntryTime,
            lockupUntil: follower.lockupUntil
        }));
    }

    function processPortfolioData(portfolio) { // This function processes the raw portfolio for easier access later
        const processed = {};
        if (!portfolio) return processed;

        for (const [period, data] of portfolio) {
            if (typeof data === 'object' && data !== null) { // Ensure data is an object
                processed[period] = {
                    accountValueHistory: data.accountValueHistory || [],
                    pnlHistory: data.pnlHistory || [],
                    volume: data.vlm || "0"
                };
            } else {
                 processed[period] = { // Default structure if data is not as expected
                    accountValueHistory: [],
                    pnlHistory: [],
                    volume: "0"
                };
            }
        }
        return processed;
    }


    function processTradeHistory(tradeHistory) {
        if (!tradeHistory) return [];
        return tradeHistory.map(trade => ({
            time: new Date(trade.time).toISOString(),
            coin: trade.coin,
            direction: trade.side === 'B' ? 'Buy' : 'Sell',
            price: trade.px,
            size: trade.sz,
            tradeValue: (parseFloat(trade.px) * parseFloat(trade.sz)).toString(),
            fee: trade.fee || "0.0",
            closedPnl: trade.closedPnl || "0.0",
            dir: trade.dir || "",
            hash: trade.hash,
            crossed: trade.crossed,
            feeToken: trade.feeToken || "USDC"
        }));
    }

    function processDepositsWithdrawals(depositsWithdrawals) {
        if (!depositsWithdrawals) return [];
        return depositsWithdrawals.map(item => ({
            time: new Date(item.time).toISOString(),
            action: item.delta.type,
            accountValueChange: item.delta.usdc || item.delta.netWithdrawnUsd || "0",
            fee: item.delta.commission || "0",
            hash: item.hash,
            vault: item.delta.vault,
            user: item.delta.user || "",
            requestedUsd: item.delta.requestedUsd || "",
            closingCost: item.delta.closingCost || "",
            basis: item.delta.basis || ""
        }));
    }

    function processFundingHistory(fundingHistory) {
        if (!fundingHistory) return [];
        return fundingHistory.map(funding => ({
            time: new Date(funding.time).toISOString(),
            coin: funding.delta.coin,
            payment: funding.delta.usdc,
            rate: funding.delta.fundingRate,
            size: funding.delta.szi,
            positionSide: parseFloat(funding.delta.szi) > 0 ? "Long" : "Short",
            hash: funding.hash
        }));
    }

    // --- Main Execution ---
    let processedCount = 0;
    const allVaultsData = [];

    try {
        const vaults = await fetchVaultsList();
        console.log(`Found ${vaults.length} total vaults`);

        const eligibleVaults = vaults.filter(isVaultEligible);
        console.log(`Found ${eligibleVaults.length} eligible vaults after filtering`);

        const processingLimit = ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING || eligibleVaults.length;
        const vaultsToProcess = eligibleVaults.slice(0, processingLimit);

        console.info(`Processing ${vaultsToProcess.length} vaults...`);

        for (const vault of vaultsToProcess) {
            try {
                console.info(`\n--- Processing Vault ${processedCount + 1}/${vaultsToProcess.length}: "${vault.summary?.name} :: ${vault.summary.vaultAddress}" ---`);
                const vaultAddress = vault.summary?.vaultAddress;
                if (!vaultAddress) {
                    console.warn('No vault address found, skipping...');
                    continue;
                }

                const vaultDetails = await fetchVaultDetails(vaultAddress);

                // The raw portfolio data is vaultDetails.portfolio
                // extractVaultPerformanceFromAPI now uses this directly to get pnlHistory and accountValueHistory
                const performanceData = extractVaultPerformanceFromAPI(vault, vaultDetails);

                // processPortfolioData is used to structure the full historical data for storage
                const structuredPortfolioData = processPortfolioData(vaultDetails.portfolio || []);

                const depositorsData = processFollowers(vaultDetails.followers || []);
                let tradeHistoryData = [];
                let depositsWithdrawalsData = [];
                let fundingHistoryData = [];

                if (INCLUDE_TRADE_HISTORY) {
                    try {
                        console.log('Fetching trade history...');
                        const tradeHistory = await fetchTradeHistory(vaultAddress);
                        tradeHistoryData = processTradeHistory(tradeHistory || []);
                    } catch (error) {
                        console.warn(`Failed to fetch trade history for ${vaultAddress}:`, error.message);
                    }
                }
                if (INCLUDE_DEPOSITS_WITHDRAWALS) {
                    try {
                        console.log('Fetching deposits/withdrawals...');
                        const depositsWithdrawals = await fetchDepositsWithdrawals(vaultAddress);
                        depositsWithdrawalsData = processDepositsWithdrawals(depositsWithdrawals || []);
                    } catch (error) {
                        console.warn(`Failed to fetch deposits/withdrawals for ${vaultAddress}:`, error.message);
                    }
                }
                if (INCLUDE_FUNDING_HISTORY) {
                    try {
                        console.log('Fetching funding history...');
                        const fundingHistory = await fetchFundingHistory(vaultAddress);
                        fundingHistoryData = processFundingHistory(fundingHistory || []);
                    } catch (error) {
                        console.warn(`Failed to fetch funding history for ${vaultAddress}:`, error.message);
                    }
                }

                const comprehensiveVaultData = {
                    vaultName: vaultDetails.name || vault.summary?.name || "Unknown",
                    address: vaultAddress,
                    leader: vaultDetails.leader || vault.summary?.leader,
                    description: vaultDetails.description || "",
                    vaultPerformance: performanceData, // This now includes calculated PnL and Max Drawdown
                    isClosed: vaultDetails.isClosed || vault.summary?.isClosed || false,
                    allowDeposits: vaultDetails.allowDeposits !== false,
                    alwaysCloseOnWithdraw: vaultDetails.alwaysCloseOnWithdraw || false,
                    leaderFraction: vaultDetails.leaderFraction || 0,
                    leaderCommission: vaultDetails.leaderCommission || 0,
                    maxDistributable: vaultDetails.maxDistributable || 0,
                    maxWithdrawable: vaultDetails.maxWithdrawable || 0,
                    relationship: vaultDetails.relationship || { type: "normal" },
                    portfolioData: structuredPortfolioData, // Store the structured historical data
                    depositorsData: depositorsData,
                    tradeHistoryData: tradeHistoryData,
                    depositsWithdrawalsData: depositsWithdrawalsData,
                    fundingHistoryData: fundingHistoryData,
                    rawVaultSummary: vault.summary,
                    rawVaultDetails: vaultDetails,
                    dataFetchedAt: new Date().toISOString(),
                    createTimeMillis: vault.summary?.createTimeMillis || null
                };

                allVaultsData.push(comprehensiveVaultData);
                processedCount++;
                console.log(`✓ Processed "${comprehensiveVaultData.vaultName}" (PnL: ${performanceData.pnl}, Max DD: ${performanceData.maxDrawdown}, ${depositorsData.length} depositors, ${tradeHistoryData.length} trades, ${depositsWithdrawalsData.length} D/W, ${fundingHistoryData.length} funding)`);
                await sleep(150);

            } catch (error) {
                console.error(`Error processing vault "${vault.summary?.name}":`, error.message, error.stack);
            }
        }

        console.log(`\n=== Extraction Complete ===`);
        console.log(`Successfully processed: ${processedCount} vaults`);
        console.log(`Total data collected: ${allVaultsData.length} vault records`);

        if (allVaultsData.length > 0) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            downloadJSON(allVaultsData, `vault_data_api_${timestamp}.json`);
            const summary = {
                extractionMetadata: {
                    totalVaultsFound: vaults.length,
                    eligibleVaults: eligibleVaults.length,
                    processedVaults: processedCount,
                    timestamp: new Date().toISOString(),
                    config: {
                        TVL_THRESHOLD, APR_THRESHOLD, INCLUDE_TRADE_HISTORY,
                        INCLUDE_DEPOSITS_WITHDRAWALS, INCLUDE_FUNDING_HISTORY, BLACKLIST_ADDRESSES
                    }
                },
                vaultsSummary: allVaultsData.map(v => ({
                    name: v.vaultName, address: v.address,
                    apr: v.vaultPerformance.aprText, tvl: v.vaultPerformance.tvlText,
                    pnl: v.vaultPerformance.pnl, maxDrawdown: v.vaultPerformance.maxDrawdown,
                    depositors: v.depositorsData.length, isClosed: v.isClosed
                }))
            };
            downloadJSON(summary, `vault_summary_api_${timestamp}.json`);
        } else {
            console.log('No vault data collected.');
        }

    } catch (error) {
        console.error('Critical error in main execution:', error);
        alert(`Script failed! Error: ${error.message}`);
    }
})().catch(error => {
    console.error('Unhandled error:', error);
    alert(`Script failed! Error: ${error.message}`);
});