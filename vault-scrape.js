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
                "aggregateByTime": true,
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
    function isVaultEligible(vault) {
        const apr = vault.apr || 0;
        const tvl = parseFloat(vault.summary?.tvl || "0");

        // Check TVL threshold
        if (tvl < TVL_THRESHOLD) {
            console.log(`Skipping "${vault.summary?.name}" - TVL ${tvl} below threshold (${TVL_THRESHOLD})`);
            return false;
        }

        // Check APR threshold
        if (apr < APR_THRESHOLD) {
            console.log(`Skipping "${vault.summary?.name}" - APR ${(apr * 100).toFixed(2)}% below threshold (${APR_THRESHOLD * 100}%)`);
            return false;
        }

        // Check blacklist
        const address = vault.summary?.vaultAddress?.toLowerCase();
        if (BLACKLIST_ADDRESSES.includes(address)) {
            console.log(`Skipping "${vault.summary?.name}" - Address ${address} is blacklisted`);
            return false;
        }

        return true;
    }

    function extractVaultPerformanceFromAPI(vault, vaultDetails) {
        // Extract performance data from the portfolio data
        const portfolio = vaultDetails.portfolio || [];
        const allTimeData = portfolio.find(([period]) => period === "allTime");

        let vlm = "N/A";
        if (allTimeData && allTimeData[1] && allTimeData[1].vlm) {
            vlm = allTimeData[1].vlm;
        }

        return {
            apr: vault.apr || 0,
            aprText: `${((vault.apr || 0) * 100).toFixed(2)}%`,
            tvl: vault.summary?.tvl || "0",
            tvlText: `$${parseFloat(vault.summary?.tvl || "0").toLocaleString()}`,
            volume: vlm,
            maxDrawdown: "N/A", // Would need to calculate from PnL history
            pnl: "N/A", // Would need to calculate from PnL history
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

    function processPortfolioData(portfolio) {
        const processed = {};

        for (const [period, data] of portfolio) {
            if (typeof data === 'object' && data.accountValueHistory) {
                processed[period] = {
                    accountValueHistory: data.accountValueHistory,
                    pnlHistory: data.pnlHistory || [],
                    volume: data.vlm || "0"
                };
            }
        }

        return processed;
    }

    function processTradeHistory(tradeHistory) {
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
        // Step 1: Fetch all vaults
        const vaults = await fetchVaultsList();
        console.log(`Found ${vaults.length} total vaults`);

        // Step 2: Filter eligible vaults
        const eligibleVaults = vaults.filter(isVaultEligible);
        console.log(`Found ${eligibleVaults.length} eligible vaults after filtering`);

        const processingLimit = ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING || eligibleVaults.length;
        const vaultsToProcess = eligibleVaults.slice(0, processingLimit);

        console.log(`Processing ${vaultsToProcess.length} vaults...`);

        // Step 3: Process each eligible vault
        for (const vault of vaultsToProcess) {
            try {
                console.log(`\n--- Processing Vault ${processedCount + 1}/${vaultsToProcess.length}: "${vault.summary?.name}" ---`);

                const vaultAddress = vault.summary?.vaultAddress;
                if (!vaultAddress) {
                    console.warn('No vault address found, skipping...');
                    continue;
                }

                // Fetch detailed vault information
                const vaultDetails = await fetchVaultDetails(vaultAddress);

                // Extract performance data
                const performanceData = extractVaultPerformanceFromAPI(vault, vaultDetails);

                // Process followers (equivalent to depositors tab)
                const depositorsData = processFollowers(vaultDetails.followers || []);

                // Process portfolio data (historical performance)
                const portfolioData = processPortfolioData(vaultDetails.portfolio || []);

                // Fetch additional data
                let tradeHistoryData = [];
                let depositsWithdrawalsData = [];
                let fundingHistoryData = [];

                if (INCLUDE_TRADE_HISTORY) {
                    try {
                        console.log('Fetching trade history...');
                        const tradeHistory = await fetchTradeHistory(vaultAddress);
                        tradeHistoryData = processTradeHistory(tradeHistory || []);
                    } catch (error) {
                        console.warn('Failed to fetch trade history:', error.message);
                    }
                }

                if (INCLUDE_DEPOSITS_WITHDRAWALS) {
                    try {
                        console.log('Fetching deposits/withdrawals...');
                        const depositsWithdrawals = await fetchDepositsWithdrawals(vaultAddress);
                        depositsWithdrawalsData = processDepositsWithdrawals(depositsWithdrawals || []);
                    } catch (error) {
                        console.warn('Failed to fetch deposits/withdrawals:', error.message);
                    }
                }

                if (INCLUDE_FUNDING_HISTORY) {
                    try {
                        console.log('Fetching funding history...');
                        const fundingHistory = await fetchFundingHistory(vaultAddress);
                        fundingHistoryData = processFundingHistory(fundingHistory || []);
                    } catch (error) {
                        console.warn('Failed to fetch funding history:', error.message);
                    }
                }

                // Compile comprehensive vault data
                const comprehensiveVaultData = {
                    // Basic info
                    vaultName: vaultDetails.name || vault.summary?.name || "Unknown",
                    address: vaultAddress,
                    leader: vaultDetails.leader || vault.summary?.leader,
                    description: vaultDetails.description || "",

                    // Performance data
                    vaultPerformance: performanceData,

                    // Vault details
                    isClosed: vaultDetails.isClosed || vault.summary?.isClosed || false,
                    allowDeposits: vaultDetails.allowDeposits !== false,
                    alwaysCloseOnWithdraw: vaultDetails.alwaysCloseOnWithdraw || false,
                    leaderFraction: vaultDetails.leaderFraction || 0,
                    leaderCommission: vaultDetails.leaderCommission || 0,
                    maxDistributable: vaultDetails.maxDistributable || 0,
                    maxWithdrawable: vaultDetails.maxWithdrawable || 0,
                    relationship: vaultDetails.relationship || { type: "normal" },

                    // Historical data
                    portfolioData: portfolioData,

                    // Equivalent to bottom tabs data
                    depositorsData: depositorsData,
                    tradeHistoryData: tradeHistoryData,
                    depositsWithdrawalsData: depositsWithdrawalsData,
                    fundingHistoryData: fundingHistoryData,

                    // Raw API data for reference
                    rawVaultSummary: vault.summary,
                    rawVaultDetails: vaultDetails,

                    // Timestamps
                    dataFetchedAt: new Date().toISOString(),
                    createTimeMillis: vault.summary?.createTimeMillis || null
                };

                allVaultsData.push(comprehensiveVaultData);
                processedCount++;

                console.log(`✓ Processed "${comprehensiveVaultData.vaultName}" (${depositorsData.length} depositors, ${tradeHistoryData.length} trades, ${depositsWithdrawalsData.length} deposits/withdrawals, ${fundingHistoryData.length} funding records)`);

                // Small delay to be respectful to the API
                await sleep(150);

            } catch (error) {
                console.error(`Error processing vault "${vault.summary?.name}":`, error.message);
                // Continue with next vault
            }
        }

        // Step 4: Download results
        console.log(`\n=== Extraction Complete ===`);
        console.log(`Successfully processed: ${processedCount} vaults`);
        console.log(`Total data collected: ${allVaultsData.length} vault records`);

        if (allVaultsData.length > 0) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            downloadJSON(allVaultsData, `vault_data_api_${timestamp}.json`);

            // Also create a summary file
            const summary = {
                extractionMetadata: {
                    totalVaultsFound: vaults.length,
                    eligibleVaults: eligibleVaults.length,
                    processedVaults: processedCount,
                    timestamp: new Date().toISOString(),
                    config: {
                        TVL_THRESHOLD,
                        APR_THRESHOLD,
                        INCLUDE_TRADE_HISTORY,
                        INCLUDE_DEPOSITS_WITHDRAWALS,
                        INCLUDE_FUNDING_HISTORY,
                        BLACKLIST_ADDRESSES
                    }
                },
                vaultsSummary: allVaultsData.map(vault => ({
                    name: vault.vaultName,
                    address: vault.address,
                    apr: vault.vaultPerformance.apr,
                    tvl: vault.vaultPerformance.tvl,
                    depositors: vault.depositorsData.length,
                    isClosed: vault.isClosed
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