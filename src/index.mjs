import express from "express";
import 'dotenv/config';
import fetch from "node-fetch";
import { OpenAI } from "openai";
import bodyParser from "body-parser";
import { google } from "googleapis";

const app = express();
const port = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.json());

const allowedMetrics = [
  "activeUsers", "newUsers", "screenPageViews", "engagedSessions",
  "averageSessionDuration", "bounceRate", "sessions", "engagementRate",
  "eventCount", "conversions", "totalRevenue", "userEngagementDuration"
];

const allowedDimensions = [
  "country", "city", "deviceCategory", "pagePath", "source",
  "medium", "campaign", "date", "sessionDefaultChannelGroup",
  "landingPagePlusQueryString", "browser", "operatingSystem",
  "platform", "hour", "dateHour", "eventName"
];

const functions = [
  {
    name: "getGa4Report",
    description: "Consulta datos de Google Analytics 4 con múltiples métricas y dimensiones, y fechas.",
    parameters: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          items: { type: "string" },
          example: ["activeUsers", "bounceRate"]
        },
        dimensions: {
          type: "array",
          items: { type: "string" },
          example: ["city", "deviceCategory"]
        },
        startDate: { type: "string" },
        endDate: { type: "string" },
        filters: {
          type: "object",
          description: "Condiciones para filtrar por dimensión. Clave = dimensión, valor = condición exacta o parte del valor",
          example: {
            "country": "Spain",
            "deviceCategory": "mobile"
          }
        }
      },
      required: ["metrics", "dimensions", "startDate", "endDate"]
    }
  }
];

function getParsedCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  const parsed = JSON.parse(raw);
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function generateInsights(rows, metrics) {
  const insights = [];

  if (metrics.includes("bounceRate")) {
    const highBounce = rows.filter(r => parseFloat(r.bounceRate) > 80);
    if (highBounce.length) {
      insights.push(`⚠️ ${highBounce.length} segmentos tienen una tasa de rebote superior al 80%.`);
    }
  }

  if (metrics.includes("activeUsers")) {
    const lowTraffic = rows.filter(r => parseInt(r.activeUsers) < 3);
    if (lowTraffic.length) {
      insights.push(`👀 ${lowTraffic.length} segmentos tienen menos de 3 usuarios activos.`);
    }
  }

  if (metrics.includes("engagementRate")) {
    const goodEngagement = rows.filter(r => parseFloat(r.engagementRate) >= 70);
    if (goodEngagement.length) {
      insights.push(`✅ ${goodEngagement.length} segmentos tienen un buen ratio de interacción (>= 70%).`);
    }
  }

  return insights;
}

app.post("/ga4", async (req, res) => {
  const { message, metrics, dimensions, startDate, endDate, filters } = req.body;

  const invalidMetrics = metrics?.filter(m => !allowedMetrics.includes(m)) || [];
  const invalidDimensions = dimensions?.filter(d => !allowedDimensions.includes(d)) || [];
  const invalidFilters = Object.keys(filters || {}).filter(f => !allowedDimensions.includes(f));

  if (invalidMetrics.length || invalidDimensions.length || invalidFilters.length) {
    return res.status(400).json({
      error: `Invalid metric(s): ${invalidMetrics.join(", ")} | Invalid dimension(s): ${invalidDimensions.join(", ")} | Invalid filters: ${invalidFilters.join(", ")}`
    });
  }

  if (metrics && dimensions && startDate && endDate) {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: getParsedCredentials(),
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
      });

      const analytics = google.analyticsdata({ version: "v1beta", auth });

      const response = await analytics.properties.runReport({
        property: `properties/${process.env.GA4_PROPERTY_ID}`,
        requestBody: {
          metrics: metrics.map(name => ({ name })),
          dimensions: dimensions.map(name => ({ name })),
          dateRanges: [{ startDate, endDate }],
          dimensionFilter: filters
            ? {
                andGroup: {
                  expressions: Object.entries(filters).map(([key, value]) => ({
                    filter: {
                      fieldName: key,
                      stringFilter: {
                        matchType: "MATCH_TYPE_UNSPECIFIED",
                        value,
                        caseSensitive: false
                      }
                    }
                  }))
                }
              }
            : undefined
        }
      });

      const rows = response.data.rows?.map(row => {
        const result = {};
        row.dimensionValues?.forEach((dim, i) => result[dimensions[i]] = dim.value);
        row.metricValues?.forEach((met, i) => result[metrics[i]] = met.value);
        return result;
      }) || [];

      const insights = generateInsights(rows, metrics);
      return res.json({ rows, insights });
    } catch (err) {
      console.error("❌ GA4 error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (!message) {
    return res.status(400).json({ error: "Missing 'message' or GA4 fields in body" });
  }

  try {
    const initial = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
      functions,
      function_call: "auto"
    });

    const functionCall = initial.choices[0].message.function_call;
    const args = JSON.parse(functionCall.arguments);

    const invalidMetrics = args.metrics.filter(m => !allowedMetrics.includes(m));
    const invalidDimensions = args.dimensions.filter(d => !allowedDimensions.includes(d));
    const invalidFilters = Object.keys(args.filters || {}).filter(f => !allowedDimensions.includes(f));

    if (invalidMetrics.length || invalidDimensions.length || invalidFilters.length) {
      return res.status(400).json({
        error: `Invalid metric(s): ${invalidMetrics.join(", ")} | Invalid dimension(s): ${invalidDimensions.join(", ")} | Invalid filters: ${invalidFilters.join(", ")}`
      });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: getParsedCredentials(),
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
    });

    const analytics = google.analyticsdata({ version: "v1beta", auth });

    const ga4Response = await analytics.properties.runReport({
      property: `properties/${process.env.GA4_PROPERTY_ID}`,
      requestBody: {
        metrics: args.metrics.map(name => ({ name })),
        dimensions: args.dimensions.map(name => ({ name })),
        dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
        dimensionFilter: args.filters
          ? {
              andGroup: {
                expressions: Object.entries(args.filters).map(([key, value]) => ({
                  filter: {
                    fieldName: key,
                    stringFilter: {
                      matchType: "MATCH_TYPE_UNSPECIFIED",
                      value,
                      caseSensitive: false
                    }
                  }
                }))
              }
            }
          : undefined
      }
    });

    const rows = ga4Response.data.rows?.map(row => {
      const result = {};
      row.dimensionValues?.forEach((dim, i) => result[args.dimensions[i]] = dim.value);
      row.metricValues?.forEach((met, i) => result[args.metrics[i]] = met.value);
      return result;
    }) || [];

    const insights = generateInsights(rows, args.metrics);

    const followUp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "user", content: message },
        { role: "assistant", function_call: functionCall },
        { role: "function", name: "getGa4Report", content: JSON.stringify({ rows, insights }) }
      ]
    });

    const output = followUp.choices[0].message.content;
    res.json({ result: output });
  } catch (err) {
    console.error("❌ GPT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Server listening on http://localhost:${port}/ga4`);
});
