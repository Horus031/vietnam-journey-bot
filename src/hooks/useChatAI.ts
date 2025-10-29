import axios from "axios";

const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;

export async function askJourneyBot(prompt: string): Promise<string> {
  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyBuYh6S93A-7TOHqMUIqk6UyM8dp09sTvM",
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
