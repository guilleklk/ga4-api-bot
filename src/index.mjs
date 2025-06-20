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

app.post("/analyze", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    return res.status(400).json({ error: "Missing 'message' in body" });
  }

  try {
    const initial = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: userMessage }],
      functions,
      function_call: "auto"
    });

    const functionCall = initial.choices[0].message.function_call;
    const args = JSON.parse(functionCall.arguments);

    // Corrige posibles errores de formato
    if (args.metric?.toLowerCase().replace(/\s/g, '') === 'activeusers') {
      args.metric = 'activeUsers';
    }

    console.log("📡 GPT pidió:", args);

    const response = await fetch("https://ga4-api-bot.onrender.com/ga4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });

    const data = await response.json();

    const followUp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", function_call: functionCall },
        { role: "function", name: "getGa4Report", content: JSON.stringify(data) }
      ]
    });

    const output = followUp.choices[0].message.content;
    res.json({ result: output });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ NUEVO ENDPOINT: /ga4 para llamadas directas desde el asistente
app.post("/ga4", async (req, res) => {
  const { metric, dimension, startDate, endDate } = req.body;

  if (!metric || !dimension || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing fields in body" });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
    });

    const analytics = google.analyticsdata({
      version: "v1beta",
      auth
    });

    const response = await analytics.properties.runReport({
      property: `properties/${process.env.GA4_PROPERTY_ID}`,
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

    res.json({ rows });
  } catch (err) {
    console.error("❌ GA4 error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Server listening on http://localhost:${port}/analyze`);
});
