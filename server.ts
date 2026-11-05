import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

/**
 * KIN-O IoT Backend Server v2.5 - Cloud Telemetry Engine & Live Web Dashboard
 * Developed for StrongNest Technologies
 * Features: Real-time WebSockets, REST API, Geofence Engine, Live Web Dashboard (/demo & /)
 */

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// -----------------------------------------------------------------------------
// BASE DE DATOS EN MEMORIA (ESTADO GLOBAL KIN-O)
// -----------------------------------------------------------------------------
interface TelemetryPoint {
  lat: number;
  lng: number;
  timestamp: string;
}

interface PetDeviceState {
  id: string;
  name: string;
  battery: number;
  signalDbm: number;
  satellites: number;
  lat: number;
  lng: number;
  speedKmh: number;
  geofenceRadius: number; // metros
  geofenceCenter: { lat: number; lng: number };
  geofenceStatus: 'SAFE' | 'WARNING' | 'BREACH';
  sosActive: boolean;
  ledActive: boolean;
  buzzerActive: boolean;
  burstMode: boolean;
  lastUpdated: string;
  history: TelemetryPoint[];
}

const currentCenter = { lat: 19.432608, lng: -99.133209 }; // Parque México / Condesa, CDMX

let petState: PetDeviceState = {
  id: 'pipu',
  name: 'PIPU',
  battery: 88,
  signalDbm: -78,
  satellites: 12,
  lat: 19.432608,
  lng: -99.133209,
  speedKmh: 1.2,
  geofenceRadius: 150,
  geofenceCenter: currentCenter,
  geofenceStatus: 'SAFE',
  sosActive: false,
  ledActive: false,
  buzzerActive: false,
  burstMode: false,
  lastUpdated: new Date().toISOString(),
  history: [
    { lat: 19.432000, lng: -99.133000, timestamp: new Date(Date.now() - 600000).toISOString() },
    { lat: 19.432300, lng: -99.133100, timestamp: new Date(Date.now() - 300000).toISOString() },
    { lat: 19.432608, lng: -99.133209, timestamp: new Date().toISOString() }
  ]
};

// -----------------------------------------------------------------------------
// FÓRMULA HAVERSINE: Cálculo exacto de distancia en metros entre 2 puntos GPS
// -----------------------------------------------------------------------------
function calculateHaversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// -----------------------------------------------------------------------------
// DASHBOARD WEB EN VIVO PARA SOCIOS (/demo y /)
// -----------------------------------------------------------------------------
const renderWebDashboard = (req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>KIN-O Pets | Monitoreo en Vivo</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background-color: #0F172A; color: #F8FAFC; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
    header { background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(10px); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1E293B; z-index: 1000; }
    .brand { display: flex; align-items: center; gap: 8px; }
    .brand-logo { font-size: 20px; font-weight: 900; background: linear-gradient(135deg, #38BDF8, #818CF8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: 1px; }
    .live-badge { background: rgba(34, 197, 94, 0.15); color: #4ADE80; border: 1px solid rgba(74, 222, 128, 0.3); font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; display: flex; align-items: center; gap: 6px; }
    .pulse-dot { width: 8px; height: 8px; background-color: #22C55E; border-radius: 50%; animation: pulse 1.5s infinite; }
    #map { flex: 1; width: 100%; height: 100%; z-index: 1; }
    .telemetry-card { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: calc(100% - 32px); max-width: 440px; background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 16px; z-index: 1000; box-shadow: 0 20px 40px rgba(0,0,0,0.5); transition: all 0.3s ease; }
    .pet-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .pet-info { display: flex; align-items: center; gap: 10px; }
    .pet-avatar { width: 42px; height: 42px; background: #1E293B; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; border: 2px solid #38BDF8; }
    .pet-name { font-size: 17px; font-weight: 800; color: #FFFFFF; }
    .pet-status { font-size: 12px; color: #94A3B8; }
    .status-pill { padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; }
    .status-safe { background: rgba(34, 197, 94, 0.2); color: #4ADE80; border: 1px solid #22C55E; }
    .status-breach { background: rgba(239, 68, 68, 0.2); color: #FCA5A5; border: 1px solid #EF4444; animation: flash-red 0.8s infinite alternate; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; background: rgba(30, 41, 59, 0.5); padding: 10px; border-radius: 12px; }
    .grid-item { text-align: center; }
    .grid-label { font-size: 10px; color: #64748B; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
    .grid-val { font-size: 14px; font-weight: 800; color: #38BDF8; }
    #sos-banner { display: none; position: absolute; top: 70px; left: 50%; transform: translateX(-50%); width: calc(100% - 32px); max-width: 440px; background: #EF4444; color: white; padding: 12px 16px; border-radius: 14px; font-weight: 800; font-size: 13px; text-align: center; z-index: 1001; box-shadow: 0 10px 25px rgba(239,68,68,0.5); animation: flash 0.6s infinite alternate; }
    @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
    @keyframes flash { from { opacity: 1; } to { opacity: 0.5; } }
    @keyframes flash-red { from { background: rgba(239, 68, 68, 0.2); } to { background: rgba(239, 68, 68, 0.6); } }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo">STRONGNEST</div>
      <span style="font-size: 11px; color: #64748B; font-weight: 600;">| KIN-O PETS</span>
    </div>
    <div class="live-badge">
      <div class="pulse-dot"></div> EN VIVO
    </div>
  </header>

  <div id="sos-banner">🚨 ¡ALERTA SOS ACTIVADA PARA PIPU! 🚨</div>
  <div id="map"></div>

  <div class="telemetry-card">
    <div class="pet-header">
      <div class="pet-info">
        <div class="pet-avatar">🐶</div>
        <div>
          <div class="pet-name">PIPU <span style="font-size:12px; color:#38BDF8;">(KIN-O Tag)</span></div>
          <div class="pet-status">Collar 4G LTE-M • CDMX</div>
        </div>
      </div>
      <div id="geofence-pill" class="status-pill status-safe">PROTEGIDO</div>
    </div>

    <div class="grid">
      <div class="grid-item">
        <div class="grid-label">BATERÍA</div>
        <div class="grid-val" id="val-bat">88% 🔋</div>
      </div>
      <div class="grid-item">
        <div class="grid-label">SEÑAL 4G</div>
        <div class="grid-val" id="val-sig">-78 dBm 📡</div>
      </div>
      <div class="grid-item">
        <div class="grid-label">VELOCIDAD</div>
        <div class="grid-val" id="val-spd">1.2 km/h 🐾</div>
      </div>
    </div>
  </div>

  <script>
    const socket = io();
    let map, marker, circle, polyline;
    let pathHistory = [];

    function initMap(lat, lng) {
      map = L.map('map', { zoomControl: false }).setView([lat, lng], 17);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; StrongNest IoT'
      }).addTo(map);

      const petIcon = L.divIcon({
        className: 'custom-pet-marker',
        html: '<div style="background:#38BDF8; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; border:3px solid #FFFFFF; box-shadow:0 0 15px rgba(56,189,248,0.8);">🐶</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });

      marker = L.marker([lat, lng], { icon: petIcon }).addTo(map);
      circle = L.circle([lat, lng], { color: '#38BDF8', fillColor: '#38BDF8', fillOpacity: 0.1, radius: 150 }).addTo(map);
      polyline = L.polyline([], { color: '#38BDF8', weight: 3, opacity: 0.7, dashArray: '6, 6' }).addTo(map);
    }

    function updateState(data) {
      if (!map) initMap(data.lat, data.lng);

      marker.setLatLng([data.lat, data.lng]);
      map.panTo([data.lat, data.lng]);

      pathHistory.push([data.lat, data.lng]);
      if (pathHistory.length > 30) pathHistory.shift();
      polyline.setLatLngs(pathHistory);

      document.getElementById('val-bat').innerText = (data.battery || 88) + '% 🔋';
      document.getElementById('val-sig').innerText = (data.signalDbm || -78) + ' dBm 📡';
      document.getElementById('val-spd').innerText = (data.speedKmh || 1.2) + ' km/h 🐾';

      const pill = document.getElementById('geofence-pill');
      const banner = document.getElementById('sos-banner');

      if (data.sosActive || data.geofenceStatus === 'BREACH') {
        pill.className = 'status-pill status-breach';
        pill.innerText = '🚨 ALERTA SOS';
        banner.style.display = 'block';
      } else {
        pill.className = 'status-pill status-safe';
        pill.innerText = 'PROTEGIDO 🟢';
        banner.style.display = 'none';
      }
    }

    socket.on('telemetry_update', (data) => updateState(data));

    setInterval(async () => {
      try {
        const res = await fetch('/api/v1/pets/pipu');
        if (res.ok) {
          const data = await res.json();
          updateState(data);
        }
      } catch (e) {}
    }, 3000);
  </script>
</body>
</html>`;
  res.send(html);
};

app.get('/demo', renderWebDashboard);
app.get('/', renderWebDashboard);

// -----------------------------------------------------------------------------
// ENDPOINTS DE LA API REST (/api/v1)
// -----------------------------------------------------------------------------

app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({
    status: 'ONLINE',
    system: 'KIN-O IoT Telemetry Engine',
    timestamp: new Date().toISOString(),
    version: '2.5.0-PROD'
  });
});

app.get('/api/v1/pets/pipu', (req: Request, res: Response) => {
  res.json(petState);
});

app.get('/api/v1/pets/pipu/history', (req: Request, res: Response) => {
  res.json({
    petId: petState.id,
    totalPoints: petState.history.length,
    history: petState.history
  });
});

app.post('/api/v1/telemetry', (req: Request, res: Response) => {
  const { lat, lng, battery, signalDbm, satellites, speedKmh } = req.body;

  if (lat && lng) {
    petState.lat = parseFloat(lat);
    petState.lng = parseFloat(lng);
    if (battery !== undefined) petState.battery = battery;
    if (signalDbm !== undefined) petState.signalDbm = signalDbm;
    if (satellites !== undefined) petState.satellites = satellites;
    if (speedKmh !== undefined) petState.speedKmh = speedKmh;

    petState.lastUpdated = new Date().toISOString();

    petState.history.push({ lat: petState.lat, lng: petState.lng, timestamp: petState.lastUpdated });
    if (petState.history.length > 50) petState.history.shift();

    const dist = calculateHaversineDistance(
      petState.lat, petState.lng,
      petState.geofenceCenter.lat, petState.geofenceCenter.lng
    );

    if (dist > petState.geofenceRadius) {
      petState.geofenceStatus = 'BREACH';
      io.emit('geofence_alert', {
        message: `⚠️ ALERTA: ${petState.name} ha salido de la geocerca (${dist}m)`,
        petState
      });
    } else if (dist > petState.geofenceRadius * 0.8) {
      petState.geofenceStatus = 'WARNING';
    } else {
      petState.geofenceStatus = 'SAFE';
    }

    io.emit('telemetry_update', petState);
  }

  res.json({ success: true, state: petState });
});

app.post('/api/v1/device/command', (req: Request, res: Response) => {
  const { command, value } = req.body;

  if (command === 'buzzer') petState.buzzerActive = !!value;
  if (command === 'led') petState.ledActive = !!value;
  if (command === 'burst') petState.burstMode = !!value;
  if (command === 'sos') petState.sosActive = !!value;

  petState.lastUpdated = new Date().toISOString();

  io.emit('device_state_change', { command, value, petState });

  res.json({
    success: true,
    message: `Comando '${command}' ejecutado con éxito (${value})`,
    petState
  });
});

app.post('/api/v1/geofence', (req: Request, res: Response) => {
  const { radius, lat, lng } = req.body;
  if (radius) petState.geofenceRadius = radius;
  if (lat && lng) petState.geofenceCenter = { lat, lng };

  io.emit('geofence_updated', {
    radius: petState.geofenceRadius,
    center: petState.geofenceCenter
  });

  res.json({ success: true, geofence: { radius: petState.geofenceRadius, center: petState.geofenceCenter } });
});

io.on('connection', (socket) => {
  console.log(`🟢 Nuevo cliente conectado a WebSockets: ${socket.id}`);
  socket.emit('telemetry_update', petState);

  socket.on('request_burst', () => {
    petState.burstMode = true;
    io.emit('telemetry_update', petState);
  });

  socket.on('change_geofence_radius', (newRadius: number) => {
    petState.geofenceRadius = newRadius;
    io.emit('telemetry_update', petState);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Cliente desconectado: ${socket.id}`);
  });
});

let stepAngle = 0;
setInterval(() => {
  stepAngle += 0.08;
  const r = 0.0008;
  
  petState.lat = currentCenter.lat + r * Math.cos(stepAngle);
  petState.lng = currentCenter.lng + r * Math.sin(stepAngle);
  petState.lastUpdated = new Date().toISOString();

  petState.history.push({ lat: petState.lat, lng: petState.lng, timestamp: petState.lastUpdated });
  if (petState.history.length > 50) petState.history.shift();

  const dist = calculateHaversineDistance(
    petState.lat, petState.lng,
    currentCenter.lat, currentCenter.lng
  );

  if (dist > petState.geofenceRadius) {
    petState.geofenceStatus = 'BREACH';
  } else if (dist > petState.geofenceRadius * 0.8) {
    petState.geofenceStatus = 'WARNING';
  } else {
    petState.geofenceStatus = 'SAFE';
  }

  io.emit('telemetry_update', petState);
}, 3000);

httpServer.listen(PORT, () => {
  console.log('==================================================');
  console.log('🚀 SERVIDORES KIN-O IOT BACKEND v2.5 ACTIVOS');
  console.log(`📡 API REST:       http://localhost:${PORT}/api/v1`);
  console.log(`⚡ WEBSOCKETS:     ws://localhost:${PORT}`);
  console.log(`🐶 TELEMETRÍA PIPU: http://localhost:${PORT}/api/v1/pets/pipu`);
  console.log(`📋 HISTORIAL RUTA: http://localhost:${PORT}/api/v1/pets/pipu/history`);
  console.log('==================================================');
});
