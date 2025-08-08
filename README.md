# Truck Route Optimizer (React + Vite)

Single‑page web app for optimizing pickup routes from multiple raw-material spots to a single factory (depot).
Uses Clarke–Wright savings + 2‑opt. Map via Leaflet.

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel (works from iPad via browser)
1) Create a **GitHub** repo (github.com → New → upload files). On iPad you can upload this whole folder as a ZIP then press **Add file → Upload files** and drag the contents in, or upload the zip and use GitHub's web unzip (alternatively use a computer).
2) Go to **vercel.com → New Project → Import Git Repository**. Authorize GitHub if prompted.
3) Choose the repo, keep defaults:     - Framework Preset: **Vite**     - Build Command: `npm run build`     - Output Directory: `dist`
4) Click **Deploy**. Wait ~1–2 minutes. You’ll get a URL like `https://<your-app>.vercel.app`.

### CSV formats
- **Stops export**: `ID,Name,Lat,Lng,Demand`

- **Plan export**: `Truck,Load,Distance_km,Sequence`

### Self-tests
Toggle **Dev: Self-tests** in the sidebar and click **Run tests** to verify CSV and capacity logic.
