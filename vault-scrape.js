
// Enhanced Vault Scraper - JSON Output
(async function() {
    console.log('Starting Enhanced Vault Data Extraction (JSON Output)...');

    // --- Configuration ---
    const BASE_WAIT_TIME = 50; // Base wait time in milliseconds
    const TVL_THRESHOLD = 10000;  // Minimum TVL to process a vault
    const APR_THRESHOLD = 0.00001; // Minimum APR (greater than 0% as a decimal)
    const VIEW_ALL_LOAD_TIMEOUT = 20000; // 20 seconds for View All page content (primarily for initial load of View #3)
    // ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING: Set to a number to limit processed vaults for testing, or false to process all.
    const ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING = false;
    const VIEW_ALL_CONTENT_RENDER_DELAY = 1000; // Fixed delay after rows appear in View #3 (primarily for initial load)
    const MIN_ROWS_TO_CONSIDER_LOADED_VIEW3 = 5; // Min rows to wait for in View #3 before considering loaded
    const BLACKLIST_ADDRESSES = [
        "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303", // Hyperliquidity Provider (HLP)
        "0x63c621a33714ec48660e32f2374895c8026a3a00" // Liquidator
    ];
    const MAX_MAIN_PAGES = 60; // Assuming page size is 10 (which is default), only parse the first 600 vaults

    // --- Selectors (CRITICAL - VERIFY AND ADJUST THESE FOR YOUR TARGET SITE) ---
    // Main list selectors (View #1)
    const SELECTOR_MAIN_LIST_TABLE_ROWS = "table tbody tr";
    const SELECTOR_MAIN_LIST_PAGINATION_CONTROLS_CONTAINER_VIEW1 = '#root > div.sc-fEXmlR.ejmSgi > div:nth-child(3) > div > div > div > div.sc-iBYQkv.bCwfSg > div:nth-child(2) > div > div:nth-child(6) > div:nth-child(2) > div:nth-child(2) > div:nth-child(2)';
    const SELECTOR_MAIN_LIST_PAGINATION_INFO_TEXT_VIEW1 = '.sc-bjfHbI.bFBYgR';
    const SELECTOR_MAIN_LIST_PAGINATION_DISABLED_CLASS = 'cOLbBh';

    // Vault Detail Page (View #2) Selectors
    const SELECTOR_BREADCRUMB_TO_MAIN_LIST_VIEW2 = '#root > div > div:nth-child(3) > div > div > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > a';

    // Top Tab Menu (View #2)
    const SELECTOR_VAULT_PERFORMANCE_TAB_VIEW2 = '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div > div:nth-child(1) > div > div:nth-child(3)';
    const SELECTOR_VAULT_PERFORMANCE_VALUE_ELEMENTS_VIEW2 = "#root > div.sc-fEXmlR.ejmSgi > div:nth-child(3) > div > div > div > div:nth-child(3) > div.sc-fEXmlR.ejmSgi > div:nth-child(1) > div:nth-child(2) > div > div > div:nth-child(2)";

    const SELECTOR_PAST_MONTH_RETURN_VIEW2 = '#root > div.sc-fEXmlR.ejmSgi > div:nth-child(3) > div > div > div > div:nth-child(2) > div:nth-child(2) > div > div > div > span';


    // Bottom Tab Menu (View #2)
    const SELECTORS_BOTTOM_TABS_VIEW2 = {
        balances: '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div > div > div:nth-child(2)',
        positions: '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div > div > div:nth-child(3)',
        tradeHistory: '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div > div > div:nth-child(4)',
        fundingHistory: '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div > div > div:nth-child(5)',
        depositsWithdrawals: '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div > div > div:nth-child(6)',
        depositors: '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div > div > div:nth-child(7)',
    };

    const SELECTOR_VIEW_ALL_BUTTON_GENERIC = '#root > div > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div:nth-child(2) > div:nth-child(2) > div > div:nth-child(1) > a';
    const DETAIL_TABLE_CLASS_SELECTOR = 'table.sc-jfTVlA.fNOlaI';
    const SELECTOR_EXPANDED_TABLE_PAGINATION_CONTROLS_CONTAINER_VIEW3 = '#root > div > div:nth-child(3) > div > div > div > div > div > div:nth-child(2) > div:nth-child(2) > div:nth-child(2) > div:nth-child(2)';
    const SELECTOR_PAGINATION_INFO_TEXT_VIEW3 = '.sc-bjfHbI.bFBYgR';

    // --- Global Data Storage ---
    const allVaultsData = [];
    let processedEligibleVaultsCount = 0;
    let isFirstMainListPage = true;

    // --- Utility Functions ---
    function sleep(ms = BASE_WAIT_TIME) {
        console.log(`Waiting for ${ms / 1000}s...`);
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForSelector(selector, timeout = 15000, parentElement = document, allowMultiple = false) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const elements = allowMultiple ? parentElement.querySelectorAll(selector) : parentElement.querySelector(selector);
            if (allowMultiple && elements && elements.length > 0) {
                if (elements[0].offsetParent !== null || elements[0].getClientRects().length > 0) return elements;
            } else if (!allowMultiple && elements && (elements.offsetParent !== null || elements.getClientRects().length > 0) ) {
                return elements;
            }
            await sleep(250);
        }
        throw new Error(`Timeout waiting for selector: "${selector}" after ${timeout/1000}s`);
    }

    async function clickElementAndWait(selectorOrElement, waitTimeAfterClick = BASE_WAIT_TIME, selectorToWaitForAfterClick = null, parentForWaitSelector = document) {
        const element = typeof selectorOrElement === 'string' ? await waitForSelector(selectorOrElement) : selectorOrElement;
        if (!element) {
            throw new Error(`Element not found for click: ${selectorOrElement}`);
        }
        console.log('Clicking on:', element.tagName, element.className || element.id || element.textContent.slice(0,30).trim());
        element.click();
        await sleep(waitTimeAfterClick);
        if (selectorToWaitForAfterClick) {
            console.log(`After click, waiting for selector: ${selectorToWaitForAfterClick}`);
            await waitForSelector(selectorToWaitForAfterClick, 15000, parentForWaitSelector);
        }
    }

    function parseCurrency(text) {
        if (typeof text !== 'string') return null;
        const cleaned = text.replace('$', '').replace(/,/g, '');
        const value = parseFloat(cleaned);
        return isNaN(value) ? null : value;
    }

    function parsePercentage(text) {
        if (typeof text !== 'string') return null;
        const cleaned = text.replace('%', '');
        const value = parseFloat(cleaned);
        return isNaN(value) ? null : value / 100;
    }

    function getElementText(element, selector, defaultValue = '') {
        const el = selector ? element.querySelector(selector) : element;
        if (el) {
            const valueEl = el.querySelector('div:nth-child(2) > span, div:nth-child(2)');
            if (valueEl) return valueEl.textContent.trim();
            const mainSpan = el.matches && el.matches('td') ? el.querySelector(':scope > span:first-child, :scope > div:first-child > span:first-child, :scope > div:first-child') : null;
            if (mainSpan) return mainSpan.textContent.trim();
            return el.textContent.trim();
        }
        return defaultValue;
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

    // --- Data Extraction Functions ---

    function extractMainListRowBaseData(rowElement) { // For View #1
        const cells = rowElement.querySelectorAll('td');
        if (cells.length < 6) {
            console.warn('Skipping row, not enough cells:', getElementText(rowElement).slice(0,50));
            return null;
        }
        const vaultName = getElementText(cells[0]);
        const aprText = getElementText(cells[2]);
        const tvlText = getElementText(cells[3]);
        const apr = parsePercentage(aprText);
        const tvl = parseCurrency(tvlText);

        if (tvl === null || tvl < TVL_THRESHOLD) return null;
        if (apr === null || apr < APR_THRESHOLD) return null;

        return {
            vaultName: vaultName,
            aprText: aprText,
            tvlText: tvlText,
            yourDepositText: getElementText(cells[4]),
            ageDaysText: getElementText(cells[5]),
            isEligible: true,
        };
    }

    async function extractPaginatedTableDataView3(
      vaultName, tabName,
      tableSelector, rowParsingFn, paginationControlsContainerSelector, parentElementForTable = document, maxPagesFallback = 200
    ) {
        const consolePrep = type => (...args) => {
          console[type](`[View #3 - ${vaultName} - ${tabName}]`, ...args);
        }
        const consoleLog = consolePrep("log");
        const consoleWarn = consolePrep("warn");
        const allRowsData = [];
        let currentPageNum = 1;
        let calculatedTotalPages = null;
        const rowsSelector = tableSelector + ' tbody tr';

        consoleLog(`View #3: Extracting paginated data from table: ${tableSelector} using pagination container: ${paginationControlsContainerSelector}`);

        // --- Rewind to first page ---
        let rewindAttempts = 0;
        const MAX_REWIND_ATTEMPTS = 20;
        consoleLog("View #3: Attempting to rewind to the first page...");
        while (rewindAttempts < MAX_REWIND_ATTEMPTS) {
            const paginationControlsContainer = parentElementForTable.querySelector(paginationControlsContainerSelector);
            let prevButton = null;
            if (paginationControlsContainer) {
                const buttons = paginationControlsContainer.querySelectorAll(':scope > div');
                if (buttons.length >= 2) {
                    prevButton = buttons[buttons.length - 2];
                }
            }
            if (prevButton && !prevButton.hasAttribute('disabled') && !prevButton.classList.contains(SELECTOR_MAIN_LIST_PAGINATION_DISABLED_CLASS) && !prevButton.closest('[disabled]')) {
                consoleLog(`View #3: Previous button is enabled. Clicking to go to previous page (Attempt ${rewindAttempts + 1}).`);
                await clickElementAndWait(prevButton, BASE_WAIT_TIME, tableSelector, parentElementForTable);
                rewindAttempts++;
            } else {
                consoleLog("View #3: Previous button is disabled or not found. Assuming on the first page.");
                break;
            }
        }
        if (rewindAttempts >= MAX_REWIND_ATTEMPTS) {
            consoleWarn("View #3: Reached max rewind attempts. Proceeding from current page.");
        }
        // --- End Rewind ---

        // Initial table and row load for the first page
        let tableElement; // Renamed from initialTableElement
        try {
            tableElement = await waitForSelector(tableSelector, 10000, parentElementForTable);
        } catch (e) {
            consoleWarn(`View #3: Initial table "${tableSelector}" not found. Error: ${e.message}`);
            return allRowsData;
        }

        let initialPageRowsFoundCount = 0;
        let initialPageTimeElapsed = 0;
        consoleLog(`View #3: Waiting for at least ${MIN_ROWS_TO_CONSIDER_LOADED_VIEW3} initial rows in "${rowsSelector}" (max ${VIEW_ALL_LOAD_TIMEOUT/1000}s)...`);
        while(
          initialPageTimeElapsed < VIEW_ALL_LOAD_TIMEOUT
          || (currentPageNum === 1 && initialPageRowsFoundCount < MIN_ROWS_TO_CONSIDER_LOADED_VIEW3)
        ) {
            initialPageRowsFoundCount = parentElementForTable.querySelectorAll(rowsSelector).length;
            if (initialPageRowsFoundCount >= MIN_ROWS_TO_CONSIDER_LOADED_VIEW3) {
                consoleLog(`View #3: Found ${initialPageRowsFoundCount} initial rows. Proceeding.`);
                break;
            }
            await sleep(500);
            initialPageTimeElapsed += 500;
        }

        if (currentPageNum === 1 && initialPageRowsFoundCount < MIN_ROWS_TO_CONSIDER_LOADED_VIEW3) {
            if (initialPageRowsFoundCount === 0) {
                throw new Error(`View #3: Timeout! Absolutely 0 rows loaded in table "${tableSelector}" after ${VIEW_ALL_LOAD_TIMEOUT/1000}s.`);
            } else {
                consoleWarn(`View #3: Found only ${initialPageRowsFoundCount} initial rows (expected at least ${MIN_ROWS_TO_CONSIDER_LOADED_VIEW3}). Proceeding with what was found.`);
            }
        }
        consoleLog(`View #3: Initial row structures processed. Applying fixed delay for content rendering...`);
        await sleep(VIEW_ALL_CONTENT_RENDER_DELAY);

        // --- Parse total pages (ONLY ONCE after initial load of View #3, page 1) ---
        try {
            consoleLog("View #3: Attempting to parse total pages (after initial load)...");
            let paginationControls = await waitForSelector(paginationControlsContainerSelector, 5000, parentElementForTable);
            let infoTextElement = null;
            let infoText = "";
            let attemptsToGetValidInfoText = 0;
            const MAX_INFO_TEXT_ATTEMPTS = 10;

            while(attemptsToGetValidInfoText < MAX_INFO_TEXT_ATTEMPTS) {
                paginationControls = parentElementForTable.querySelector(paginationControlsContainerSelector);
                if (paginationControls) {
                    const infoElements = paginationControls.querySelectorAll(SELECTOR_PAGINATION_INFO_TEXT_VIEW3);
                    for (const el of infoElements) {
                        const currentText = el.textContent.trim();
                        if (currentText.includes(" of ") && /\d+-\d+\s+of\s+([\d,]+)/.test(currentText)) {
                            const tempMatch = currentText.match(/(\d+)-(\d+)\s+of\s+([\d,]+)/);
                            if (tempMatch && parseInt(tempMatch[3].replace(/,/g, '')) > 0) {
                                infoTextElement = el;
                                infoText = currentText;
                                break;
                            } else if (tempMatch && parseInt(tempMatch[3].replace(/,/g, '')) === 0 && (parseInt(tempMatch[1]) === 1 && parseInt(tempMatch[2]) === 0) ) {
                                infoTextElement = el;
                                infoText = currentText;
                                break;
                            }
                        }
                    }
                }
                if (infoTextElement && infoText) break;
                consoleLog(`View #3: Pagination info text not yet valid or shows 0 total. Attempt ${attemptsToGetValidInfoText + 1}. Waiting...`);
                await sleep(250);
                attemptsToGetValidInfoText++;
            }


            if (infoTextElement && infoText) {
                const match = infoText.match(/(\d+)-(\d+)\s+of\s+([\d,]+)/);
                if (match) {
                    const rowsPerPage = parseInt(match[2]) - parseInt(match[1]) + 1;
                    const totalRows = parseInt(match[3].replace(/,/g, ''));
                    if (totalRows === 0 && rowsPerPage === 0) {
                        calculatedTotalPages = 0;
                        consoleLog(`View #3: Parsed pagination: 0 total rows, 0 total pages.`);
                    } else if (rowsPerPage > 0 && totalRows > 0) {
                        calculatedTotalPages = Math.ceil(totalRows / rowsPerPage);
                        consoleLog(`View #3: Parsed pagination: ${rowsPerPage} rows/page, ${totalRows} total rows, ${calculatedTotalPages} total pages.`);
                    }
                    else {
                         consoleWarn("View #3: Could not parse valid rowsPerPage or totalRows from info text:", infoText);
                    }
                } else {
                    consoleWarn("View #3: Pagination info text did not match expected format:", infoText);
                }
            } else {
                consoleWarn("View #3: Pagination info text element (e.g., '1-25 of X' with X > 0) not found or did not become valid within timeout.");
            }
        } catch (e) {
            consoleWarn("View #3: Error parsing total pages from pagination info:", e.message, "Falling back to maxPagesFallback or next button logic.");
        }
        // --- End Parse total pages ---

        const loopLimit = calculatedTotalPages !== null ? calculatedTotalPages : maxPagesFallback;
        consoleLog(`View #3: Loop limit set to: ${loopLimit} (Calculated: ${calculatedTotalPages}, Fallback: ${maxPagesFallback})`);

        if (loopLimit === 0 && calculatedTotalPages === 0) {
             consoleLog("View #3: Table confirmed to have 0 pages. Skipping row processing loop.");
        } else {
            while (currentPageNum <= loopLimit) {
                const isCurrentPageTheFirst = (currentPageNum === 1);
                const tableLoadWait = isCurrentPageTheFirst ? 0 : BASE_WAIT_TIME * 2; // No wait if table already loaded for page 1
                const rowLoadTimeoutForPage = isCurrentPageTheFirst ? 0 : BASE_WAIT_TIME * 4;
                const contentRenderDelayForPage = isCurrentPageTheFirst ? 0 : BASE_WAIT_TIME;

                let currentTableElement = tableElement; // Use the initially found table for page 1

                if (!isCurrentPageTheFirst) { // For subsequent pages, re-wait for table and rows
                    try {
                        currentTableElement = await waitForSelector(tableSelector, tableLoadWait, parentElementForTable);
                    } catch (e) {
                        consoleWarn(`View #3: Table "${tableSelector}" not found on page ${currentPageNum}. Error: ${e.message}`);
                        break;
                    }

                    let rowsFoundOnSubsequentPage = false;
                    let timeElapsedSubsequent = 0;
                    const subsequentMinRows = MIN_ROWS_TO_CONSIDER_LOADED_VIEW3;
                    consoleLog(`View #3: Waiting for at least ${subsequentMinRows} rows on page ${currentPageNum} (max ${rowLoadTimeoutForPage/1000}s)...`);
                    while(timeElapsedSubsequent < rowLoadTimeoutForPage) {
                        const currentNumRows = parentElementForTable.querySelectorAll(rowsSelector).length;
                        if (currentNumRows >= subsequentMinRows) {
                            rowsFoundOnSubsequentPage = true;
                            consoleLog(`View #3: Found ${currentNumRows} rows on page ${currentPageNum}.`);
                            break;
                        }
                        await sleep(250);
                        timeElapsedSubsequent += 250;
                    }
                    if (rowsFoundOnSubsequentPage) {
                        consoleLog(`View #3: Applying content render delay: ${contentRenderDelayForPage}ms`);
                        await sleep(contentRenderDelayForPage);
                    } else {
                        const rowsActuallyFound = parentElementForTable.querySelectorAll(rowsSelector).length;
                        if (rowsActuallyFound > 0) {
                            consoleWarn(`View #3: Found only ${rowsActuallyFound} rows on page ${currentPageNum} (expected at least ${subsequentMinRows}). Proceeding with what was found.`);
                        } else {
                            consoleLog(`View #3: No rows found in table "${tableSelector}" on page ${currentPageNum} after waiting. Ending pagination.`);
                            break;
                        }
                    }
                }

                const rows = currentTableElement.querySelectorAll('tbody tr');
                consoleLog(`View #3: Table "${tableSelector}", page ${currentPageNum}: Found ${rows.length} rows for parsing.`);
                rows.forEach(row => {
                    const data = rowParsingFn(row);
                    if (data) allRowsData.push(data);
                });

                if (calculatedTotalPages !== null && currentPageNum >= calculatedTotalPages) {
                    consoleLog(`View #3: Reached calculated last page (${currentPageNum}/${calculatedTotalPages}).`);
                    break;
                }

                const paginationControlsContainerCurrentPage = parentElementForTable.querySelector(paginationControlsContainerSelector);
                let nextButton = null;
                if (paginationControlsContainerCurrentPage) {
                    const buttons = paginationControlsContainerCurrentPage.querySelectorAll(':scope > div');
                    if (buttons.length > 0) {
                        nextButton = buttons[buttons.length - 1];
                    }
                } else {
                     consoleWarn(`View #3: Pagination controls container not found on page ${currentPageNum}. Cannot find next button.`);
                     break;
                }

                if (nextButton && !nextButton.hasAttribute('disabled') && !nextButton.classList.contains(SELECTOR_MAIN_LIST_PAGINATION_DISABLED_CLASS) && !nextButton.closest('[disabled]')) {
                    consoleLog(`View #3: Clicking next page (current: ${currentPageNum}, going to ${currentPageNum + 1})...`);
                    // Wait for the table structure of the *next* page to appear.
                    await clickElementAndWait(nextButton, BASE_WAIT_TIME, tableSelector, parentElementForTable);
                    currentPageNum++;
                } else {
                    if (calculatedTotalPages !== null && currentPageNum < calculatedTotalPages) {
                        consoleWarn(`View #3: Next button appears disabled/not found on page ${currentPageNum}, but calculated total pages is ${calculatedTotalPages}. Stopping pagination early.`);
                    } else {
                        consoleLog(`View #3: No more pages or "Next" button disabled/not found for table on page ${currentPageNum}.`);
                    }
                    break;
                }
            } // End while (currentPageNum <= loopLimit)
        } // End else (if loopLimit > 0)

        if (currentPageNum > loopLimit && loopLimit === maxPagesFallback) consoleWarn(`View #3: Reached max pages fallback (${maxPagesFallback}) for table: ${tableSelector}`);
        return allRowsData;
    }

    async function extractTableDataView2(tableSelector, rowParsingFn, parentElementForTable = document) {
        const allRowsData = [];
        console.log(`View #2: Extracting direct data from table: ${tableSelector}`);
        try {
            const tableElement = await waitForSelector(tableSelector, 7000, parentElementForTable);
            const rows = tableElement.querySelectorAll('tbody tr');
            console.log(`View #2: Table "${tableSelector}": Found ${rows.length} rows.`);
            rows.forEach(row => {
                const data = rowParsingFn(row);
                if (data) allRowsData.push(data);
            });
        } catch (e) {
            console.warn(`View #2: Table "${tableSelector}" not found or error parsing. Error: ${e.message}`);
        }
        return allRowsData;
    }

    async function scrapeVaultPerformanceDataView2(vaultData) { // For View #2
        console.log("View #2: Scraping Vault Performance tab data...");
        try {
            // Click the "Vault Performance" tab and wait for the specific value elements to be queryable
            await clickElementAndWait(SELECTOR_VAULT_PERFORMANCE_TAB_VIEW2, BASE_WAIT_TIME, SELECTOR_VAULT_PERFORMANCE_VALUE_ELEMENTS_VIEW2);

            const performanceValueElements = document.querySelectorAll(SELECTOR_VAULT_PERFORMANCE_VALUE_ELEMENTS_VIEW2);

            if (performanceValueElements && performanceValueElements.length >= 4) {
                vaultData.vaultPerformance = {
                    pnl: performanceValueElements[0] ? performanceValueElements[0].textContent.trim() : 'N/A',
                    maxDrawdown: performanceValueElements[1] ? performanceValueElements[1].textContent.trim() : 'N/A',
                    volume: performanceValueElements[2] ? performanceValueElements[2].textContent.trim() : 'N/A',
                    profitShare: performanceValueElements[3] ? performanceValueElements[3].textContent.trim() : 'N/A',
                };
            } else {
                console.warn("View #2: Vault Performance value elements not found or not enough elements with selector:", SELECTOR_VAULT_PERFORMANCE_VALUE_ELEMENTS_VIEW2, `(Found: ${performanceValueElements ? performanceValueElements.length : 0})`);
                vaultData.vaultPerformance = { pnl: 'N/A', maxDrawdown: 'N/A', volume: 'N/A', profitShare: 'N/A' };
            }
            vaultData.pastMonthReturnText = getElementText(document, SELECTOR_PAST_MONTH_RETURN_VIEW2);

        } catch (error) {
            console.error(`View #2: Error scraping Vault Performance data: ${error.message}`);
            vaultData.vaultPerformanceError = error.message;
        }
    }

    async function scrapeBottomTab(tabKeyName, vaultData, vaultDetailURL) { // For View #2 and #3
        const tabSelector = SELECTORS_BOTTOM_TABS_VIEW2[tabKeyName];
        const rowParser = detailRowParsers[tabKeyName];
        const tableSelector = DETAIL_TABLE_CLASS_SELECTOR;

        if (!tabSelector || !rowParser) {
            console.warn(`Configuration missing for bottom tab: ${tabKeyName}`);
            vaultData[`${tabKeyName}DataError`] = "Configuration missing";
            return;
        }

        console.log(`View #2: Clicking bottom tab: ${tabKeyName}`);
        // Ensure the tab content area (specifically the table) is ready after clicking the tab
        await clickElementAndWait(tabSelector, Math.max(BASE_WAIT_TIME, 250), tableSelector);
        let viewAllButton = Array.from(document.querySelectorAll("#root > div.sc-fEXmlR.ejmSgi > div:nth-child(3) > div > div > div > div:nth-child(3) > div:nth-child(2) > div > div:nth-child(2) > div:nth-child(2) > div > div > a"))
          .find(elem => elem.textContent.toLowerCase() === "view all");

        if (viewAllButton) {
            console.log(`View #2: "View All" button found for ${tabKeyName}. Navigating to View #3...`);
            // Increased wait after clicking "View All" before polling for table structure
            await clickElementAndWait(viewAllButton, BASE_WAIT_TIME, tableSelector);

            vaultData[`${tabKeyName}Data`] = await extractPaginatedTableDataView3(
                vaultData.vaultName,
                tabKeyName,
                tableSelector,
                rowParser,
                SELECTOR_EXPANDED_TABLE_PAGINATION_CONTROLS_CONTAINER_VIEW3
            );

            console.log(`View #3: Navigating back to View #2 from ${tabKeyName} expanded table using history.back()`);
            window.history.back();
            await sleep(Math.max(BASE_WAIT_TIME * 1.5, 1000));
            await waitForSelector(tabSelector, 15000);
        } else {
            console.log(`View #2: No "View All" button for ${tabKeyName}. Parsing table directly in View #2.`);
            vaultData[`${tabKeyName}Data`] = await extractTableDataView2(tableSelector, rowParser);
        }
    }

    // Specific row parsers for each detail tab
    const detailRowParsers = {
        balances: (row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) return null;
            return {
                coin: getElementText(cells[0]),
                totalBalance: getElementText(cells[1]),
                availableBalance: getElementText(cells[2]),
                usdcValue: getElementText(cells[3]),
                pnlRoeText: cells.length > 4 ? getElementText(cells[4]) : '',
                contract: cells.length > 5 ? getElementText(cells[5]) : '',
            };
        },
        tradeHistory: (row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 8) return null;
            return {
                time: getElementText(cells[0].querySelector('span') || cells[0]),
                coin: getElementText(cells[1]),
                direction: getElementText(cells[2]),
                price: getElementText(cells[3]),
                size: getElementText(cells[4]),
                tradeValue: getElementText(cells[5]),
                fee: getElementText(cells[6]),
                closedPnl: getElementText(cells[7])
            };
        },
        positions: (row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 9) return null;
            const coinText = getElementText(cells[0]);
            const leverageMatch = coinText.match(/(\d+)x/);
            return {
                coin: coinText.replace(/\s*\d+x/, '').trim(),
                leverage: leverageMatch ? leverageMatch[1] + 'x' : null,
                size: getElementText(cells[1]),
                positionValue: getElementText(cells[2]),
                entryPrice: getElementText(cells[3]),
                markPrice: getElementText(cells[4]),
                pnlRoeText: getElementText(cells[5]),
                liqPrice: getElementText(cells[6]),
                margin: getElementText(cells[7]),
                funding: getElementText(cells[8])
            };
        },
        fundingHistory: (row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return null;
            return {
                time: getElementText(cells[0].querySelector('span') || cells[0]),
                coin: getElementText(cells[1]),
                size: getElementText(cells[2]),
                positionSide: getElementText(cells[3]),
                payment: getElementText(cells[4]),
                rate: getElementText(cells[5])
            };
        },
        depositsWithdrawals: (row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return null;
            return {
                time: getElementText(cells[0].querySelector('span') || cells[0]),
                status: getElementText(cells[1]),
                network: getElementText(cells[2]),
                action: getElementText(cells[3]),
                accountValueChange: getElementText(cells[4].querySelector('div > span') || cells[4]),
                fee: getElementText(cells[5])
            };
        },
        depositors: (row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) return null;
            return {
                depositor: getElementText(cells[0]),
                vaultAmount: getElementText(cells[1]),
                unrealizedPnl: getElementText(cells[2]),
                allTimePnl: getElementText(cells[3]),
                daysFollowing: getElementText(cells[4])
            };
        }
    };

    // --- Main Execution ---
    await sleep(BASE_WAIT_TIME / 2);

    let mainListPageNum = 0;
    // const MAX_MAIN_PAGES = 100; // This is now effectively controlled by the pagination logic itself

    outerLoop:
    while (true) { // Loop indefinitely until "Next" button is no longer clickable or MAX_MAIN_PAGES is hit (if re-enabled)
        mainListPageNum++;
        if (mainListPageNum > MAX_MAIN_PAGES) { // Safety break
            console.warn(`Reached MAX_MAIN_PAGES limit of ${MAX_MAIN_PAGES}. Stopping.`);
            break;
        }
        console.log(`\nProcessing Main Vault List Page (View #1): ${mainListPageNum}`);
        await sleep(BASE_WAIT_TIME);

        let currentVaultRowIndexOnPage = 0;
        const PROCESSED_ON_PAGE_LIMIT = 200;
        let processedOnThisPage = 0;
        let vaultDetailURL = null;

        // Get all tables, then select the last one for User Vaults
        const allTables = document.querySelectorAll("table");
        let userVaultsTable = null;
        if (allTables.length > 0) {
            userVaultsTable = allTables[allTables.length -1];
        }

        const allMainListTableRows = userVaultsTable ? userVaultsTable.querySelectorAll("tbody tr") : [];

        if (allMainListTableRows.length === 0 && currentVaultRowIndexOnPage === 0) {
             console.warn(`View #1: No vault rows found in the last table on page ${mainListPageNum}.`);
             if (mainListPageNum === 1) {
                console.error("View #1: Critical error - No rows in the last table on the first page. Script might be on wrong page or selectors are incorrect.");
                return;
             }
             // If not the first page, and no rows, it might be an empty last page. Try to paginate.
        }


        while(processedOnThisPage < PROCESSED_ON_PAGE_LIMIT) {
            if (ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING !== false && processedEligibleVaultsCount >= ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING) {
                console.log(`Reached testing limit of ${ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING} processed vaults. Stopping.`);
                break outerLoop;
            }

            // Re-fetch rows for each iteration in case DOM changes after returning from View #2
            const currentMainListTableRows = userVaultsTable ? userVaultsTable.querySelectorAll("tbody tr") : [];

            if (currentVaultRowIndexOnPage >= currentMainListTableRows.length) {
                console.log(`View #1: All ${currentMainListTableRows.length} potential rows in the last table on page ${mainListPageNum} checked.`);
                break;
            }

            const currentRowElement = currentMainListTableRows[currentVaultRowIndexOnPage];
            const baseVaultData = extractMainListRowBaseData(currentRowElement);

            if (baseVaultData && baseVaultData.isEligible) {
                console.log(`View #1: Processing eligible vault (${processedEligibleVaultsCount + 1}/${ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING === false ? 'All' : ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING}): "${baseVaultData.vaultName}" (Row ${currentVaultRowIndexOnPage + 1}/${currentMainListTableRows.length} on page)`);

                let clickableElementToDetail = currentRowElement.querySelector('td:first-child a');
                if (!clickableElementToDetail) clickableElementToDetail = currentRowElement.querySelector('td:first-child');

                if (!clickableElementToDetail) {
                    console.error(`View #1: Could not find clickable element for vault: ${baseVaultData.vaultName}`);
                    currentVaultRowIndexOnPage++;
                    processedOnThisPage++;
                    continue;
                }

                vaultDetailURL = null; // Reset for each attempt

                try {
                    await clickElementAndWait(clickableElementToDetail, Math.max(BASE_WAIT_TIME * 1.5, 1000), SELECTOR_VAULT_PERFORMANCE_TAB_VIEW2);
                    vaultDetailURL = window.location.href; // Assign here after successful navigation

                    const contractAddress = vaultDetailURL.split('/').pop().split('?')[0]; // Get last path segment, remove query params
                    baseVaultData.address = contractAddress;

                    if (BLACKLIST_ADDRESSES.includes(contractAddress)) {
                        console.log(`View #2: Vault address ${contractAddress} is blacklisted. Skipping.`);
                        window.history.back();
                        await sleep(Math.max(BASE_WAIT_TIME * 1.5, 1000));
                        await waitForSelector("table tbody tr", 15000); // Wait for main list to reload
                        // currentVaultRowIndexOnPage is incremented at the end of the loop
                        processedOnThisPage++; // Still counts as a processed row for the page limit
                        continue;
                    }


                    await scrapeVaultPerformanceDataView2(baseVaultData);

                    for (const tabKey of Object.keys(SELECTORS_BOTTOM_TABS_VIEW2)) {
                        await sleep(BASE_WAIT_TIME / 2);
                        await scrapeBottomTab(tabKey, baseVaultData, vaultDetailURL);
                    }

                    allVaultsData.push(baseVaultData);
                    processedEligibleVaultsCount++;

                    console.log('View #2: Navigating back to View #1 (Main Vault List) using history.back()');
                    window.history.back();
                    await sleep(Math.max(BASE_WAIT_TIME * 1.5, 1000));
                    await waitForSelector("table tbody tr", 15000);
                    await sleep(BASE_WAIT_TIME * 0.5);
                    userVaultsTable = document.querySelectorAll("table")[document.querySelectorAll("table").length -1]; // Re-select the table after navigating back

                } catch (error) {
                    console.error(`Error processing vault "${baseVaultData.vaultName}": ${error.message}`, error.stack);
                    try {
                        console.warn("Attempting to navigate back to main list (View #1) after error...");
                        if (vaultDetailURL && window.location.href === vaultDetailURL) {
                            window.history.back();
                            await sleep(BASE_WAIT_TIME * 2);
                        } else if (!vaultDetailURL) {
                             console.log("Navigation to detail page might have failed. Attempting generic history.back().");
                             window.history.back();
                             await sleep(BASE_WAIT_TIME * 2);
                        } else {
                             console.log("Already navigated away from detail page or error occurred before full detail page load.");
                        }
                        await waitForSelector("table tbody tr", 15000);
                        userVaultsTable = document.querySelectorAll("table")[document.querySelectorAll("table").length -1]; // Re-select table
                    } catch (navError) {
                        console.error("Error navigating back after detail page error:", navError);
                    }
                }
            }
            currentVaultRowIndexOnPage++;
            processedOnThisPage++;
        }
         if (processedOnThisPage >= PROCESSED_ON_PAGE_LIMIT) {
            console.warn(`View #1: Reached processing limit (${PROCESSED_ON_PAGE_LIMIT}) for page ${mainListPageNum}.`);
        }

        if (ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING !== false && processedEligibleVaultsCount >= ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING) {
            break;
        }
        let buttonControls = Array.from(document.querySelectorAll("#root > div.sc-fEXmlR.ejmSgi > div:nth-child(3) > div > div > div > div.sc-iBYQkv.bCwfSg > div:nth-child(2) > div > div:nth-child(6) > div:nth-child(2) > div:nth-child(2) > div > div") ?? []);
        let buttonControlFindAttempts = 0;
        while (!buttonControls.length) {
          await sleep(Math.max(BASE_WAIT_TIME * 1.5, Math.max(1000 * (buttonControlFindAttempts + 1), 5000)));
          buttonControls = Array.from(document.querySelectorAll("#root > div.sc-fEXmlR.ejmSgi > div:nth-child(3) > div > div > div > div.sc-iBYQkv.bCwfSg > div:nth-child(2) > div > div:nth-child(6) > div:nth-child(2) > div:nth-child(2) > div > div") ?? []);
          buttonControlFindAttempts++;
          if (buttonControlFindAttempts > 10) {
            throw new Error("View #1: Failed to find pagination controls after multiple attempts. Stopping pagination.");
          }
        }
        const mainListNextButton = buttonControls[buttonControls.length - 1]; // Last button is usually "Next"
        if (mainListNextButton && !mainListNextButton.disabled && !mainListNextButton.hasAttribute('disabled') && !mainListNextButton.classList.contains(SELECTOR_MAIN_LIST_PAGINATION_DISABLED_CLASS)) {
            console.log('View #1: Clicking "Next Page" on main vault list...');
            await clickElementAndWait(mainListNextButton, Math.max(BASE_WAIT_TIME * 1.5, 1000), "table tbody tr");
            isFirstMainListPage = false;
        } else {
            console.log('View #1: Main vault list: No more pages or "Next" button is disabled/not found.');
            break;
        }
    }

    if (mainListPageNum >= MAX_MAIN_PAGES && (ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING === false || processedEligibleVaultsCount < ENABLE_DEBUG_MODE_NUM_VAULTS_TO_PROCESS_TESTING)) {
        console.warn(`Reached max main list pages limit (${MAX_MAIN_PAGES}) before processing all desired vaults.`);
    }

    console.log(`\nExtraction complete! Processed ${processedEligibleVaultsCount} eligible vaults.`);
    console.log(`Total vaults collected: ${allVaultsData.length}`);

    if (allVaultsData.length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        downloadJSON(allVaultsData, `vault_details_raw_${timestamp}.json`);
    } else {
        console.log('No vault data collected. JSON file not generated.');
    }

})().catch(error => {
    console.error('Unhandled error in main execution:', error.message, error.stack);
    alert(`Script failed! Check console for errors. Error: ${error.message}`);
});


/*

We can probably do this via their API using stuff like:

fetch("https://api-ui.hyperliquid.xyz/info", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({"aggregateByTime":true,"startTime":1682308800000,"type":"userFillsByTime","user":"0x070a78cadc7a6e4699bba9c3c2e562d0984ce579"})
}).then(async res => {
    const json = await res.json();
    console.log(json)
});

https://stats-data.hyperliquid.xyz/Mainnet/vaults

The current approach only gets the last 2000 results for trade history and other vault detail tabs.
 */
