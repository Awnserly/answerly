import { useState, useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`
    query {
      products(first: 50) {
        nodes {
          id
          title
          description
          metafield(namespace: "answerly", key: "faqs") {
            value
          }
        }
      }
      shop {
        id
        url
      }
    }
  `);
  const data = await response.json();
  return {
    products: data.data.products.nodes,
    shopUrl: data.data.shop.url,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const productId = form.get("productId");

  if (intent === "save-edits") {
    const faqs = JSON.parse(form.get("faqs"));
    await admin.graphql(`
      mutation {
        metafieldsSet(metafields: [{
          ownerId: "${productId}",
          namespace: "answerly",
          key: "faqs",
          value: ${JSON.stringify(JSON.stringify(faqs))},
          type: "json"
        }]) {
          metafields { id }
          userErrors { field message }
        }
      }
    `);
    return { saved: true, faqs };
  }

  if (intent === "bulk-generate") {
    const products = JSON.parse(form.get("products"));
    const count = form.get("count") || 5;
    const tone = form.get("tone") || "professional";
    const language = form.get("language") || "English";
    const apiKey = process.env.GROQ_API_KEY;
    let successCount = 0;

    for (const product of products) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{
              role: "user",
              content: `Generate ${count} frequently asked questions and answers for a product called "${product.title}". Use a ${tone} tone. Write in ${language}.
Description: ${product.description || "No description available"}.
Return ONLY a valid JSON array, no other text, like this:
[{"q":"Question here?","a":"Answer here."}]`,
            }],
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.choices) continue;
        const faqs = JSON.parse(data.choices[0].message.content);
        await admin.graphql(`
          mutation {
            metafieldsSet(metafields: [{
              ownerId: "${product.id}",
              namespace: "answerly",
              key: "faqs",
              value: ${JSON.stringify(JSON.stringify(faqs))},
              type: "json"
            }]) {
              metafields { id }
              userErrors { field message }
            }
          }
        `);
        successCount++;
      } catch (e) {
        continue;
      }
    }
    return { bulkDone: true, successCount };
  }

  const description = form.get("description");
  const title = form.get("title");
  const count = form.get("count") || 5;
  const tone = form.get("tone") || "professional";
  const language = form.get("language") || "English";
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) return { error: "No Groq API key found", faqs: [] };

  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{
          role: "user",
          content: `Generate ${count} frequently asked questions and answers for a product called "${title}". Use a ${tone} tone. Write in ${language}.
Description: ${description || "No description available"}.
Return ONLY a valid JSON array, no other text, like this:
[{"q":"Question here?","a":"Answer here."}]`,
        }],
      }),
    });
  } catch (err) {
    return { error: "Network error: " + err.message, faqs: [] };
  }

  const data = await res.json();
  if (!res.ok || !data.choices) return { error: "Groq error: " + JSON.stringify(data), faqs: [] };

  let faqs;
  try {
    faqs = JSON.parse(data.choices[0].message.content);
  } catch (err) {
    return { error: "Could not parse: " + data.choices[0].message.content, faqs: [] };
  }

  await admin.graphql(`
    mutation {
      metafieldsSet(metafields: [{
        ownerId: "${productId}",
        namespace: "answerly",
        key: "faqs",
        value: ${JSON.stringify(JSON.stringify(faqs))},
        type: "json"
      }]) {
        metafields { id }
        userErrors { field message }
      }
    }
  `);

  return { faqs, saved: true };
};

export default function Index() {
  const { products, shopUrl } = useLoaderData();
  const fetcher = useFetcher();
  const [selected, setSelected] = useState(null);
  const [count, setCount] = useState(5);
  const [tone, setTone] = useState("professional");
  const [language, setLanguage] = useState("English");
  const [editableFaqs, setEditableFaqs] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const freshFaqs = fetcher.data?.faqs;
  const error = fetcher.data?.error;
  const saved = fetcher.data?.saved;
  const bulkDone = fetcher.data?.bulkDone;
  const successCount = fetcher.data?.successCount;
  const isLoading = fetcher.state === "submitting";
  const ACCENT = "#6366f1";
  const themeEditorUrl = `${shopUrl}/admin/themes/current/editor`;

  useEffect(() => {
    if (freshFaqs) {
      setEditableFaqs(freshFaqs);
      setEditMode(false);
    }
  }, [freshFaqs]);

  useEffect(() => {
    if (selected) {
      try {
        const mf = products.find(p => p.id === selected.id)?.metafield?.value;
        setEditableFaqs(mf ? JSON.parse(mf) : null);
        setEditMode(false);
      } catch { setEditableFaqs(null); }
    }
  }, [selected]);

  const updateFaq = (i, field, value) =>
    setEditableFaqs(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: value } : f));

  const deleteFaq = (i) =>
    setEditableFaqs(prev => prev.filter((_, idx) => idx !== i));

  const addFaq = () =>
    setEditableFaqs(prev => [...(prev || []), { q: "New question?", a: "New answer." }]);

  const card = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: "1.5rem", marginBottom: "1rem" };
  const stepBadge = { background: ACCENT, color: "#fff", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700, flexShrink: 0 };
  const stepHeader = { display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem" };
  const stepTitle = { margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111" };
  const selectStyle = { width: "100%", padding: "0.65rem", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: "0.9rem", background: "#f9fafb", cursor: "pointer" };

  return (
    <div style={{ maxWidth: 740, margin: "0 auto", padding: "2rem 1rem", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2rem" }}>
        <img src="/logo.png" alt="Answerly" style={{ height: 56, width: "auto" }} />
        <button
          onClick={() => window.open(themeEditorUrl, "_blank")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "#444" }}
        >
          🎨 Theme Editor
        </button>
      </div>

      {/* Step 1 — Product */}
      <div style={card}>
        <div style={stepHeader}>
          <div style={stepBadge}>1</div>
          <h2 style={stepTitle}>Select a product</h2>
        </div>
        <select
          onChange={(e) => {
            const product = products.find((p) => p.id === e.target.value);
            setSelected(product || null);
          }}
          style={{ width: "100%", padding: "0.75rem 1rem", fontSize: "0.95rem", border: "1.5px solid #e5e7eb", borderRadius: 10, background: "#f9fafb", color: "#111", outline: "none", cursor: "pointer" }}
        >
          <option value="">— Choose a product —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} {p.metafield ? "✅" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Step 2 — Settings */}
      <div style={card}>
        <div style={stepHeader}>
          <div style={stepBadge}>2</div>
          <h2 style={stepTitle}>Settings</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#555", marginBottom: 6 }}>Number of FAQs</label>
            <select value={count} onChange={e => setCount(e.target.value)} style={selectStyle}>
              {[3,4,5,6,7,8,10].map(n => (
                <option key={n} value={n}>{n} FAQs</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#555", marginBottom: 6 }}>Tone</label>
            <select value={tone} onChange={e => setTone(e.target.value)} style={selectStyle}>
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="casual">Casual</option>
              <option value="funny">Funny</option>
              <option value="formal">Formal</option>
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#555", marginBottom: 6 }}>Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)} style={selectStyle}>
              <option value="English">🇬🇧 English</option>
              <option value="French">🇫🇷 French</option>
              <option value="Spanish">🇪🇸 Spanish</option>
              <option value="German">🇩🇪 German</option>
              <option value="Italian">🇮🇹 Italian</option>
              <option value="Portuguese">🇵🇹 Portuguese</option>
              <option value="Dutch">🇳🇱 Dutch</option>
              <option value="Japanese">🇯🇵 Japanese</option>
              <option value="Chinese">🇨🇳 Chinese</option>
              <option value="Arabic">🇸🇦 Arabic</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#555", marginBottom: 6 }}>Color & Icon</label>
            <button
              onClick={() => window.open(themeEditorUrl, "_blank")}
              style={{ width: "100%", padding: "0.65rem", background: "#f9fafb", border: "1.5px dashed #d1d5db", borderRadius: 8, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "#555" }}
            >
              🎨 Edit in Theme Editor →
            </button>
          </div>
        </div>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.78rem", color: "#aaa" }}>
          💡 Color and icon are controlled in the Theme Editor so they stay perfectly in sync with your storefront.
        </p>
      </div>

      {/* Generate Button */}
      {selected && (
        <fetcher.Form method="post" style={{ marginBottom: "0.75rem" }}>
          <input type="hidden" name="intent" value="generate" />
          <input type="hidden" name="description" value={selected.description || ""} />
          <input type="hidden" name="title" value={selected.title || ""} />
          <input type="hidden" name="productId" value={selected.id} />
          <input type="hidden" name="count" value={count} />
          <input type="hidden" name="tone" value={tone} />
          <input type="hidden" name="language" value={language} />
          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: "100%",
              padding: "1rem",
              background: isLoading ? "#a5b4fc" : "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: 14,
              fontSize: "1rem",
              fontWeight: 700,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "✨ Generating..." : `✨ Generate & Save ${count} FAQs`}
          </button>
        </fetcher.Form>
      )}

      {/* Bulk Generate Button */}
      <fetcher.Form method="post" style={{ marginBottom: "1rem" }}>
        <input type="hidden" name="intent" value="bulk-generate" />
        <input type="hidden" name="products" value={JSON.stringify(products.map(p => ({ id: p.id, title: p.title, description: p.description })))} />
        <input type="hidden" name="count" value={count} />
        <input type="hidden" name="tone" value={tone} />
        <input type="hidden" name="language" value={language} />
        <button
          type="submit"
          disabled={isLoading}
          style={{
            width: "100%",
            padding: "1rem",
            background: isLoading ? "#d1d5db" : "#111",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            fontSize: "1rem",
            fontWeight: 700,
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "⚡ Generating all products..." : `⚡ Bulk Generate FAQs for ALL ${products.length} Products`}
        </button>
      </fetcher.Form>

      {/* Alerts */}
      {saved && !bulkDone && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#16a34a", fontWeight: 600, fontSize: "0.9rem" }}>
          ✅ FAQs saved successfully!
        </div>
      )}
      {bulkDone && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#16a34a", fontWeight: 600, fontSize: "0.9rem" }}>
          ⚡ Bulk generation complete! FAQs generated for {successCount} products.
        </div>
      )}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#dc2626", fontSize: "0.9rem" }}>
          ❌ {error}
        </div>
      )}

      {/* Step 3 — Edit / Preview FAQs */}
      {editableFaqs && editableFaqs.length > 0 && selected && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <div style={stepHeader}>
              <div style={stepBadge}>3</div>
              <h2 style={stepTitle}>{editMode ? "Edit FAQs" : "Preview FAQs"}</h2>
            </div>
            <button
              onClick={() => setEditMode(!editMode)}
              style={{ padding: "0.4rem 1rem", background: editMode ? "#f3f4f6" : ACCENT, color: editMode ? "#111" : "#fff", border: "none", borderRadius: 8, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}
            >
              {editMode ? "👁 Preview" : "✏️ Edit"}
            </button>
          </div>

          {editableFaqs.map((faq, i) => (
            <div key={i} style={{ border: "1.5px solid #e0e7ff", borderRadius: 10, marginBottom: "0.6rem", overflow: "hidden" }}>
              {editMode ? (
                <div style={{ padding: "0.75rem", background: "#fafafa" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <input
                        value={faq.q}
                        onChange={e => updateFaq(i, "q", e.target.value)}
                        placeholder="Question"
                        style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: "0.9rem", fontWeight: 600, marginBottom: 6, boxSizing: "border-box", outline: "none" }}
                      />
                      <textarea
                        value={faq.a}
                        onChange={e => updateFaq(i, "a", e.target.value)}
                        placeholder="Answer"
                        rows={2}
                        style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: "0.85rem", resize: "vertical", boxSizing: "border-box", outline: "none" }}
                      />
                    </div>
                    <button
                      onClick={() => deleteFaq(i)}
                      style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 8, padding: "0.5rem 0.65rem", cursor: "pointer", fontSize: "1rem", flexShrink: 0 }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ padding: "0.9rem 1rem", background: "#fafafa", fontWeight: 600, fontSize: "0.95rem", color: "#111" }}>
                    {faq.q}
                  </div>
                  <div style={{ padding: "0.75rem 1rem", color: "#555", fontSize: "0.9rem", lineHeight: 1.6 }}>
                    {faq.a}
                  </div>
                </div>
              )}
            </div>
          ))}

          {editMode && (
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
              <button
                onClick={addFaq}
                style={{ flex: 1, padding: "0.65rem", background: "#f9fafb", border: "1.5px dashed #d1d5db", borderRadius: 10, fontSize: "0.9rem", cursor: "pointer", fontWeight: 600, color: "#555" }}
              >
                + Add FAQ
              </button>
              <fetcher.Form method="post" style={{ flex: 1 }}>
                <input type="hidden" name="intent" value="save-edits" />
                <input type="hidden" name="productId" value={selected.id} />
                <input type="hidden" name="faqs" value={JSON.stringify(editableFaqs)} />
                <button
                  type="submit"
                  style={{ width: "100%", padding: "0.65rem", background: ACCENT, color: "#fff", border: "none", borderRadius: 10, fontSize: "0.9rem", cursor: "pointer", fontWeight: 700 }}
                >
                  💾 Save Changes
                </button>
              </fetcher.Form>
            </div>
          )}
        </div>
      )}

      {/* Review Section */}
      <div style={{ background: "#eef2ff", border: "1px solid #e0e7ff", borderRadius: 16, padding: "1.75rem", textAlign: "center" }}>
        <div style={{ fontSize: "2.2rem", marginBottom: "0.4rem" }}>⭐</div>
        <h3 style={{ margin: "0 0 0.4rem", fontSize: "1.05rem", fontWeight: 700, color: "#111" }}>Enjoying Answerly?</h3>
        <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "#777" }}>Help other merchants discover the app by leaving a review!</p>
        <button
          onClick={() => window.open("https://apps.shopify.com", "_blank")}
          style={{ padding: "0.7rem 1.6rem", background: ACCENT, color: "#fff", borderRadius: 10, fontSize: "0.9rem", fontWeight: 700, border: "none", cursor: "pointer" }}
        >
          ⭐ Leave a Review
        </button>
      </div>

    </div>
  );
}