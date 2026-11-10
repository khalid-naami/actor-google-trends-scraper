# 📈 Google Trends Scraper (Interest Over Time, Region & Related Queries)

Extract real-time and historical search trend intelligence from Google Trends at scale. Scrape interest over time (timeline scores 0-100), regional geographic breakdown, Top & Rising (Breakout) related search queries, and related topics.

---

## 🌟 Key Features

- ⏳ **Interest Over Time**: Extract historical timeline index scores (0 to 100) across custom timeframes.
- 🗺️ **Interest by Region / Country**: Capture geographic distribution and density of search interest across subregions or worldwide.
- 🚀 **Breakout & Rising Queries**: Detect viral surges and new search terms gaining rapid momentum before competitors.
- 🏷️ **Related Topics**: Identify thematic associations, entities, and categories linked to your core keywords.
- 🌍 **Global or Country-Specific Filtering**: Analyze worldwide trends or target specific nations (`US`, `GB`, `FR`, `DE`, `SA`, `JP`, etc.).
- 🛡️ **Apify Proxy Built-in**: Full proxy rotation to prevent rate-limiting and ensure continuous trend monitoring.

---

## 📥 Input Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `searchTerms` | Array | `["Artificial Intelligence", "ChatGPT"]` | List of keywords or topics to analyze. |
| `geo` | String | `""` | Country code (e.g. `US`, `GB`, `DE`, `FR`, `SA`) or empty for Worldwide. |
| `timeframe` | String | `"today 12-m"` | Duration to evaluate (`now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`). |
| `hl` | String | `"en"` | Language code for query and topic names. |
| `extractInterestOverTime` | Boolean | `true` | Extract historical timeline interest scores. |
| `extractInterestByRegion` | Boolean | `true` | Extract regional geographical distribution. |
| `extractRelatedQueries` | Boolean | `true` | Extract Top and Rising related search queries. |
| `extractRelatedTopics` | Boolean | `true` | Extract Top and Rising related topic categories. |
| `proxyConfiguration` | Object | `{ "useApifyProxy": true }` | Apify Proxy configuration settings. |

---

## 📤 Output Data Format

Each dataset record contains comprehensive trend metrics for a keyword:

```json
{
  "term": "Artificial Intelligence",
  "geo": "Worldwide",
  "timeframe": "today 12-m",
  "interestOverTime": [
    {
      "timestamp": "1700352000",
      "date": "Nov 19, 2023",
      "value": 85,
      "formattedValue": "85",
      "hasData": true
    }
  ],
  "interestByRegion": [
    {
      "geoCode": "SG",
      "geoName": "Singapore",
      "value": 100,
      "formattedValue": "100"
    },
    {
      "geoCode": "AE",
      "geoName": "United Arab Emirates",
      "value": 88,
      "formattedValue": "88"
    }
  ],
  "relatedQueries": {
    "top": [
      {
        "query": "chat gpt",
        "value": 100,
        "formattedValue": "100"
      }
    ],
    "rising": [
      {
        "query": "deepseek ai",
        "value": 4500,
        "formattedValue": "Breakout"
      }
    ]
  },
  "relatedTopics": {
    "top": [
      {
        "query": "Technology",
        "value": 100,
        "type": "Topic"
      }
    ],
    "rising": [
      {
        "query": "Generative artificial intelligence",
        "value": 1200,
        "type": "Field of study"
      }
    ]
  },
  "scrapedAt": "2026-11-09T13:50:00.000Z"
}
```

---

## 💡 Practical Use Cases

1. **SEO & Content Marketing**: Identify explosive "Breakout" keywords before they saturate Google organic results.
2. **Product & Market Research**: Compare brand awareness and consumer interest trajectory across competing products.
3. **E-commerce Trend Scouting**: Uncover high-growth product categories and seasonal demand shifts across different countries.
4. **Financial & Investment Sentiment**: Track macro attention and sentiment cycles on commodities, cryptocurrencies, and tech innovations.

---

## ⚖️ License
Apache-2.0
