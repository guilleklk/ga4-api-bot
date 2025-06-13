import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

// ✅ Verifica que existe la variable de entorno
if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
  throw new Error("❌ Missing GOOGLE_SERVICE_ACCOUNT environment variable");
}

// ✅ Usa directamente las credenciales parseadas
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: SCOPES,
});

app.post("/ga4", async (req, res) => {
  console.log("📩 POST /ga4 received");

  const { metric, dimension, startDate, endDate } = req.body;

  if (!metric || !dimension || !startDate || !endDate) {
    return res.status(400).json({ error: "Missing parameters" });
  }

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

    // ✅ Usa función para convertir los datos en una frase
    const formatted = formatGa4Response(
      response.data,
      metric,
      dimension,
      startDate,
      endDate
    );

    // ✅ Devuelve la frase en formato limpio para Assistant
    res.json({ result: formatted });
  } catch (err) {
    console.error("❌ GA4 Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function formatGa4Response(data, metric = "activeUsers", dimension = "city", startDate, endDate) {
  if (!data?.rows || data.rows.length === 0) {
    return `No se encontraron datos de ${metric} por ${dimension} entre ${startDate} y ${endDate}.`;
  }

  const resumen = data.rows
    .map(row => {
      const nombre = row.dimensionValues?.[0]?.value || "desconocido";
      const valor = row.metricValues?.[0]?.value || "0";
      return `${nombre} (${valor})`;
    })
    .join(", ");

  return `Del ${startDate} al ${endDate}, los ${metric} por ${dimension} fueron: ${resumen}.`;
}

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
