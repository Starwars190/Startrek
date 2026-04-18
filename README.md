# 🚀 FinSight AI — Phase 1 Trial Deployment

Built by **Pallav Shah** · Powered by Claude

A complete React app ready to deploy in 3 different ways. Pick the easiest one for you.

---

## 📦 What's Inside

```
finsight-deploy/
├── src/
│   ├── App.jsx          ← The full FinSight AI app
│   └── main.jsx         ← React entry point
├── index.html           ← HTML wrapper
├── package.json         ← Dependencies
├── vite.config.js       ← Build config
├── .env.example         ← API key template
└── README.md            ← This file
```

---

## 🔑 Step 0 — Get Your Anthropic API Key (5 min)

You need this regardless of which deployment path you pick.

1. Go to https://console.anthropic.com
2. Sign up (free)
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-api03-...`)
5. Go to **Plans & Billing** → add **$5** of credits
   - Each analysis uses about $0.02 of API credit
   - $5 = roughly 250 free analyses — plenty for testing

**⚠️ Keep this key private.** Don't commit it to GitHub or share in public posts.

---

## 🛤️ Pick Your Path

### 🟢 PATH A — StackBlitz (Recommended, 10 min)

**The easiest way for a non-technical person. Runs in your browser, no installs.**

1. Go to https://stackblitz.com/
2. Click **Create** → **Vite + React**
3. Delete all files in the left sidebar
4. Drag & drop every file from this `finsight-deploy` folder
5. In StackBlitz, click the key icon (🔑 or "Secrets") in the sidebar
6. Add a new secret:
   - Name: `VITE_ANTHROPIC_KEY`
   - Value: your API key from Step 0
7. The preview loads on the right → **it's live!**
8. Click **Connect to GitHub** to save it, then **Deploy** for a public URL

Final URL looks like: `https://finsight-ai.stackblitz.io`

---

### 🔵 PATH B — Vercel + GitHub (Most professional, 25 min)

**Best for when you're ready to connect your custom domain.**

#### First time setup
1. Install Node.js from https://nodejs.org (LTS version)
2. Sign up at https://github.com (free)
3. Install GitHub Desktop from https://desktop.github.com (no command line needed)

#### Deploy
1. Open GitHub Desktop → **File → New repository** → Name it `finsight-ai`
2. Copy all files from `finsight-deploy/` into that repo folder
3. In GitHub Desktop: **Commit** → **Publish repository** (make it private for now)

4. Go to https://vercel.com → sign up with GitHub
5. Click **Add New Project** → select your `finsight-ai` repo
6. Before clicking Deploy, scroll to **Environment Variables**
7. Add:
   - Name: `VITE_ANTHROPIC_KEY`
   - Value: your API key
8. Click **Deploy** → wait 60 seconds
9. Vercel gives you a URL like `finsight-ai.vercel.app` — **it's live!**

#### Connect your own domain
1. Buy `finsightai.com` on https://namecheap.com (~$12/year)
2. In Vercel: **Settings → Domains** → add `finsightai.com`
3. Follow Vercel's DNS instructions (5-min copy-paste)
4. Done — your site is at **finsightai.com** 🎉

---

### 🟠 PATH C — Local Only (For testing before sharing)

**Run it on your computer first, then deploy once you're happy.**

1. Install Node.js from https://nodejs.org
2. Open Terminal (Mac) or Command Prompt (Windows)
3. Navigate to the folder:
   ```bash
   cd path/to/finsight-deploy
   ```
4. Install everything:
   ```bash
   npm install
   ```
5. Copy the env file:
   ```bash
   cp .env.example .env
   ```
6. Open `.env` in any text editor and paste your API key
7. Start the app:
   ```bash
   npm run dev
   ```
8. Open http://localhost:5173 in your browser — **it's running!**

---

## 🧪 Testing Checklist

After deploying, test these scenarios:

- [ ] Landing page loads and shows the coral FinSight logo
- [ ] Click "Apple" chip → wait ~30 seconds → dashboard appears
- [ ] Try "Reliance Industries" → Indian company → ₹ symbol shows
- [ ] All 4 charts render correctly
- [ ] Click **🎙️ AI Podcast Script** → Alex & Priya conversation appears
- [ ] Click **📊 Generate PPT via Gamma** → Gamma opens in new tab with prompt pre-copied
- [ ] Click **← New search** → returns to landing

---

## 💰 Cost Tracking for Your Trial

| Item | Cost | Notes |
|------|------|-------|
| Anthropic API credits | $5 | ≈ 250 analyses |
| StackBlitz hosting | $0 | Free tier is fine |
| Vercel hosting | $0 | Free tier is fine |
| Domain (optional) | $12/year | Only if you go Path B |
| **TOTAL for trial** | **$5–17** | For your first 250 users |

---

## 📣 After Deployment — First 20 Users

1. **Post to LinkedIn** with this template:
   > "I built an AI that gives you a 5-year financial analysis of any company — complete with charts, a PowerPoint deck, and a podcast summary. Takes 60 seconds.
   >
   > Try it free: [your-url-here]
   >
   > Would love feedback from finance people / students / retail investors 🙏"

2. **Post in 3 WhatsApp groups** (family/friends/finance-interested people)

3. **Reddit:** Post in r/IndiaInvestments, r/investing, r/stocks
   - Title: "I built a free AI that does 5-year financial analysis on any company — feedback wanted"

4. **Track everything** — add Google Analytics or Plausible
5. **Message 20 users personally** — ask "what would make you pay for this?"

---

## 🆘 Troubleshooting

**"API key missing" shown in the header:**
- You forgot to set `VITE_ANTHROPIC_KEY` in your environment
- On StackBlitz: add it as a secret
- On Vercel: Settings → Environment Variables → redeploy
- Locally: check your `.env` file exists and has the key

**"Analysis failed" when clicking Analyze:**
- Your API key is invalid or has no credits
- Check https://console.anthropic.com → Billing → add credits

**Gamma doesn't open with the prompt pre-filled:**
- Your browser blocked the clipboard permission
- Just manually paste — the prompt was copied to your clipboard

**Chart shows weird numbers:**
- Web search data quality varies by company
- Stick to well-known large companies for testing
- Rare/private companies won't have public financial data

---

## 🎯 Next Steps (After Phase 1 Works)

Once you have 50–100 users and real feedback:
1. Move the API key server-side (real security)
2. Add user accounts (Clerk or Supabase)
3. Add payments (Razorpay for India, Stripe for global)
4. Launch on Product Hunt
5. Build the mobile apps

Come back to me with feedback and I'll help you build the next phase 🚀

---

**Built with ❤️ by Pallav Shah · Powered by Claude**
