import Groq from 'groq-sdk';
import { config } from 'dotenv';
config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
async function test() {
  console.log("Testing Groq LLM...");
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'llama-3.3-70b-versatile',
    });
    console.log("LLM success:", chatCompletion.choices[0].message.content);
  } catch (err) {
    console.error("LLM Error:", err.message);
  }
}
test();
