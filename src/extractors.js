/**
 * Google Trends Data Extraction & API Handlers
 */

/**
 * Remove Google Trends security anti-hijacking prefix: ")]}'\n"
 */
export function parseGoogleTrendsJson(rawText) {
    if (!rawText) return null;
    const cleanText = rawText.replace(/^\)\]\}',?\s*/, '').trim();
    try {
        return JSON.parse(cleanText);
    } catch {
        return null;
    }
}

/**
 * Request Explore tokens from Google Trends API
 */
export async function fetchExploreTokens(got, keyword, geo = '', timeframe = 'today 12-m', hl = 'en', proxyUrl = null) {
    const exploreUrl = 'https://trends.google.com/trends/api/explore';
    
    const requestPayload = {
        comparisonItem: [
            {
                keyword,
                geo: geo || '',
                time: timeframe,
            },
        ],
        category: 0,
        property: '',
    };

    const searchParams = {
        hl,
        tz: '0',
        req: JSON.stringify(requestPayload),
    };

    const options = {
        headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': `${hl},en-US;q=0.9,en;q=0.8`,
            'referer': `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}&geo=${geo}&date=${encodeURIComponent(timeframe)}`,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
        searchParams,
        timeout: { request: 25000 },
        retry: { limit: 2 },
    };

    if (proxyUrl) {
        options.proxyUrl = proxyUrl;
    }

    const response = await got(exploreUrl, options);
    const parsed = parseGoogleTrendsJson(response.body);

    if (!parsed || !parsed.widgets) {
        throw new Error(`Invalid or blocked explore response from Google Trends for "${keyword}"`);
    }

    return parsed.widgets;
}

/**
 * Fetch individual widget data (Timeseries, GeoMap, or Related Searches)
 */
export async function fetchWidgetData(got, endpointUrl, widget, hl = 'en', proxyUrl = null) {
    const searchParams = {
        hl,
        tz: '0',
        req: JSON.stringify(widget.request),
        token: widget.token,
    };

    const options = {
        headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': `${hl},en-US;q=0.9,en;q=0.8`,
            'referer': 'https://trends.google.com/trends/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
        searchParams,
        timeout: { request: 20000 },
        retry: { limit: 2 },
    };

    if (proxyUrl) {
        options.proxyUrl = proxyUrl;
    }

    const response = await got(endpointUrl, options);
    return parseGoogleTrendsJson(response.body);
}

/**
 * Parse timeline data from TIMESERIES widget response
 */
export function parseTimelineData(json) {
    if (!json || !json.default || !Array.isArray(json.default.timelineData)) return [];

    return json.default.timelineData.map((item) => ({
        timestamp: item.time,
        date: item.formattedTime,
        value: item.value && item.value.length > 0 ? item.value[0] : 0,
        formattedValue: item.formattedValue && item.formattedValue.length > 0 ? item.formattedValue[0] : '0',
        hasData: item.hasData && item.hasData.length > 0 ? item.hasData[0] : true,
    }));
}

/**
 * Parse regional breakdown from GEO_MAP widget response
 */
export function parseGeoData(json) {
    if (!json || !json.default || !Array.isArray(json.default.geoMapData)) return [];

    return json.default.geoMapData
        .filter((item) => item.value && item.value.length > 0 && item.value[0] > 0)
        .map((item) => ({
            geoCode: item.geoCode,
            geoName: item.geoName,
            value: item.value[0],
            formattedValue: item.formattedValue ? item.formattedValue[0] : String(item.value[0]),
            maxValueIndex: item.maxValueIndex || 0,
        }));
}

/**
 * Parse Top and Rising lists from RELATED_QUERIES or RELATED_TOPICS
 */
export function parseRelatedList(json) {
    if (!json || !json.default || !Array.isArray(json.default.rankedList)) {
        return { top: [], rising: [] };
    }

    const topList = json.default.rankedList[0]?.rankedKeyword || [];
    const risingList = json.default.rankedList[1]?.rankedKeyword || [];

    const formatItems = (items) => items.map((item) => ({
        query: item.query || item.topic?.title || item.title || null,
        value: item.value,
        formattedValue: item.formattedValue || String(item.value),
        type: item.topic?.type || null,
        link: item.link ? `https://trends.google.com${item.link}` : null,
    }));

    return {
        top: formatItems(topList),
        rising: formatItems(risingList),
    };
}
