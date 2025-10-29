export async function askJourneyBot(
  userPrompt: string
): Promise<{ text: string; jsonData: unknown }> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("VITE_GEMINI_API_KEY is not set in environment");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const basePrompt = `
    Bạn là một hướng dẫn viên du lịch Việt Nam thông minh, thân thiện, giàu hiểu biết về văn hóa và lịch sử.
    Khi người dùng hỏi về hành trình du lịch, bạn luôn trả lời bằng tiếng Việt, gọn gàng và có cảm xúc.
    Hãy đảm bảo các địa điểm du lịch gần nhau và giúp người dùng đi du lịch có logic.
    Hãy chắc chắn rằng bạn tìm đúng những địa điểm do người dùng hỏi (vì có nhiều chỗ có tên giống nhau, nên hãy cân nhắc)
    Lưu ý: Nếu có ai hỏi về những lịch trình du lịch hoặc địa điểm khác nằm ngoài Việt Nam, hãy từ chối khéo và gợi ý họ hỏi về du lịch Việt Nam
    Nếu có ai hỏi về chủ đề khác không phải là về du lịch hoặc thông tin về các địa điểm, hãy từ chối khéo và gợi ý họ hỏi về du lịch.

    Ngoài ra, bạn trả về JSON chứa dữ liệu bản đồ ở cuối câu trả lời (Lưu ý chỉ trả ở cuối cùng!):

    Nếu như họ hỏi về lịch trình du lịch, trả về định dạng JSON:
    [
        {
            "day": 1,
            destinations: [
                {
                "name": "Tên địa điểm", "lat": số (đảm bảo lấy chính xác), "lng": số (đảm bảo lấy chính xác), "desc": "Mô tả ngắn", "source": "Nguồn để đọc thêm (ưu tiên Wikipedia)"
                }
            ]
        },
        ...
    ]

    Nếu như họ hỏi về thông tin của một địa điểm (Ví dụ thông tin về các thành phố, địa danh nổi tiếng), trả về định dạng JSON (sau đó gợi ý họ hỏi về lịch trình du lịch):
    {
      "name": "Tên địa điểm", "lat": số (đảm bảo lấy chính xác), "lng": số (đảm bảo lấy chính xác), "desc": "Mô tả địa điểm", "source": "Nguồn để đọc thêm (ưu tiên Wikipedia)"
    }
  `;

  const body = {
    contents: [
      { role: "user", parts: [{ text: `${basePrompt}\n${userPrompt}` }] },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini API Error ${res.status}: ${txt}`);
  }

  // filepath: d:\AIEduDemo\vietnam-journey-bot\src\services\gemini.ts
  // ...existing code...
  const data: unknown = await res.json();

  const getFirstCandidateText = (obj: unknown): string => {
    if (obj === null || obj === undefined || typeof obj !== "object") return "Không có phản hồi.";
    const o = obj as Record<string, unknown>;
    const candidates = o["candidates"];
    if (!Array.isArray(candidates) || candidates.length === 0) return "Không có phản hồi.";
    const c0 = candidates[0];
    if (c0 === null || typeof c0 !== "object") return "Không có phản hồi.";
    const content = (c0 as Record<string, unknown>)["content"];
    if (content === null || typeof content !== "object") return "Không có phản hồi.";
    const parts = (content as Record<string, unknown>)["parts"];
    if (!Array.isArray(parts) || parts.length === 0) return "Không có phản hồi.";
    const p0 = parts[0];
    if (p0 === null || typeof p0 !== "object") return "Không có phản hồi.";
    const text = (p0 as Record<string, unknown>)["text"];
    return typeof text === "string" ? text : "Không có phản hồi.";
  };

  const rawText = getFirstCandidateText(data);

  // --- Robust JSON extraction (fenced blocks, ``` or ```json, or last balanced object/array) ---
  let jsonData: unknown = null;
  let cleanedText = rawText;

  const tryParse = (s: string): unknown => {
    // strip leading "JSON:" or similar labels
    const trimmed = s.replace(/^\s*JSON\s*:\s*/i, "").trim();
    return JSON.parse(trimmed);
  };

  // 1) look for fenced blocks (```json or ```)
  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const fencedMatches = [...rawText.matchAll(fencedRegex)];
  if (fencedMatches.length > 0) {
    // try from last to first
    for (let i = fencedMatches.length - 1; i >= 0; i--) {
      const block = fencedMatches[i][1].trim();
      try {
        jsonData = tryParse(block);
        cleanedText = rawText.replace(fencedMatches[i][0], "").trim();
        break;
      } catch (e) {
        console.log(e);
      }
    }
  }

  // 2) fallback: find balanced {...} or [...] blocks anywhere (scan + stack), try parse from last candidate
  if (jsonData === null) {
    const text = rawText;
    const candidates: { start: number; end: number }[] = [];

    const isEscaped = (str: string, idx: number) => {
      let backslashes = 0;
      for (let k = idx - 1; k >= 0 && str[k] === "\\"; k--) backslashes++;
      return backslashes % 2 === 1;
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch !== "{" && ch !== "[") continue;
      const stack: string[] = [ch];
      let inString = false;
      for (let j = i + 1; j < text.length; j++) {
        const c = text[j];
        if (c === '"' && !isEscaped(text, j)) {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (c === "{" || c === "[") stack.push(c);
        else if (c === "}" || c === "]") {
          const last = stack.pop();
          if (!last) break;
          if ((last === "{" && c !== "}") || (last === "[" && c !== "]")) break;
          if (stack.length === 0) {
            candidates.push({ start: i, end: j + 1 });
            break;
          }
        }
      }
    }

    // try parse candidates from last -> first
    for (let k = candidates.length - 1; k >= 0; k--) {
      const { start, end } = candidates[k];
      const candidateStr = text.slice(start, end).trim();
      try {
        jsonData = tryParse(candidateStr);
        cleanedText = (text.slice(0, start) + text.slice(end)).trim();
        break;
      } catch (e) {
        // continue to earlier candidates
        console.log(e);
      }
    }
  }

  // jsonData may still be null if nothing parseable found
  return { text: cleanedText, jsonData };
  // ...existing code...
}
