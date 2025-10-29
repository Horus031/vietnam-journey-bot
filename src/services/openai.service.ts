import axios from "axios";

const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;

export async function askJourneyBot(prompt: string): Promise<string> {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a cultural travel assistant for Vietnam Journey Bot." },
        { role: "user", content: prompt },
      ],
    },
    {
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.choices[0].message.content;
}
