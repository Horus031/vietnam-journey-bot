import { useEffect, useRef, useState } from "react";
import { askJourneyBot } from "../../services/gemini";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { MapPoint } from "../Map/MapView";
import { MapPin, SendHorizonal } from "lucide-react";

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
          if (s.indexOf(".") >= 0 && s.indexOf(",") >= 0)
            s = s.replace(/,/g, "");
          else s = s.replace(/,/g, ".");
          s = s.replace(/[^0-9.-]+/g, "");
          const n = parseFloat(s);
          return isFinite(n) ? n : 0;
        };

        const extractBudgetRaw = (
          obj: Record<string, unknown> | null | undefined
        ): MapPoint["budget"] | undefined => {
          if (!obj) return undefined;
          const candidates = [
            obj["budget"],
            obj["cost"],
            obj["estimatedBudget"],
            obj["dayBudget"],
            obj["price"],
          ];
          for (const c of candidates) {
            if (c !== null && c !== undefined) return c as MapPoint["budget"];
          }
          return undefined;
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
          if (
            first &&
            typeof first === "object" &&
            "day" in (first as Record<string, unknown>)
          ) {
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
                const budgetVal =
                  extractBudgetRaw(od) ?? extractBudgetRaw(dobj);
                points.push({
                  day: Number(dayNum ?? 0),
                  name: String(od["name"] ?? ""),
                  lat: toNumber(od["lat"] ?? od["latitude"] ?? 0),
                  lng: toNumber(od["lng"] ?? od["longitude"] ?? 0),
                  desc: String(od["desc"] ?? od["description"] ?? ""),
                  source: extractSource(od),
                  budget: budgetVal as MapPoint["budget"],
                });
              }
            }
          } else {
            // array of place objects
            for (const item of arr) {
              if (!item || typeof item !== "object") continue;
              const oi = item as Record<string, unknown>;
              const budgetVal = extractBudgetRaw(oi);
              points.push({
                day: 1,
                name: String(oi["name"] ?? ""),
                lat: toNumber(oi["lat"] ?? oi["latitude"] ?? 0),
                lng: toNumber(oi["lng"] ?? oi["longitude"] ?? 0),
                desc: String(oi["desc"] ?? oi["description"] ?? ""),
                source: extractSource(oi),
                budget: budgetVal as MapPoint["budget"],
              });
            }
          }
        } else if (jsonData && typeof jsonData === "object") {
          const oj = jsonData as Record<string, unknown>;
          const budgetVal = extractBudgetRaw(oj);
          points.push({
            day: 1,
            name: String(oj["name"] ?? ""),
            lat: toNumber(oj["lat"] ?? oj["latitude"] ?? 0),
            lng: toNumber(oj["lng"] ?? oj["longitude"] ?? 0),
            desc: String(oj["desc"] ?? oj["description"] ?? ""),
            source: extractSource(oj),
            budget: budgetVal as MapPoint["budget"],
          });
        }

        if (points.length) {
          setMapData(points);
          console.log("Normalized mapData:", points);
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "Lỗi khi gọi AI");
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
    <div className="flex flex-col h-full bg-[#eee3d7] shadow-lg rounded-xl font-public-sans">
      {/* Custom scrollbar styles scoped to this component for a smoother, themed scroll */}
      <style>{`
        .chat-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(0,77,0,0.7) rgba(0,0,0,0.03);
          scroll-behavior: smooth;
        }
        .chat-scrollbar::-webkit-scrollbar { width: 10px; }
        .chat-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.03); border-radius: 10px; }
        .chat-scrollbar::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(0,77,0,0.95), rgba(0,77,0,0.6)); border-radius: 10px; border: 2px solid rgba(255,255,255,0.6); }
        .chat-message-smooth { transition: transform 120ms ease, box-shadow 120ms ease; }
        .chat-message-smooth:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.06); }
      `}</style>
      <div className="p-4 flex items-center gap-2 font-bold text-[#110a03] z-3 text-3xl border-b border-[#e5cbaf] rounded-tr-lg bg-linear-to-r ">
        <MapPin className="bg-[#004d00] p-2 rounded-md" color="white" size={36} />
        Vietnam Journey Bot
      </div>

      <div
        ref={listRef}
        className="flex-1 p-4 overflow-y-scroll space-y-3 my-1 chat-scrollbar pr-2"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] p-3 rounded-lg w-fit chat-message-smooth ${
              msg.role === "user"
                ? "bg-[#004d00] text-white  self-end ml-auto text-right"
                : "bg-[#eee3d7] text-[#110a03] border border-[#e5cbaf] self-start text-left"
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
          <div className="p-3 rounded-lg bg-[#eee3d7] w-fit">
            Đang trả lời...
          </div>
        )}

        {error && <div className="text-red-500 text-sm">Lỗi: {error}</div>}
      </div>

      <div className="flex p-3 border-t border-[#e5cbaf]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 border border-[#e5cbaf] rounded-full px-3 py-2  focus:outline-0 h-12"
          placeholder="Hỏi về hành trình du lịch..."
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="ml-2 bg-[#004d00] hover:bg-[#004d00]/80 text-white px-3 rounded-full disabled:opacity-50 cursor-pointer active:scale-95"
        >
          <SendHorizonal color="white" />
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
