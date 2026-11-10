import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import {
    fetchExploreTokens,
    fetchWidgetData,
    parseTimelineData,
    parseGeoData,
    parseRelatedList,
} from './extractors.js';

await Actor.init();

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

    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
        log.warning('No search terms provided in searchTerms. Nothing to analyze.');
        await Actor.exit();
    }

    log.info(`Starting Google Trends Scraper for ${searchTerms.length} terms (Geo: "${geo || 'Worldwide'}", Timeframe: "${timeframe}")`);

    // Setup Proxy
    let proxyUrl = undefined;
    if (proxyConfiguration) {
        const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
        if (proxyConfig) {
            proxyUrl = await proxyConfig.newUrl();
            log.info('Proxy enabled successfully');
        }
    }

    let totalRecordsScraped = 0;

    for (const term of searchTerms) {
        log.info(`Analyzing Google Trends for term: "${term}"`);

        try {
            // Step 1: Fetch Explore Widgets and tokens
            const widgets = await fetchExploreTokens(gotScraping, term, geo, timeframe, hl, proxyUrl);

            let interestOverTime = [];
            let interestByRegion = [];
            let relatedQueries = { top: [], rising: [] };
            let relatedTopics = { top: [], rising: [] };

            // Step 2: Extract Timeseries (Interest over time)
            if (extractInterestOverTime) {
                const timeWidget = widgets.find((w) => w.id === 'TIMESERIES');
                if (timeWidget) {
                    try {
                        const url = 'https://trends.google.com/trends/api/widgetdata/multiline';
                        const timeData = await fetchWidgetData(gotScraping, url, timeWidget, hl, proxyUrl);
                        interestOverTime = parseTimelineData(timeData);
                        log.info(`Extracted ${interestOverTime.length} timeline data points for "${term}"`);
                    } catch (e) {
                        log.warning(`Failed to extract timeseries for "${term}": ${e.message}`);
                    }
                }
            }

            // Step 3: Extract Geo Map (Interest by region)
            if (extractInterestByRegion) {
                const geoWidget = widgets.find((w) => w.id === 'GEO_MAP');
                if (geoWidget) {
                    try {
                        const url = 'https://trends.google.com/trends/api/widgetdata/comparedgeo';
                        const geoData = await fetchWidgetData(gotScraping, url, geoWidget, hl, proxyUrl);
                        interestByRegion = parseGeoData(geoData);
                        log.info(`Extracted ${interestByRegion.length} regions for "${term}"`);
                    } catch (e) {
                        log.warning(`Failed to extract geo data for "${term}": ${e.message}`);
                    }
                }
            }

            // Step 4: Extract Related Queries
            if (extractRelatedQueries) {
                const queriesWidget = widgets.find((w) => w.id === 'RELATED_QUERIES');
                if (queriesWidget) {
                    try {
                        const url = 'https://trends.google.com/trends/api/widgetdata/relatedsearches';
                        const qData = await fetchWidgetData(gotScraping, url, queriesWidget, hl, proxyUrl);
                        relatedQueries = parseRelatedList(qData);
                        log.info(`Extracted ${relatedQueries.top.length} top & ${relatedQueries.rising.length} rising queries for "${term}"`);
                    } catch (e) {
                        log.warning(`Failed to extract related queries for "${term}": ${e.message}`);
                    }
                }
            }

            // Step 5: Extract Related Topics
            if (extractRelatedTopics) {
                const topicsWidget = widgets.find((w) => w.id === 'RELATED_TOPICS');
                if (topicsWidget) {
                    try {
                        const url = 'https://trends.google.com/trends/api/widgetdata/relatedsearches';
                        const tData = await fetchWidgetData(gotScraping, url, topicsWidget, hl, proxyUrl);
                        relatedTopics = parseRelatedList(tData);
                        log.info(`Extracted ${relatedTopics.top.length} top & ${relatedTopics.rising.length} rising topics for "${term}"`);
                    } catch (e) {
                        log.warning(`Failed to extract related topics for "${term}": ${e.message}`);
                    }
                }
            }

            // Assemble complete trend item
            const trendRecord = {
                term,
                geo: geo || 'Worldwide',
                timeframe,
                interestOverTime,
                interestByRegion,
                relatedQueries,
                relatedTopics,
                scrapedAt: new Date().toISOString(),
            };

            await Actor.pushData(trendRecord);
            totalRecordsScraped++;
            log.info(`Saved trend analysis for "${term}" successfully.`);

            // Polite delay between terms
            await new Promise((resolve) => setTimeout(resolve, 2000));

        } catch (err) {
            log.error(`Failed to analyze term "${term}": ${err.message}`);
        }
    }

    // Save final executive summary
    const summary = {
        totalTerms: searchTerms.length,
        totalRecordsScraped,
        geo: geo || 'Worldwide',
        timeframe,
        status: 'SUCCEEDED',
        scrapedAt: new Date().toISOString(),
    };

    await Actor.setValue('OUTPUT', summary);
    log.info(`Trends scraping complete! Total terms analyzed: ${totalRecordsScraped}`);

} catch (err) {
    log.error(`Fatal execution error: ${err.message}`, { stack: err.stack });
    await Actor.setValue('OUTPUT', { status: 'FAILED', error: err.message });
} finally {
    await Actor.exit();
}
