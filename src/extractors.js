/**
 * Google Trends Data Extraction & API Handlers
 */

const EXCLUDED_REGION_CODES = new Set(['FX', 'EU', 'UN', 'EZ', 'ZZ', 'QO', 'XA', 'XB', 'DG', 'IC', 'EA', 'CP', 'TA', 'AC']);

const COUNTRY_ALIASES = {
    worldwide: '',
    world: '',
    global: '',
    all: '',
    usa: 'US',
    'u.s.a.': 'US',
    'u.s.': 'US',
    america: 'US',
    'united states of america': 'US',
    uk: 'GB',
    'u.k.': 'GB',
    britain: 'GB',
    'great britain': 'GB',
    england: 'GB',
    uae: 'AE',
    emirates: 'AE',
    ksa: 'SA',
    saudi: 'SA',
    maroc: 'MA',
    'south korea': 'KR',
    russia: 'RU',
    vietnam: 'VN',
    iran: 'IR',
    taiwan: 'TW',
    syria: 'SY',
    tanzania: 'TZ',
    venezuela: 'VE',
    bolivia: 'BO',
    czechia: 'CZ',
    'czech republic': 'CZ',
    turkey: 'TR',
    turkiye: 'TR',
};

function buildCountryNameMap() {
    const map = { ...COUNTRY_ALIASES };
    try {
        const dn = new Intl.DisplayNames(['en'], { type: 'region' });
        for (let i = 65; i <= 90; i++) {
            for (let j = 65; j <= 90; j++) {
                const code = String.fromCharCode(i, j);
                if (EXCLUDED_REGION_CODES.has(code)) continue;
                const name = dn.of(code);
                if (name && name !== code && !/^\d+$/.test(name)) {
                    const lower = name.toLowerCase();
                    if (!map[lower]) map[lower] = code;
                }
            }
        }
    } catch {
        // Fallback to explicit aliases if Intl.DisplayNames unavailable
    }
    return map;
}

const COUNTRY_NAME_MAP = buildCountryNameMap();

/**
 * Normalize country names or lowercase ISO codes (e.g. "morocco" -> "MA", "us-ca" -> "US-CA")
 */
export function normalizeGeo(rawGeo) {
    if (!rawGeo || typeof rawGeo !== 'string') return '';
    const trimmed = rawGeo.trim();
    if (!trimmed) return '';

    const lower = trimmed.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(COUNTRY_NAME_MAP, lower)) {
        return COUNTRY_NAME_MAP[lower];
    }

    // Subregion like US-CA or GB-ENG
    if (/^[a-z]{2}-[a-z0-9]{1,3}$/i.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    // Two-letter ISO code like "ma" or "US"
    if (/^[a-z]{2}$/i.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    return trimmed.toUpperCase();
}

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
 * Parse Playwright proxy configuration into { server, username, password }
 */
export function parsePlaywrightProxy(proxyUrl) {
    if (!proxyUrl) return undefined;
    try {
        const u = new URL(proxyUrl);
        const proxy = {
            server: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`,
        };
        if (u.username) proxy.username = decodeURIComponent(u.username);
        if (u.password) proxy.password = decodeURIComponent(u.password);
        return proxy;
    } catch {
        return { server: proxyUrl };
    }
}

/**
 * Fetch NID/session cookies from Google Trends landing page
 */
export async function fetchTrendsCookies(got, hl = 'en', proxyUrl = undefined) {
    const options = {
        headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': `${hl},en-US;q=0.9,en;q=0.8`,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        timeout: { request: 15000 },
        retry: { limit: 1 },
        throwHttpErrors: false,
    };

    if (proxyUrl) {
        options.proxyUrl = proxyUrl;
    }

    const response = await got('https://trends.google.com/trends/', options);
    const setCookieHeader = response.headers['set-cookie'];
    if (!setCookieHeader) return '';

    const cookieArr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    return cookieArr.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

/**
 * Request Explore tokens from Google Trends API
 */
export async function fetchExploreTokens(got, keyword, geo = '', timeframe = 'today 12-m', hl = 'en', proxyUrl = undefined, cookieHeader = '') {
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

    const headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': `${hl},en-US;q=0.9,en;q=0.8`,
        'referer': `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}&geo=${encodeURIComponent(geo || '')}&date=${encodeURIComponent(timeframe)}`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (cookieHeader) {
        headers.cookie = cookieHeader;
    }

    const options = {
        headers,
        searchParams,
        timeout: { request: 20000 },
        retry: { limit: 1 },
        throwHttpErrors: false,
    };

    if (proxyUrl) {
        options.proxyUrl = proxyUrl;
    }

    const response = await got(exploreUrl, options);
    const parsed = parseGoogleTrendsJson(response.body);

    if (response.statusCode !== 200 || !parsed || !parsed.widgets) {
        throw new Error(`HTTP ${response.statusCode} or blocked explore response from Google Trends for "${keyword}" (geo="${geo || 'Worldwide'}")`);
    }

    return parsed.widgets;
}

/**
 * Fetch individual widget data (Timeseries, GeoMap, or Related Searches)
 */
export async function fetchWidgetData(got, endpointUrl, widget, hl = 'en', proxyUrl = undefined, cookieHeader = '') {
    const searchParams = {
        hl,
        tz: '0',
        req: JSON.stringify(widget.request),
        token: widget.token,
    };

    const headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': `${hl},en-US;q=0.9,en;q=0.8`,
        'referer': 'https://trends.google.com/trends/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (cookieHeader) {
        headers.cookie = cookieHeader;
    }

    const options = {
        headers,
        searchParams,
        timeout: { request: 20000 },
        retry: { limit: 1 },
        throwHttpErrors: false,
    };

    if (proxyUrl) {
        options.proxyUrl = proxyUrl;
    }

    const response = await got(endpointUrl, options);
    if (response.statusCode !== 200) {
        throw new Error(`Widget endpoint returned HTTP ${response.statusCode}`);
    }
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
