import Groq from 'groq-sdk';
import { config } from 'dotenv';
config();

const keys = [
  { name: 'GROQ_API_KEY', value: process.env.GROQ_API_KEY },
  { name: 'GROQ_API_KEY_AMAN', value: process.env.GROQ_API_KEY_AMAN },
  { name: 'GROQ_API_KEY_SHIVAM', value: process.env.GROQ_API_KEY_SHIVAM },
  { name: 'GROQ_API_KEY_ABHISHEK', value: process.env.GROQ_API_KEY_ABHISHEK },
  { name: 'GROQ_API_KEY_RAHUL', value: process.env.GROQ_API_KEY_RAHUL },
  { name: 'GROQ_API_KEY_PRIYA', value: process.env.GROQ_API_KEY_PRIYA },
  { name: 'GROQ_API_KEY_SIMRAN', value: process.env.GROQ_API_KEY_SIMRAN },
  { name: 'GROQ_API_KEY_NEHA', value: process.env.GROQ_API_KEY_NEHA },
  { name: 'GROQ_API_KEY_ANANYA', value: process.env.GROQ_API_KEY_ANANYA },
  { name: 'GROQ_API_KEY_DIVYA', value: process.env.GROQ_API_KEY_DIVYA },
];

async function check() {
  for (const k of keys) {
    if (!k.value) {
      console.log(`${k.name}: Not set`);
      continue;
    }
    const groq = new Groq({ apiKey: k.value.trim() });
    try {
      const res = await groq.chat.completions.create({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'llama-3.1-8b-instant',
      });
      console.log(`${k.name}: VALID (${res.choices[0].message.content.trim().slice(0, 20)})`);
    } catch (err) {
      console.log(`${k.name}: INVALID/ERROR: status=${err.status} message=${err.message}`);
    }
  }
}
check();
