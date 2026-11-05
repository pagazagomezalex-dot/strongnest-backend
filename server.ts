import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

/**
 * KIN-O IoT Backend Server v2.0 - High Performance IoT Telemetry & Socket Engine
 * Developed for StrongNest Technologies
 * Features: Real-time WebSockets, REST API, Geofence Engine, Command Ingestion & Route History
 */

const app = express();
const httpServer = createServer(app);

// Configuración de CORS para permitir conexiones desde la App Móvil (Expo/React Native)
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
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c); // Distancia en metros
}

// -----------------------------------------------------------------------------
// ENDPOINTS DE LA API REST (/api/v1)
// -----------------------------------------------------------------------------

// Health check
app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({
    status: 'ONLINE',
    system: 'KIN-O IoT Telemetry Engine',
    timestamp: new Date().toISOString(),
    version: '2.0.0-PROD'
  });
});

// Obtener estado actual de telemetría de PIPU
app.get('/api/v1/pets/pipu', (req: Request, res: Response) => {
  res.json(petState);
});

// Obtener historial de coordenadas para el Polyline del mapa
app.get('/api/v1/pets/pipu/history', (req: Request, res: Response) => {
  res.json({
    petId: petState.id,
    totalPoints: petState.history.length,
    history: petState.history
  });
});

// Ingesta de ráfaga de telemetría desde el módem del collar
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

    // Guardar en historial
    petState.history.push({ lat: petState.lat, lng: petState.lng, timestamp: petState.lastUpdated });
    if (petState.history.length > 50) petState.history.shift(); // Mantener últimos 50 puntos

    // Evaluar distancia a la geocerca
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

    // Transmitir evento por WebSockets en tiempo real
    io.emit('telemetry_update', petState);
  }

  res.json({ success: true, state: petState });
});

// Enviar comandos al hardware (Zumbador, LED, Ráfaga 3s, SOS)
app.post('/api/v1/device/command', (req: Request, res: Response) => {
  const { command, value } = req.body; // command: 'buzzer' | 'led' | 'burst' | 'sos'

  if (command === 'buzzer') petState.buzzerActive = !!value;
  if (command === 'led') petState.ledActive = !!value;
  if (command === 'burst') petState.burstMode = !!value;
  if (command === 'sos') petState.sosActive = !!value;

  petState.lastUpdated = new Date().toISOString();

  // Transmitir por WebSockets a todos los clientes
  io.emit('device_state_change', { command, value, petState });

  res.json({
    success: true,
    message: `Comando '${command}' ejecutado con éxito (${value})`,
    petState
  });
});

// Configurar nueva geocerca
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

// -----------------------------------------------------------------------------
// SERVIDORES DE WEBSOCKETS (SOCKET.IO)
// -----------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`🟢 Nuevo cliente conectado a WebSockets: ${socket.id}`);

  // Enviar estado inicial de inmediato al conectar
  socket.emit('telemetry_update', petState);

  // Escuchar petición de ráfaga manual desde la app
  socket.on('request_burst', () => {
    petState.burstMode = true;
    io.emit('telemetry_update', petState);
  });

  // Escuchar cambio de geocerca desde la app
  socket.on('change_geofence_radius', (newRadius: number) => {
    petState.geofenceRadius = newRadius;
    io.emit('telemetry_update', petState);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Cliente desconectado: ${socket.id}`);
  });
});

// -----------------------------------------------------------------------------
// BUCLE DE SIMULACIÓN INTERNA (TELEMETRÍA M2M EN VIVO CADENAS DE PUNTOS)
// -----------------------------------------------------------------------------
let stepAngle = 0;
setInterval(() => {
  stepAngle += 0.08;
  const r = 0.0008; // ~80 metros de radio de patrullaje alrededor de Parque México
  
  petState.lat = currentCenter.lat + r * Math.cos(stepAngle);
  petState.lng = currentCenter.lng + r * Math.sin(stepAngle);
  petState.lastUpdated = new Date().toISOString();

  // Guardar en historial de ruta
  petState.history.push({ lat: petState.lat, lng: petState.lng, timestamp: petState.lastUpdated });
  if (petState.history.length > 50) petState.history.shift();

  // Calcular distancia a geocerca
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

  // Emitir por WebSockets
  io.emit('telemetry_update', petState);
}, 3000);

// -----------------------------------------------------------------------------
// INICIO DEL SERVIDOR
// -----------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log('==================================================');
  console.log('🚀 SERVIDORES KIN-O IOT BACKEND v2.0 ACTIVOS');
  console.log(`📡 API REST:       http://localhost:${PORT}/api/v1`);
  console.log(`⚡ WEBSOCKETS:     ws://localhost:${PORT}`);
  console.log(`🐶 TELEMETRÍA PIPU: http://localhost:${PORT}/api/v1/pets/pipu`);
  console.log(`📋 HISTORIAL RUTA: http://localhost:${PORT}/api/v1/pets/pipu/history`);
  console.log('==================================================');
});
