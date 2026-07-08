// /api/news.js
// Vercel Serverless Function
// 這支程式在「後端」執行，前端呼叫它，金鑰藏在環境變數裡，前端永遠看不到。

export default async function handler(req, res) {
  // 只允許 GET / POST
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY; // ← 金鑰從環境變數讀，不寫在程式裡
  if (!apiKey) {
    return res.status(500).json({ error: "伺服器未設定 API 金鑰" });
  }

  // 給 Claude 的指令：抓最新台灣新聞、查證、分類、回傳純 JSON
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `今天是 ${today}。請用 web search 查詢「最近一週台灣的重大新聞」，
挑出 6 到 10 則經過多家媒體查證的真實事件（排除未經證實的傳聞、預言、農場文）。

每則事件請歸類到以下其中一個分類：
民生/公安、天災、國防/兩岸、政治/司法、經濟/產業、食安/衛生、體育/文化

只回傳一個 JSON 陣列，不要有任何其他文字、不要 markdown 的 \`\`\` 標記。格式如下：
[
  {"date":"2026-07-08","cat":"經濟/產業","title":"標題","desc":"兩三句中立摘要"},
  ...
]`;

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
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    const data = await r.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message || "API 錯誤" });
    }

    // 把所有 text 區塊拼起來
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // 去掉可能的 ```json 圍欄後解析
    const clean = text.replace(/```json|```/g, "").trim();
    let items;
    try {
      items = JSON.parse(clean);
    } catch (e) {
      // 萬一 Claude 回了多餘文字，試著只抓中括號那段
      const m = clean.match(/\[[\s\S]*\]/);
      items = m ? JSON.parse(m[0]) : [];
    }

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
