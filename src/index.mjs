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
    description: "Consulta datos de Google Analytics 4 segmentados por métrica, dimensión y fechas.",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string" },
        dimension: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" }
      },
      required: ["metric", "dimension", "startDate", "endDate"]
    }
  }
];

function getParsedCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  const parsed = JSON.parse(raw);
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

// ✅ Endpoint único híbrido
app.post("/ga4", async (req, res) => {
  const { message, metric, dimension, startDate, endDate } = req.body;

  // Caso directo (GA4 API)
  if (metric && dimension && startDate && endDate) {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: getParsedCredentials(),
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
      });

      const analytics = google.analyticsdata({ version: "v1beta", auth });

      const response = await analytics.properties.runReport({
        property: properties/${process.env.GA4_PROPERTY_ID},
        requestBody: {
          metrics: [{ name: metric }],
          dimensions: [{ name: dimension }],
          dateRanges: [{ startDate, endDate }]
        }
      });

      const rows = response.data.rows?.map(row => {
        const dimVal = row.dimensionValues?.[0]?.value;
        const metVal = row.metricValues?.[0]?.value;
        return { [dimension]: dimVal, [metric]: metVal };
      }) || [];

      return res.json({ rows });
    } catch (err) {
      console.error("❌ GA4 error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Caso Assistant (GPT)
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

    if (args.metric?.toLowerCase().replace(/\s/g, '') === 'activeusers') {
      args.metric = 'activeUsers';
    }

    console.log("🤖 GPT pidió:", args);

    const auth = new google.auth.GoogleAuth({
      credentials: getParsedCredentials(),
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
    });

    const analytics = google.analyticsdata({ version: "v1beta", auth });

    const ga4Response = await analytics.properties.runReport({
      property: properties/${process.env.GA4_PROPERTY_ID},
      requestBody: {
        metrics: [{ name: args.metric }],
        dimensions: [{ name: args.dimension }],
        dateRanges: [{ startDate: args.startDate, endDate: args.endDate }]
      }
    });

    const rows = ga4Response.data.rows?.map(row => {
      const dimVal = row.dimensionValues?.[0]?.value;
      const metVal = row.metricValues?.[0]?.value;
      return { [args.dimension]: dimVal, [args.metric]: metVal };
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
  console.log(✅ Server listening on http://localhost:${port}/ga4);
});
