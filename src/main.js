import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { chromium } from 'playwright';
import {
    normalizeGeo,
    parseGoogleTrendsJson,
    parsePlaywrightProxy,
    fetchTrendsCookies,
    fetchExploreTokens,
    fetchWidgetData,
    parseTimelineData,
    parseGeoData,
    parseRelatedList,
} from './extractors.js';

async function scrapeTermViaHttp(term, normalizedGeo, timeframe, hl, proxyUrl) {
    const cookieJar = new Map();
    const sessionToken = {};
    const exploreReferer = `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}&geo=${encodeURIComponent(normalizedGeo || '')}&date=${encodeURIComponent(timeframe)}&hl=${encodeURIComponent(hl)}`;

    await fetchTrendsCookies(gotScraping, hl, proxyUrl, cookieJar, sessionToken);
    const widgets = await fetchExploreTokens(gotScraping, term, normalizedGeo, timeframe, hl, proxyUrl, cookieJar, sessionToken);

    return {
        widgets,
        getWidgetJson: async (endpointUrl, widget) => {
            await new Promise((r) => setTimeout(r, 350));
            return fetchWidgetData(gotScraping, endpointUrl, widget, hl, proxyUrl, cookieJar, sessionToken, exploreReferer);
        },
    };
}

async function scrapeTermViaPlaywright(term, normalizedGeo, timeframe, hl, proxyUrl) {
    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-webgl',
            '--disable-3d-apis',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--no-first-run',
            '--mute-audio',
            '--disable-blink-features=AutomationControlled',
        ],
    };
    if (proxyUrl) {
        launchOptions.proxy = parsePlaywrightProxy(proxyUrl);
    }

    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({
            locale: 'en-US',
            extraHTTPHeaders: { 'Accept-Language': `${hl},en-US;q=0.9,en;q=0.8` },
        });
        const page = await context.newPage();

        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });

        let capturedExplore = null;
        page.on('response', async (res) => {
            if (res.url().includes('/trends/api/explore') && res.status() === 200) {
                try {
                    const txt = await res.text();
                    const parsed = parseGoogleTrendsJson(txt);
                    if (parsed?.widgets) capturedExplore = parsed.widgets;
                } catch {}
            }
        });

        const explorePageUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}&geo=${encodeURIComponent(normalizedGeo)}&date=${encodeURIComponent(timeframe)}&hl=${encodeURIComponent(hl)}`;
        await page.goto(explorePageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        if (currentUrl.includes('/sorry/')) {
            throw new Error(`Google CAPTCHA/sorry block hit at ${currentUrl}`);
        }

        if (!capturedExplore && currentUrl.includes('trends.google.com')) {
            const payload = {
                comparisonItem: [{ keyword: term, geo: normalizedGeo || '', time: timeframe }],
                category: 0,
                property: '',
            };
            const rawExplore = await page.evaluate(
                async ({ lang, reqStr }) => {
                    const u = `/trends/api/explore?hl=${encodeURIComponent(lang)}&tz=0&req=${encodeURIComponent(reqStr)}`;
                    const r = await fetch(u);
                    return r.ok ? await r.text() : null;
                },
                { lang: hl, reqStr: JSON.stringify(payload) }
            ).catch(() => null);
            const parsed = parseGoogleTrendsJson(rawExplore);
            if (parsed?.widgets) capturedExplore = parsed.widgets;
        }

        if (!capturedExplore) {
            throw new Error(`Playwright fallback could not obtain Google Trends widgets for "${term}"`);
        }

        // Extract all widgets inside same browser context before closing
        const rawWidgets = {};
        for (const w of capturedExplore) {
            let endpoint = null;
            if (w.id === 'TIMESERIES' || w.id?.startsWith('TIMESERIES')) endpoint = '/trends/api/widgetdata/multiline';
            if (w.id === 'GEO_MAP' || w.id?.startsWith('GEO_MAP')) endpoint = '/trends/api/widgetdata/comparedgeo';
            if (w.id === 'RELATED_QUERIES' || w.id === 'RELATED_TOPICS') endpoint = '/trends/api/widgetdata/relatedsearches';
            if (!endpoint) continue;

            const rawTxt = await page.evaluate(
                async ({ ep, lang, reqStr, tok }) => {
                    const u = `${ep}?hl=${encodeURIComponent(lang)}&tz=0&req=${encodeURIComponent(reqStr)}&token=${encodeURIComponent(tok)}`;
                    const r = await fetch(u);
                    return r.ok ? await r.text() : null;
                },
                { ep: endpoint, lang: hl, reqStr: JSON.stringify(w.request), tok: w.token }
            ).catch(() => null);

            if (rawTxt) {
                rawWidgets[w.id] = parseGoogleTrendsJson(rawTxt);
            }
        }

        return {
            widgets: capturedExplore,
            getWidgetJson: async (_endpointUrl, widget) => {
                if (!rawWidgets[widget.id]) {
                    throw new Error(`Playwright widget fetch returned empty/blocked for ${widget.id}`);
                }
                return rawWidgets[widget.id];
            },
        };
    } finally {
        await browser.close().catch(() => {});
    }
}

async function extractWidgetsFromSession(term, sessionData, options) {
    const {
        extractInterestOverTime,
        extractInterestByRegion,
        extractRelatedQueries,
        extractRelatedTopics,
    } = options;
    const { widgets, getWidgetJson } = sessionData;

    let interestOverTime = [];
    let interestByRegion = [];
    let relatedQueries = { top: [], rising: [] };
    let relatedTopics = { top: [], rising: [] };
    let requestedCount = 0;
    let succeededCount = 0;

    if (extractInterestOverTime) {
        const timeWidget = widgets.find((w) => w.id === 'TIMESERIES' || w.id?.startsWith('TIMESERIES'));
        if (timeWidget) {
            requestedCount++;
            try {
                const timeData = await getWidgetJson('https://trends.google.com/trends/api/widgetdata/multiline', timeWidget);
                interestOverTime = parseTimelineData(timeData);
                succeededCount++;
                log.info(`Extracted ${interestOverTime.length} timeline points for "${term}"`);
            } catch (e) {
                log.warning(`Failed to extract timeseries for "${term}": ${e.message}`);
            }
        }
    }

    if (extractInterestByRegion) {
        const geoWidget = widgets.find((w) => w.id === 'GEO_MAP' || w.id?.startsWith('GEO_MAP'));
        if (geoWidget) {
            requestedCount++;
            try {
                const geoData = await getWidgetJson('https://trends.google.com/trends/api/widgetdata/comparedgeo', geoWidget);
                interestByRegion = parseGeoData(geoData);
                succeededCount++;
                log.info(`Extracted ${interestByRegion.length} regions for "${term}"`);
            } catch (e) {
                log.warning(`Failed to extract geo data for "${term}": ${e.message}`);
            }
        }
    }

    if (extractRelatedQueries) {
        const queriesWidget = widgets.find((w) => w.id === 'RELATED_QUERIES');
        if (queriesWidget) {
            requestedCount++;
            try {
                const qData = await getWidgetJson('https://trends.google.com/trends/api/widgetdata/relatedsearches', queriesWidget);
                relatedQueries = parseRelatedList(qData);
                succeededCount++;
                log.info(`Extracted ${relatedQueries.top.length} top & ${relatedQueries.rising.length} rising queries for "${term}"`);
            } catch (e) {
                log.warning(`Failed to extract related queries for "${term}": ${e.message}`);
            }
        }
    }

    if (extractRelatedTopics) {
        const topicsWidget = widgets.find((w) => w.id === 'RELATED_TOPICS');
        if (topicsWidget) {
            requestedCount++;
            try {
                const tData = await getWidgetJson('https://trends.google.com/trends/api/widgetdata/relatedsearches', topicsWidget);
                relatedTopics = parseRelatedList(tData);
                succeededCount++;
                log.info(`Extracted ${relatedTopics.top.length} top & ${relatedTopics.rising.length} rising topics for "${term}"`);
            } catch (e) {
                log.warning(`Failed to extract related topics for "${term}": ${e.message}`);
            }
        }
    }

    return {
        interestOverTime,
        interestByRegion,
        relatedQueries,
        relatedTopics,
        requestedCount,
        succeededCount,
    };
}

await Actor.init();

let hasFailed = false;

try {
    const input = (await Actor.getInput()) || {};
    const {
        searchTerms = ['Artificial Intelligence', 'ChatGPT'],
        geo = '',
        timeframe = 'today 12-m',
        hl = 'en',
        extractInterestOverTime = true,
        extractInterestByRegion = true,
        extractRelatedQueries = true,
        extractRelatedTopics = true,
        proxyConfiguration,
    } = input;

    const normalizedGeo = normalizeGeo(geo);
    const cleanHl = (typeof hl === 'string' && hl.trim()) ? hl.trim() : 'en';
    const cleanTimeframe = (typeof timeframe === 'string' && timeframe.trim()) ? timeframe.trim() : 'today 12-m';

    let totalRecordsScraped = 0;

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
        log.warning('No search terms provided in searchTerms. Nothing to analyze.');
    } else {
        log.info(`Starting Google Trends Scraper for ${searchTerms.length} terms (Geo input: "${geo || 'Worldwide'}" -> normalized: "${normalizedGeo || 'Worldwide'}", Timeframe: "${cleanTimeframe}")`);

        const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : null;
        if (proxyConfig) {
            log.info('Apify Proxy configured successfully');
        }

        const extractOptions = {
            extractInterestOverTime,
            extractInterestByRegion,
            extractRelatedQueries,
            extractRelatedTopics,
        };

        for (const rawTerm of searchTerms) {
            const term = String(rawTerm || '').trim();
            if (!term) continue;

            log.info(`Analyzing Google Trends for term: "${term}"`);

            try {
                let extracted = null;
                const modes = proxyConfig ? ['proxy', 'proxy', 'direct'] : ['direct'];

                for (let i = 0; i < modes.length; i++) {
                    const mode = modes[i];
                    const attemptProxyUrl = mode === 'proxy' ? await proxyConfig.newUrl() : undefined;
                    try {
                        const sessionData = await scrapeTermViaHttp(term, normalizedGeo, cleanTimeframe, cleanHl, attemptProxyUrl);
                        log.info(`Explore tokens retrieved via HTTP (${mode}, attempt ${i + 1}) for "${term}"`);
                        const candidate = await extractWidgetsFromSession(term, sessionData, extractOptions);
                        if (candidate.requestedCount > 0 && candidate.succeededCount === 0) {
                            throw new Error(`All ${candidate.requestedCount} widget endpoints were blocked after HTTP explore`);
                        }
                        extracted = candidate;
                        break;
                    } catch (err) {
                        log.warning(`HTTP attempt ${i + 1} (${mode}) failed for "${term}": ${err.message}`);
                    }
                }

                // Playwright browser fallback if HTTP attempts were blocked
                if (!extracted) {
                    const pwModes = proxyConfig ? ['proxy', 'direct'] : ['direct'];
                    for (const pwMode of pwModes) {
                        const fallbackProxy = pwMode === 'proxy' ? await proxyConfig.newUrl() : undefined;
                        try {
                            log.info(`Switching to Playwright browser fallback (${pwMode}) for "${term}"...`);
                            const sessionData = await scrapeTermViaPlaywright(term, normalizedGeo, cleanTimeframe, cleanHl, fallbackProxy);
                            log.info(`Explore tokens retrieved via Playwright (${pwMode}) for "${term}"`);
                            const candidate = await extractWidgetsFromSession(term, sessionData, extractOptions);
                            if (candidate.requestedCount > 0 && candidate.succeededCount === 0) {
                                throw new Error(`All ${candidate.requestedCount} widget endpoints failed in Playwright (${pwMode})`);
                            }
                            extracted = candidate;
                            break;
                        } catch (pwErr) {
                            log.warning(`Playwright attempt (${pwMode}) failed for "${term}": ${pwErr.message}`);
                            if (pwMode === pwModes[pwModes.length - 1]) {
                                throw pwErr;
                            }
                        }
                    }
                }

                const {
                    interestOverTime,
                    interestByRegion,
                    relatedQueries,
                    relatedTopics,
                } = extracted;

                const trendRecord = {
                    term,
                    geo: normalizedGeo || 'Worldwide',
                    timeframe: cleanTimeframe,
                    category: 0,
                    interestOverTime: Array.isArray(interestOverTime) ? interestOverTime : [],
                    interestByRegion: Array.isArray(interestByRegion) ? interestByRegion : [],
                    relatedQueries: relatedQueries || { top: [], rising: [] },
                    relatedTopics: relatedTopics || { top: [], rising: [] },
                    scrapedAt: new Date().toISOString(),
                };

                await Actor.pushData(trendRecord);
                totalRecordsScraped++;
                log.info(`Saved trend analysis for "${term}" successfully.`);

                await new Promise((resolve) => setTimeout(resolve, 1500));
            } catch (err) {
                log.error(`Failed to analyze term "${term}": ${err.message}`);
            }
        }
    }

    const summary = {
        totalTerms: Array.isArray(searchTerms) ? searchTerms.length : 0,
        totalRecordsScraped,
        geo: normalizedGeo || 'Worldwide',
        timeframe: cleanTimeframe,
        status: 'SUCCEEDED',
        scrapedAt: new Date().toISOString(),
    };

    await Actor.setValue('OUTPUT', summary);
    log.info(`Trends scraping complete! Total terms analyzed: ${totalRecordsScraped}`);
} catch (err) {
    hasFailed = true;
    log.error(`Fatal execution error: ${err.message}`, { stack: err.stack });
    await Actor.setValue('OUTPUT', { status: 'FAILED', error: err.message }).catch(() => {});
    await Actor.fail(err.message);
} finally {
    if (!hasFailed) {
        await Actor.exit();
    }
}
