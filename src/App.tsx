import React, { useMemo, useState } from \"react\";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from \"react-leaflet\";
import L from \"leaflet\";
import \"leaflet/dist/leaflet.css\";
import { Card, CardContent } from \"./components/ui/card\";
import { Button } from \"./components/ui/button\";
import { Input } from \"./components/ui/input\";
import { Textarea } from \"./components/ui/textarea\";
import { Slider } from \"./components/ui/slider\";
import { Switch } from \"./components/ui/switch\";
import { Download, Upload, RotateCcw, Map as MapIcon } from \"lucide-react\";
import { motion } from \"framer-motion\";

// --- Types ---
interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  demand: number; // quantity loaded at pickup
}

interface Depot {
  name: string;
  lat: number;
  lng: number;
}

interface RouteResult {
  route: Stop[]; // ordered customers (excluding depot)
  distanceKm: number;
  load: number;
}

// --- Utils: Geometry & Distance ---
const toRad = (deg: number) => (deg * Math.PI) / 180;
const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

// --- Clarke–Wright Savings Heuristic (CVRP) ---
function clarkeWright(
  depot: Depot,
  customers: Stop[],
  capacity: number
): RouteResult[] {
  if (customers.length === 0) return [];

  // Initialize: each customer is its own route (depot - i - depot)
  type R = { customers: Stop[]; load: number };
  const routes: R[] = customers.map((c) => ({ customers: [c], load: c.demand }));

  // Precompute distances
  const d0: Record<string, number> = {};
  const dij: Record<string, number> = {};
  const id = (i: string, j: string) => `${i}|${j}`;

  for (const c of customers) d0[c.id] = haversineKm(depot, c);
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i];
      const b = customers[j];
      dij[id(a.id, b.id)] = dij[id(b.id, a.id)] = haversineKm(a, b);
    }
  }

  // Compute savings S(i,j) = d0(i)+d0(j)-d(i,j)
  type Saving = { i: Stop; j: Stop; s: number };
  const savings: Saving[] = [];
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i];
      const b = customers[j];
      const s = d0[a.id] + d0[b.id] - dij[id(a.id, b.id)];
      savings.push({ i: a, j: b, s });
    }
  }
  savings.sort((a, b) => b.s - a.s);

  // Helper to find which route a stop is currently in and if at an end
  const findRouteAndPos = (stop: Stop): { rIdx: number; atStart: boolean | null } | null => {
    for (let rIdx = 0; rIdx < routes.length; rIdx++) {
      const r = routes[rIdx].customers;
      if (r.length === 0) continue;
      if (r[0].id === stop.id) return { rIdx, atStart: true };
      if (r[r.length - 1].id === stop.id) return { rIdx, atStart: false };
      // If inside (not an end), return null to disallow merge through interior
      if (r.some((s) => s.id === stop.id)) return { rIdx, atStart: null };
    }
    return null;
  };

  for (const { i, j } of savings) {
    const fi = findRouteAndPos(i);
    const fj = findRouteAndPos(j);
    if (!fi || !fj) continue;
    if (fi.rIdx === fj.rIdx) continue; // same route
    if (fi.atStart === null || fj.atStart === null) continue; // inside a route -> skip

    const ri = routes[fi.rIdx];
    const rj = routes[fj.rIdx];
    const newLoad = ri.load + rj.load;
    if (newLoad > capacity) continue;

    // To connect: we need i at an end of ri and j at an end of rj, then orient so i connects to j
    let left: Stop[] = ri.customers.slice();
    let right: Stop[] = rj.customers.slice();

    // Orient so that i is the tail of left and j is the head of right
    if (fi.atStart) left.reverse();
    if (!fj.atStart) right.reverse();

    // Merge
    const merged = left.concat(right);

    // Replace routes: put merged into ri, remove rj
    ri.customers = merged;
    ri.load = newLoad;
    routes.splice(fj.rIdx, 1);
  }

  // 2-opt improvement per route
  const twoOpt = (seq: Stop[]): Stop[] => {
    if (seq.length < 4) return seq;
    let improved = true;
    let best = seq.slice();
    const distWithDepot = (a: number, b: number) => {
      const node = (idx: number) => (idx === -1 ? depot : idx === best.length ? depot : best[idx]);
      const A = node(a);
      const B = node(a + 1);
      const C = node(b);
      const D = node(b + 1);
      return haversineKm(A, B) + haversineKm(C, D);
    };
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const before = distWithDepot(i - 1, i) + distWithDepot(k, k + 1);
          // Perform 2-opt swap between i..k
          const candidate = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          const node = (idx: number) => (idx === -1 ? depot : idx === candidate.length ? depot : candidate[idx]);
          const after = haversineKm(node(i - 1), node(i)) + haversineKm(node(k), node(k + 1));
          if (after + 1e-9 < before) {
            best = candidate;
            improved = true;
          }
        }
      }
    }
    return best;
  };

  const results: RouteResult[] = routes.map((r) => {
    const improved = twoOpt(r.customers);
    // Distance: depot -> ... -> depot
    let dist = 0;
    let prev: { lat: number; lng: number } = depot;
    for (const c of improved) {
      dist += haversineKm(prev, c);
      prev = c;
    }
    dist += haversineKm(prev, depot);
    return { route: improved, distanceKm: dist, load: r.load };
  });

  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}

// --- Map helpers ---
const factoryIcon = new L.DivIcon({
  className: \"\",
  html: '<div class=\"bg-white/90 border rounded-full p-1 shadow\">🏭</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const stopIcon = new L.DivIcon({
  className: \"\",
  html: '<div class=\"bg-white/90 border rounded-full p-1 shadow\">📦</div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function FitBounds({ depot, stops }: { depot: Depot; stops: Stop[] }) {
  const map = useMap();
  React.useEffect(() => {
    const points = [L.latLng(depot.lat, depot.lng), ...stops.map((s) => L.latLng(s.lat, s.lng))];
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.2));
    }
  }, [depot, stops, map]);
  return null;
}

// --- CSV helpers ---
type ColumnSpec<T> = { key: keyof T; title?: string };

function toCSV<T extends Record<string, any>>(rows: T[], columns?: ColumnSpec<T>[]) {
  const cols: ColumnSpec<T>[] = columns && columns.length
    ? columns
    : (Object.keys(rows[0] ?? {}) as (keyof T)[]).map((k) => ({ key: k }));

  const header = cols.map((c) => String(c.title ?? c.key)).join(",");
  const esc = (v: any) => `\"${String(v ?? \"\").replace(/\"/g, '\"\"')}\"`;
  const body = rows.map((r) => cols.map((c) => esc(r[c.key as string])).join(",")).join("\n");
  return [header, body].filter(Boolean).join("\n");
}

function download(filename: string, text: string) {
  const a = document.createElement(\"a\");
  a.href = URL.createObjectURL(new Blob([text], { type: \"text/plain\" }));
  a.download = filename;
  a.click();
}

// --- Demo data (Chiang Mai area, editable) ---
const demoDepot: Depot = { name: \"Factory\", lat: 18.7877, lng: 98.9931 };
const demoStops: Stop[] = [
  { id: \"A\", name: \"Raw Spot A\", lat: 18.807, lng: 98.97, demand: 2 },
  { id: \"B\", name: \"Raw Spot B\", lat: 18.76, lng: 98.98, demand: 3 },
  { id: \"C\", name: \"Raw Spot C\", lat: 18.73, lng: 99.02, demand: 1 },
  { id: \"D\", name: \"Raw Spot D\", lat: 18.82, lng: 99.04, demand: 4 },
  { id: \"E\", name: \"Raw Spot E\", lat: 18.80, lng: 98.95, demand: 2 },
];

// --- Main Component ---
export default function App() {
  const [depot, setDepot] = useState<Depot>(demoDepot);
  const [stops, setStops] = useState<Stop[]>(demoStops);
  const [capacity, setCapacity] = useState<number>(6);
  const [showLabels, setShowLabels] = useState<boolean>(true);

  const [testOutput, setTestOutput] = useState<string[]>([]);
  const [showTests, setShowTests] = useState<boolean>(false);

  const routes = useMemo(() => clarkeWright(depot, stops, capacity), [depot, stops, capacity]);
  const totalDistance = routes.reduce((s, r) => s + r.distanceKm, 0);
  const totalLoad = stops.reduce((s, r) => s + r.demand, 0);

  const addStop = () => {
    const id = String.fromCharCode(65 + stops.length);
    setStops((prev) => [
      ...prev,
      { id, name: `Raw Spot ${id}`, lat: depot.lat + (Math.random() - 0.5) * 0.2, lng: depot.lng + (Math.random() - 0.5) * 0.2, demand: 1 },
    ]);
  };

  const removeStop = (id: string) => setStops((prev) => prev.filter((s) => s.id !== id));

  const randomize = () => {
    setStops((_) =>
      Array.from({ length: 8 }, (_, i) => ({
        id: String.fromCharCode(65 + i),
        name: `Raw Spot ${String.fromCharCode(65 + i)}`,
        lat: depot.lat + (Math.random() - 0.5) * 0.6,
        lng: depot.lng + (Math.random() - 0.5) * 0.6,
        demand: 1 + Math.floor(Math.random() * 4),
      }))
    );
  };

  const exportCSV = () => {
    const cols: ColumnSpec<Stop>[] = [
      { key: \"id\", title: \"ID\" },
      { key: \"name\", title: \"Name\" },
      { key: \"lat\", title: \"Lat\" },
      { key: \"lng\", title: \"Lng\" },
      { key: \"demand\", title: \"Demand\" },
    ];
    const data = stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, demand: s.demand }));
    const csv = toCSV(data, cols);
    download(\"stops.csv\", csv);
  };

  const exportPlan = () => {
    const cols: ColumnSpec<{ truck: number; load: number; distance_km: string; sequence: string }>[] = [
      { key: \"truck\", title: \"Truck\" },
      { key: \"load\", title: \"Load\" },
      { key: \"distance_km\", title: \"Distance_km\" },
      { key: \"sequence\", title: \"Sequence\" },
    ];
    const rows = routes.map((r, idx) => ({
      truck: idx + 1,
      load: r.load,
      distance_km: r.distanceKm.toFixed(2),
      sequence: [\"DEPOT\", ...r.route.map((s) => s.id), \"DEPOT\"].join(\" -> \"),
    }));
    download(\"route_plan.csv\", toCSV(rows, cols));
  };

  const importCSV = (text: string) => {
    // Accepts CSV with headers: name,lat,lng,demand (id optional)
    const lines = text.split(/\r?\n/).filter(Boolean);
    const [header, ...rest] = lines;
    const cols = header.split(/,|\t/).map((h) => h.trim().toLowerCase());
    const idx = (k: string) => cols.findIndex((c) => c === k);
    const idIdx = idx(\"id\");
    const nameIdx = idx(\"name\");
    const latIdx = idx(\"lat\");
    const lngIdx = idx(\"lng\");
    const demIdx = idx(\"demand\");
    const parsed: Stop[] = rest.map((line, i) => {
      const parts = line.split(/,|\t/);
      const id = idIdx >= 0 ? parts[idIdx] : String.fromCharCode(65 + i);
      return {
        id: id || String.fromCharCode(65 + i),
        name: parts[nameIdx] || `Stop ${id || i + 1}`,
        lat: parseFloat(parts[latIdx]),
        lng: parseFloat(parts[lngIdx]),
        demand: demIdx >= 0 ? Number(parts[demIdx]) : 1,
      };
    });
    setStops(parsed.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)));
  };

  // --- Dev Self Tests (lightweight) ---
  function runSelfTests() {
    const out: string[] = [];
    const ok = (name: string, cond: boolean) => out.push(`${cond ? \"✅\" : \"❌\"} ${name}`);

    // Test: toCSV with custom headers
    const sampleRows = [
      { id: \"A\", name: \"A\", lat: 1, lng: 2, demand: 3 },
      { id: \"B\", name: \"B\", lat: 4, lng: 5, demand: 6 },
    ];
    const cols: ColumnSpec<typeof sampleRows[number]>[] = [
      { key: \"id\", title: \"ID\" },
      { key: \"name\", title: \"Name\" },
      { key: \"lat\", title: \"Lat\" },
      { key: \"lng\", title: \"Lng\" },
      { key: \"demand\", title: \"Demand\" },
    ];
    const csv = toCSV(sampleRows, cols);
    ok(\"CSV header titles honored\", csv.split("\n")[0] === \"ID,Name,Lat,Lng,Demand\");
    ok(\"CSV has 3 lines (header + 2)\", csv.split("\n").length === 3);

    // Test: clarkeWright capacity splitting
    const d: Depot = { name: \"D\", lat: 0, lng: 0 };
    const picks: Stop[] = [
      { id: \"1\", name: \"1\", lat: 0, lng: 0.1, demand: 2 },
      { id: \"2\", name: \"2\", lat: 0, lng: 0.2, demand: 2 },
      { id: \"3\", name: \"3\", lat: 0, lng: 0.3, demand: 2 },
    ];
    const rts = clarkeWright(d, picks, 4); // capacity should force at least 2 routes
    ok(\"Capacity constraint respected\", rts.every((r) => r.load <= 4));
    ok(\"Multiple routes when over capacity\", rts.length >= 2);

    setTestOutput(out);
  }

  return (
    <div className=\"min-h-screen grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 bg-slate-50\">
      <motion.div layout className=\"lg:col-span-4 space-y-4\">
        <Card className=\"shadow-sm\">
          <CardContent className=\"p-4 space-y-3\">
            <div className=\"text-xl font-semibold flex items-center gap-2\"><MapIcon className=\"w-5 h-5\"/> Truck Route Optimizer</div>
            <div className=\"text-sm text-slate-600\">Single-depot CVRP using Clarke–Wright + 2‑opt. Distances are straight-line (Haversine). Great for quick planning; for road-accurate routing, swap in a roads API later.</div>

            <div className=\"grid grid-cols-2 gap-2\">
              <div>
                <div className=\"text-xs text-slate-500\">Factory (lat)</div>
                <Input type=\"number\" value={depot.lat} onChange={(e) => setDepot({ ...depot, lat: parseFloat(e.target.value) })} />
              </div>
              <div>
                <div className=\"text-xs text-slate-500\">Factory (lng)</div>
                <Input type=\"number\" value={depot.lng} onChange={(e) => setDepot({ ...depot, lng: parseFloat(e.target.value) })} />
              </div>
              <div className=\"col-span-2\">
                <div className=\"text-xs text-slate-500\">Factory name</div>
                <Input value={depot.name} onChange={(e) => setDepot({ ...depot, name: e.target.value })} />
              </div>
            </div>

            <div className=\"pt-2\">
              <div className=\"flex items-center justify-between\">
                <div className=\"text-sm font-medium\">Truck Capacity</div>
                <div className=\"text-sm tabular-nums\">{capacity}</div>
              </div>
              <Slider value={[capacity]} min={1} max={50} step={1} onValueChange={(v) => setCapacity(v[0] ?? capacity)} />
              <div className=\"text-xs text-slate-500\">Sum of demands per route cannot exceed this.</div>
            </div>

            <div className=\"flex items-center justify-between pt-1\">
              <div className=\"text-sm\">Show labels</div>
              <Switch checked={showLabels} onCheckedChange={setShowLabels} />
            </div>

            <div className=\"grid grid-cols-2 gap-2 pt-2\">
              <Button onClick={addStop} variant=\"secondary\">Add stop</Button>
              <Button onClick={randomize} variant=\"secondary\"><RotateCcw className=\"w-4 h-4 mr-1\"/> Randomize demo</Button>
            </div>

            <div className=\"grid grid-cols-2 gap-2 pt-2\">
              <Button onClick={exportCSV} variant=\"outline\"><Download className=\"w-4 h-4 mr-1\"/> Export stops</Button>
              <Button onClick={exportPlan} variant=\"outline\"><Download className=\"w-4 h-4 mr-1\"/> Export plan</Button>
            </div>

            <div className=\"pt-2 space-y-2\">
              <div className=\"text-sm font-medium\">Import stops (.csv)</div>
              <Textarea placeholder=\"name,lat,lng,demand\nStop 1,18.79,98.99,2\nStop 2,18.80,99.02,1\" rows={4} id=\"csv\" />
              <Button onClick={() => {
                const ta = document.getElementById(\"csv\") as HTMLTextAreaElement | null;
                if (ta) importCSV(ta.value);
              }}><Upload className=\"w-4 h-4 mr-1\"/> Load CSV</Button>
            </div>
          </CardContent>
        </Card>

        <Card className=\"shadow-sm\">
          <CardContent className=\"p-4 space-y-2\">
            <div className=\"font-semibold\">Plan Summary</div>
            <div className=\"text-sm text-slate-700\">Total stops: {stops.length} • Total load: {totalLoad} • Trucks used: {routes.length} • Total distance: {totalDistance.toFixed(2)} km</div>
            <div className=\"space-y-2 max-h-72 overflow-auto pr-1\">
              {routes.map((r, idx) => (
                <div key={idx} className=\"border rounded-lg p-2 bg-white\">
                  <div className=\"text-sm font-medium\">Truck {idx + 1} — Load {r.load} — {r.distanceKm.toFixed(2)} km</div>
                  <div className=\"text-xs text-slate-600\">DEPOT → {r.route.map((s) => s.id).join(\" → \")} → DEPOT</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Dev Self-Tests */}
        <Card className=\"shadow-sm\">
          <CardContent className=\"p-4 space-y-2\">
            <div className=\"flex items-center justify-between\">
              <div className=\"font-semibold\">Dev: Self‑tests</div>
              <Switch checked={showTests} onCheckedChange={setShowTests} />
            </div>
            {showTests && (
              <>
                <Button onClick={runSelfTests} className=\"mb-2\" variant=\"secondary\">Run tests</Button>
                <div className=\"text-xs space-y-1\">
                  {testOutput.length === 0 ? <div className=\"text-slate-500\">No test results yet.</div> : testOutput.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div layout className=\"lg:col-span-8\">
        <Card className=\"h-[75vh] lg:h-[88vh] shadow-sm\">
          <CardContent className=\"p-0 h-full\">
            <MapContainer center={[depot.lat, depot.lng]} zoom={11} className=\"h-full w-full\">
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url=\"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png\"
              />
              <FitBounds depot={depot} stops={stops} />
              <Marker position={[depot.lat, depot.lng]} icon={factoryIcon}>
                <Popup>
                  <div className=\"font-medium\">{depot.name}</div>
                  <div className=\"text-xs\">{depot.lat.toFixed(5)}, {depot.lng.toFixed(5)}</div>
                </Popup>
              </Marker>
              {stops.map((s) => (
                <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon}>
                  <Popup>
                    <div className=\"font-medium\">{s.name}</div>
                    <div className=\"text-xs\">ID: {s.id} • Demand: {s.demand}</div>
                    <div className=\"text-xs\">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</div>
                    <div className=\"pt-2 flex gap-2\">
                      <Button size=\"sm\" variant=\"secondary\" onClick={() => removeStop(s.id)}>Remove</Button>
                    </div>
                  </Popup>
                </Marker>
              ))}

              {routes.map((r, idx) => {
                const poly = [[depot.lat, depot.lng] as [number, number]]
                  .concat(r.route.map((s) => [s.lat, s.lng] as [number, number]))
                  .concat([[depot.lat, depot.lng] as [number, number]]);
                return (
                  <Polyline key={idx} positions={poly} />
                );
              })}

              {/* Optional labels */}
              {showLabels && (
                <>
                  <Marker position={[depot.lat, depot.lng]} icon={new L.DivIcon({ className: \"\", html: `<div class='bg-white/90 text-xs px-2 py-1 rounded shadow border'>${depot.name}</div>` })} />
                  {stops.map((s) => (
                    <Marker key={s.id + \"lbl\"} position={[s.lat, s.lng]} icon={new L.DivIcon({ className: \"\", html: `<div class='bg-white/90 text-xs px-2 py-1 rounded shadow border'>${s.id}</div>` })} />
                  ))}
                </>
              )}
            </MapContainer>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
