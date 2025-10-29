import { useEffect, useRef, useState } from "react";
import { askJourneyBot } from "../../services/gemini";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { MapPoint } from "../Map/MapView";

type Msg = { role: "user" | "assistant"; content: string };

interface ChatBoxProps {
  mapData: MapPoint[];
  setMapData: React.Dispatch<React.SetStateAction<MapPoint[]>>;
}

const ChatBox: React.FC<ChatBoxProps> = ({ setMapData }) => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Msg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const { text: reply, jsonData } = await askJourneyBot(text);

      console.log("AI raw jsonData:", jsonData);

      const assistantMsg: Msg = { role: "assistant", content: reply };
      setMessages((prev) => [...prev, assistantMsg]);

      if (jsonData) {
        const points: MapPoint[] = [];

        const toNumber = (v: unknown): number => {
          if (v === null || v === undefined) return 0;
          if (typeof v === "number") return v;
          let s = String(v).trim();
          if (s.indexOf(".") >= 0 && s.indexOf(",") >= 0) s = s.replace(/,/g, "");
          else s = s.replace(/,/g, ".");
          s = s.replace(/[^0-9.-]+/g, "");
          const n = parseFloat(s);
          return isFinite(n) ? n : 0;
        };

        const extractSource = (d: unknown): string | undefined => {
          if (!d || typeof d !== "object") return undefined;
          const od = d as Record<string, unknown>;
          const s = od["source"] ?? od["sourceUrl"] ?? od["url"] ?? od["wiki"];
          return typeof s === "string" ? s : undefined;
        };

        // Handle itinerary (array of day objects) or array of place objects or single place object
        if (Array.isArray(jsonData)) {
          const arr = jsonData as unknown[];
          const first = arr[0];
          if (first && typeof first === "object" && "day" in (first as Record<string, unknown>)) {
            // itinerary form
            for (const dayObj of arr) {
              if (!dayObj || typeof dayObj !== "object") continue;
              const dobj = dayObj as Record<string, unknown>;
              const dayNum = Number(dobj["day"] ?? 0);
              const dests = dobj["destinations"];
              if (!Array.isArray(dests)) continue;
              for (const d of dests) {
                if (!d || typeof d !== "object") continue;
                const od = d as Record<string, unknown>;
                points.push({
                  day: Number(dayNum ?? 0),
                  name: String(od["name"] ?? ""),
                  lat: toNumber(od["lat"] ?? od["latitude"] ?? 0),
                  lng: toNumber(od["lng"] ?? od["longitude"] ?? 0),
                  desc: String(od["desc"] ?? od["description"] ?? ""),
                  source: extractSource(od),
                });
              }
            }
          } else {
            // array of place objects
            for (const item of arr) {
              if (!item || typeof item !== "object") continue;
              const oi = item as Record<string, unknown>;
              points.push({
                day: 1,
                name: String(oi["name"] ?? ""),
                lat: toNumber(oi["lat"] ?? oi["latitude"] ?? 0),
                lng: toNumber(oi["lng"] ?? oi["longitude"] ?? 0),
                desc: String(oi["desc"] ?? oi["description"] ?? ""),
                source: extractSource(oi),
              });
            }
          }
        } else if (jsonData && typeof jsonData === "object") {
          const oj = jsonData as Record<string, unknown>;
          points.push({
            day: 1,
            name: String(oj["name"] ?? ""),
            lat: toNumber(oj["lat"] ?? oj["latitude"] ?? 0),
            lng: toNumber(oj["lng"] ?? oj["longitude"] ?? 0),
            desc: String(oj["desc"] ?? oj["description"] ?? ""),
            source: extractSource(oj),
          });
        }

        if (points.length) {
          setMapData(points);
          console.log("Normalized mapData:", points);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err ?? "Lỗi khi gọi AI");
      setError(msg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Lỗi: ${msg}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white shadow-lg rounded-xl">
      <div className="p-4 font-bold border-b">Vietnam Journey Bot</div>

      <div ref={listRef} className="flex-1 p-4 overflow-y-auto space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] p-3 rounded-lg w-fit ${
              msg.role === "user"
                ? "bg-blue-100 self-end ml-auto text-right"
                : "bg-gray-100 self-start text-left"
            }`}
          >
            {msg.role === "assistant" ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
              >
                {msg.content}
              </ReactMarkdown>
            ) : (
              <div className="w-fit">{msg.content}</div>
            )}
          </div>
        ))}

        {loading && (
          <div className="p-3 rounded-lg bg-gray-100 w-fit">
            Đang trả lời...
          </div>
        )}

        {error && <div className="text-red-500 text-sm">Lỗi: {error}</div>}
      </div>

      <div className="flex p-3 border-t">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 border rounded-lg px-3 py-2"
          placeholder="Hỏi về hành trình du lịch..."
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="ml-2 bg-blue-500 text-white px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Gửi
        </button>
      </div>

      {/* 👇 Tạm hiển thị dữ liệu bản đồ để debug */}
      {/* {mapData.length > 0 && (
        <div className="p-4 text-sm border-t bg-gray-50 max-h-40 overflow-y-auto">
          <strong>Dữ liệu bản đồ:</strong>
          <pre className="text-xs whitespace-pre-wrap">
            {JSON.stringify(mapData, null, 2)}
          </pre>
        </div>
      )} */}
    </div>
  );
};

export default ChatBox;
