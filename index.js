import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import fs from "fs";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
app.use(bodyParser.json());

const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];
const KEYFILE = "/tmp/service-account.json";

// ✅ 1. Verificamos que existe la variable
if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
  throw new Error("❌ Missing GOOGLE_SERVICE_ACCOUNT environment variable");
}

// ✅ 2. Parseamos string a JSON, y luego escribimos archivo válido
try {
  const parsedCredentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  fs.writeFileSync(KEYFILE, JSON.stringify(parsedCredentials));
} catch (err) {
  console.error("❌ Failed to parse GOOGLE_SERVICE_ACCOUNT:", err.message);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: SCOPES,
});

app.post("/ga4", async (req, res) => {
  console.log("📩 POST /ga4 received");

  const { metric, dimension, startDate, endDate } = req.body;

  try {
    const analyticsData = google.analyticsdata({
      version: "v1beta",
      auth: await auth.getClient(),
    });

    const response = await analyticsData.properties.runReport({
      property: `properties/${process.env.GA4_PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: metric }],
        dimensions: [{ name: dimension }],
      },
    });

    res.json(response.data);
  } catch (err) {
    console.error("❌ GA4 Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
