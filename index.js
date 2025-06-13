import 'dotenv/config';
import fetch from 'node-fetch';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const userMessage = "Muéstrame los usuarios activos por ciudad del 1 al 7 de junio de 2024";

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

const run = async () => {
  const initial = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: userMessage }],
    functions,
    function_call: "auto"
  });

  const functionCall = initial.choices[0].message.function_call;
  const args = JSON.parse(functionCall.arguments);

  console.log("🔧 Assistant pidió llamar a:", functionCall.name);
  console.log("📦 Con argumentos:", args);

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
      { role: "assistant", function_call },
      { role: "function", name: "getGa4Report", content: JSON.stringify(data) }
    ]
  });

  console.log("\n💬 GPT responde:");
  console.log(followUp.choices[0].message.content);
};

run();
