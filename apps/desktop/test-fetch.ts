
import { safeHttpFetch } from "./src/plugin-sdk-bridge";
async function test() {
  try {
    const res = await safeHttpFetch("http://127.0.0.1:8765", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "version", version: 6 })
    }, new Set(["127.0.0.1:8765"]), true);
    console.log("Success:", res);
  } catch(e) {
    console.error("Error:", e);
  }
}
test();

