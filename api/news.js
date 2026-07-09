// /api/news.js
// Vercel Serverless Function
// 後端執行，前端呼叫它，金鑰藏在環境變數，前端看不到。

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "伺服器未設定 API 金鑰" });
  }

  // 前端會傳來：目前網站最新日期、以及現有標題清單
  let latestDate = "";
  let existingTitles = [];
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (body) {
      latestDate = body.latestDate || "";
      existingTitles = Array.isArray(body.titles) ? body.titles : [];
    }
  } catch (e) {}

  const today = new Date().toISOString().slice(0, 10);

  // 依有無現有資料，組不同的指令
  const dateRule = latestDate
    ? `網站目前最新一則新聞的日期是 ${latestDate}。請「只」挑選發生日期在 ${latestDate} 之後（更新）的事件，不要回傳這個日期之前的舊聞。`
    : `請挑選最近一週內發生的事件。`;

  const avoidRule = existingTitles.length
    ? `以下事件網站上已經有了，請完全避開、不要重複（就算換句話說也不要）：\n${existingTitles.map((t) => "・" + t).join("\n")}`
    : "";

  const prompt = `今天是 ${today}。請用 web search 查詢台灣的重大新聞。
${dateRule}
挑出經過多家媒體查證的真實事件（排除未經證實的傳聞、預言、農場文），最多 8 則。

${avoidRule}

每則事件請歸類到以下其中一個分類：
民生/公安、天災、國防/兩岸、政治/司法、經濟/產業、食安/衛生、體育/文化

極重要：完成搜尋後，你的「最後一段輸出」必須是一個 JSON 陣列，陣列本身不要包在程式碼區塊裡、前後不要加任何說明文字。若查不到符合條件的新事件，就回傳空陣列 []。格式範例：
[{"date":"${today}","cat":"經濟/產業","title":"標題","desc":"兩三句中立摘要"}]`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    const data = await r.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message || "API 錯誤" });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let items = extractJsonArray(text);

    if (!items) {
      return res.status(200).json({ items: [], debug: text.slice(0, 300) });
    }

    // 後端再做一層保險去重：標題正規化後比對
    const norm = (s) => (s || "").replace(/[\s「」『』（）()、，,。.\-—]/g, "");
    const existSet = new Set(existingTitles.map(norm));
    items = items.filter((it) => it && it.title && !existSet.has(norm(it.title)));

    // 若前端有給最新日期，過濾掉不比它新的
    if (latestDate) {
      items = items.filter((it) => it.date && it.date > latestDate);
    }

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}

// 從一段可能夾雜文字的字串裡，穩健地抽出 JSON 陣列
function extractJsonArray(text) {
  if (!text) return null;

  let t = text.replace(/```json/gi, "```").replace(/```/g, "");

  try {
    const parsed = JSON.parse(t.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}

  const matches = [...t.matchAll(/\[[\s\S]*?\]/g)].map((m) => m[0]);
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(matches[i]);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }

  const first = t.indexOf("[");
  const last = t.lastIndexOf("]");
  if (first !== -1 && last > first) {
    try {
      const parsed = JSON.parse(t.slice(first, last + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }

  return null;
}
