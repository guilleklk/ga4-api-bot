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

const functions = [
  {
    name: "getGa4Report",
    description: "Consulta datos de Google Analytics 4 usando múltiples métricas y dimensiones, además de fechas.",
    parameters: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "activeUsers",
              "newUsers",
              "screenPageViews",
              "engagedSessions",
              "averageSessionDuration",
              "bounceRate"
            ]
          }
        },
        dimensions: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "country",
              "city",
              "deviceCategory",
              "pagePath",
              "source",
              "medium",
              "campaign",
              "date"
            ]
          }
        },
        startDate: { type: "string" },
        endDate: { type: "string" }
      },
      required: ["metrics", "dimensions", "startDate", "endDate"]
    }
  }
];

app.post("/ga4", async (req, res) => {
  const { message, metric, metrics, dimension, dimensions, startDate, endDate } = req.body;

  const finalMetrics = metrics || (metric ? [metric] : []);
  const finalDimensions = dimensions || (dimension ? [dimension] : []);

  if (finalMetrics.length && finalDimensions.length && startDate && endDate) {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
      });

      const analytics = google.analyticsdata({ version: "v1beta", auth });

      const response = await analytics.properties.runReport({
        property: `properties/${process.env.GA4_PROPERTY_ID}`,
        requestBody: {
          metrics: finalMetrics.map(name => ({ name })),
          dimensions: finalDimensions.map(name => ({ name })),
          dateRanges: [{ startDate, endDate }]
        }
      });

      const rows = response.data.rows?.map(row => {
        const rowData = {};
        row.dimensionValues?.forEach((val, i) => rowData[finalDimensions[i]] = val.value);
        row.metricValues?.forEach((val, i) => rowData[finalMetrics[i]] = val.value);
        return rowData;
      }) || [];

      return res.json({ rows });
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

    const metricsList = args.metrics || (args.metric ? [args.metric] : []);
    const dimensionsList = args.dimensions || (args.dimension ? [args.dimension] : []);

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
    });

    const analytics = google.analyticsdata({ version: "v1beta", auth });

    const ga4Response = await analytics.properties.runReport({
      property: `properties/${process.env.GA4_PROPERTY_ID}`,
      requestBody: {
        metrics: metricsList.map(name => ({ name })),
        dimensions: dimensionsList.map(name => ({ name })),
        dateRanges: [{ startDate: args.startDate, endDate: args.endDate }]
      }
    });

    const rows = ga4Response.data.rows?.map(row => {
      const rowData = {};
      row.dimensionValues?.forEach((val, i) => rowData[dimensionsList[i]] = val.value);
      row.metricValues?.forEach((val, i) => rowData[metricsList[i]] = val.value);
      return rowData;
    }) || [];

    const followUp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "user", content: message },
        { role: "assistant", function_call: functionCall },
        { role: "function", name: "getGa4Report", content: JSON.stringify({ rows }) }
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
