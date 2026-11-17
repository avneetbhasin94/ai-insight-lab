# AI Insight Lab on your laptop

This runs the same project locally in Visual Studio Code. NBA is the first module. Provider data remains unavailable until you supply your own key; teaching fixtures stay clearly synthetic.

1. Install Git, Visual Studio Code and Node.js 22 or newer.
2. Clone the repository into Desktop/Personal Projects, or extract the source ZIP there. Open the folder containing package.json in VS Code.
3. Open Terminal > New Terminal and run npm ci.
4. Duplicate .env.example as .env.local using the VS Code Explorer. Keep the example unchanged.
5. From your BALLDONTLIE account, copy the key into the BALLDONTLIE_API_KEY value in .env.local. Save locally. Do not paste the value into chat or a tracked file.
6. Run git check-ignore .env.local. It should print .env.local. Run git status --short and confirm the secret file is not listed.
7. Run npm run dev:local. Open http://127.0.0.1:4173, select a date, and choose Load provider games.
8. Verify actual game records, source and fetch time. The free tier excludes injuries and player performance statistics; paid endpoints are not silently requested.
9. Stop with Ctrl+C.

Local mode passes only the provider key to backend code and listens on loopback. Model calls remain disabled. Managed preview (npm run dev) ignores all provider and model keys. The build never reads a local secret file; npm run build embeds only an explicit static-asset allowlist.

Before committing, inspect git status and staged file names. .env, .env.local and other .env.* files are ignored; .env.example is intentionally included with blank values. Never force-add a secret. If you previously committed a real key, rotate it even if you later delete the file. No ignore rule removes history.

Your laptop environment is separate from the private hosted website. Adding a key locally does not configure hosting. Keep the hosting secret setup as a separate step.

## Verification commands

Run npm test, npm run eval, npm run check and npm run build. Most checks use synthetic data or scripted service responses; passing them does not establish live-provider quality, trained prediction accuracy or calibrated probabilities.
