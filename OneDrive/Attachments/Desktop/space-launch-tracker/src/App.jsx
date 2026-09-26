import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { 
  Rocket, MapPin, Clock, RefreshCw, Search, Filter, 
  ExternalLink, X, Map as MapIcon, 
  LayoutGrid, Activity, Volume2, VolumeX, Play, Satellite,
  History, CheckCircle2, XCircle, Wind, CloudRain, Thermometer,
  Calendar, Download, Gauge, Compass, Zap, Sparkles, Box, Eye,
  Sun, Moon, Star, Tv, Maximize2
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Polygon } from "react-leaflet";
import L from "leaflet";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

// --- SOLAR TERMINATOR CALCULATION ENGINE ---
function computeSolarTerminatorPoints() {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getUTCFullYear(), 0, 0)) / 86400000);
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const decRad = (declination * Math.PI) / 180;

  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const sunLng = (12 - utcHours) * 15;

  const points = [];
  for (let lon = -180; lon <= 180; lon += 3) {
    const lonDiffRad = ((lon - sunLng) * Math.PI) / 180;
    const latRad = Math.atan(-Math.cos(lonDiffRad) / Math.tan(decRad));
    const latDeg = (latRad * 180) / Math.PI;
    points.push([latDeg, lon]);
  }

  const nightPolygon = [[-90 * Math.sign(declination || -1), -180], ...points, [-90 * Math.sign(declination || -1), 180]];
  return { linePoints: points, polygonPoints: nightPolygon, sunLng, declination };
}

function getPadDaylightStatus(lat, lon, sunLng, declination) {
  const decRad = (declination * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonDiffRad = ((lon - sunLng) * Math.PI) / 180;
  const sinAltitude = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(lonDiffRad);
  const altitudeDeg = (Math.asin(sinAltitude) * 180) / Math.PI;

  if (altitudeDeg > 0) return { label: "Daylight", isDay: true };
  if (altitudeDeg > -6) return { label: "Civil Twilight / Dusk", isDay: false };
  return { label: "Night Orbital Window", isDay: false };
}

// --- AUDIO SOUND ENGINE ---
const playVoiceCallout = (text) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = 0.9;
  utterance.rate = 1.0;
  window.speechSynthesis.speak(utterance);
};

const playRumbleSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(140, ctx.currentTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 2.0);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + 2.0);
  } catch {
    // blocked or unsupported
  }
};

const downloadCalendarInvite = (launch) => {
  const startDate = new Date(launch.net);
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const formatDate = (d) => d.toISOString().replace(/-|:|\.\d+/g, "");

  const icsData = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbital Telemetry//Launch Tracker//EN",
    "BEGIN:VEVENT",
    `UID:${launch.id}@orbitaltelemetry.app`,
    `DTSTAMP:${formatDate(new Date())}`,
    `DTSTART:${formatDate(startDate)}`,
    `DTEND:${formatDate(endDate)}`,
    `SUMMARY:🚀 Launch: ${launch.name}`,
    `DESCRIPTION:${launch.mission?.description ? launch.mission.description.replace(/\n/g, " ") : "Orbital launch operation"}`,
    `LOCATION:${launch.pad?.name || "Spaceport"}, ${launch.pad?.location?.name || ""}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([icsData], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `${launch.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_launch.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// --- MAP ICONS ---
const createRadarIcon = (status) => {
  const isSuccess = status === "Launch Successful" || status === "Go for Launch";
  const glowColor = isSuccess ? "#10b981" : status?.toLowerCase().includes("fail") ? "#ef4444" : "#00f0ff";
  return new L.DivIcon({
    className: "beacon-pulse",
    html: `<div style="background: ${glowColor}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 12px ${glowColor};"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
};

const issIcon = new L.DivIcon({
  className: "iss-beacon",
  html: `<div style="background: #f43f5e; width: 18px; height: 18px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 15px #f43f5e; display: flex; align-items: center; justify-content: center;"><div style="width: 6px; height: 6px; background: white; border-radius: 50%;"></div></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// --- PAYLOAD SATELLITE SPECIFICATIONS RESOLVER ---
function getSatelliteSpecs(launch) {
  const name = (launch?.name || "").toLowerCase();
  const desc = (launch?.mission?.description || "").toLowerCase();
  const orbit = (launch?.mission?.orbit?.name || "").toLowerCase();

  if (name.includes("starlink") || desc.includes("starlink")) {
    return {
      type: "Starlink Constellation Stack",
      bus: "SpaceX Starlink v2 Mini",
      mass: "~16,500 kg (Full Batch)",
      power: "Deployable Single Solar Wing",
      instruments: "Ku/Ka Band Phased Array Antennas, Laser Intersatellite Links, Argon Thrusters",
      dispenser: "Rotational Tensioner Mechanical Dispenser",
      meshVariant: "starlink"
    };
  }

  if (orbit.includes("gto") || orbit.includes("geo") || name.includes("tel") || name.includes("sat") || desc.includes("telecom")) {
    return {
      type: "Geostationary Communications Satellite",
      bus: "Eurostar E3000 / Spacebus Neo",
      mass: "4,500 - 6,500 kg",
      power: "Dual High-Efficiency Solar Panel Wings (15 kW)",
      instruments: "High-Throughput Spot Beam Ka-band Transponders, Steerable Dish Reflectors",
      dispenser: "1194VS Composite Adapter Clamp",
      meshVariant: "commsat"
    };
  }

  if (orbit.includes("polar") || orbit.includes("sso") || desc.includes("earth observation") || desc.includes("optical")) {
    return {
      type: "Earth Observation Remote Sensing Probe",
      bus: "ISRO IMS-2 / AstroBus High-Res",
      mass: "1,200 - 2,200 kg",
      power: "Dual-Fold Solar Array (~3.5 kW)",
      instruments: "Multispectral Optical Imaging Telescope, Synthetic Aperture Radar (SAR)",
      dispenser: "Standard Low-Shock Mechanical Clamp Ring",
      meshVariant: "probe"
    };
  }

  return {
    type: "Orbital Technology Demo Satellite",
    bus: "Modular Standard Satellite Bus",
    mass: "1,000 - 3,500 kg",
    power: "Dual Fixed Photovoltaic Wings",
    instruments: "Telemetry Radio Transceiver, Space Environment Sensors",
    dispenser: "Pneumatic Mechanical Push Separation",
    meshVariant: "generic"
  };
}

// --- ORBITAL FLIGHT PROFILE CONFIG ---
function getMissionFlightConfig(launch) {
  if (!launch) {
    return {
      type: "Standard Orbital (LEO)",
      targetAlt: 420,
      insertionAlt: 320,
      targetVel: 27500,
      maxDownrange: 1650,
      maxFlightTime: 600,
      mecoTime: 155,
      stageSepTime: 162,
      seco1Time: 510,
      deployTime: 540,
      milestones: []
    };
  }

  const orbit = (launch.mission?.orbit?.name || "").toLowerCase();
  const rocket = (launch.rocket?.configuration?.name || "").toLowerCase();

  if (orbit.includes("geostationary") || orbit.includes("gto") || orbit.includes("geo") || orbit.includes("transfer")) {
    return {
      type: "Geostationary Transfer (GTO)",
      targetAlt: 35786,
      insertionAlt: 650,
      targetVel: 36200,
      maxDownrange: 7800,
      maxFlightTime: 1800,
      mecoTime: 165,
      stageSepTime: 172,
      seco1Time: 520,
      deployTime: 1800,
      milestones: [
        { id: 1, label: "Liftoff / Max-Q", t: "T+62s" },
        { id: 2, label: "MECO", t: "T+165s" },
        { id: 3, label: "Stage Sep", t: "T+172s" },
        { id: 4, label: "Fairing Sep", t: "T+215s" },
        { id: 5, label: "SECO-1 Parking", t: "T+520s" },
        { id: 6, label: "SES-2 Burn", t: "T+1620s" },
        { id: 7, label: "GTO Insertion", t: "T+1800s" },
      ]
    };
  }

  if (orbit.includes("polar") || orbit.includes("sso") || orbit.includes("sun-synchronous") || rocket.includes("pslv")) {
    return {
      type: "Sun-Synchronous Polar Orbit (SSO)",
      targetAlt: 680,
      insertionAlt: 680,
      targetVel: 26800,
      maxDownrange: 3200,
      maxFlightTime: 950,
      mecoTime: 145,
      stageSepTime: 152,
      seco1Time: 620,
      deployTime: 920,
      milestones: [
        { id: 1, label: "Liftoff / Max-Q", t: "T+55s" },
        { id: 2, label: "MECO", t: "T+145s" },
        { id: 3, label: "Stage Sep", t: "T+152s" },
        { id: 4, label: "Fairing Sep", t: "T+190s" },
        { id: 5, label: "Upper Stage Burn", t: "T+480s" },
        { id: 6, label: "Terminal SECO", t: "T+620s" },
        { id: 7, label: "Polar Injection", t: "T+920s" },
      ]
    };
  }

  return {
    type: "Low Earth Orbit (LEO)",
    targetAlt: 420,
    insertionAlt: 320,
    targetVel: 27500,
    maxDownrange: 1650,
    maxFlightTime: 600,
    mecoTime: 155,
    stageSepTime: 162,
    seco1Time: 510,
    deployTime: 540,
    milestones: [
      { id: 1, label: "Liftoff / Max-Q", t: "T+60s" },
      { id: 2, label: "MECO", t: "T+155s" },
      { id: 3, label: "Stage Sep", t: "T+162s" },
      { id: 4, label: "SES-1 Burn", t: "T+170s" },
      { id: 5, label: "Fairing Jettison", t: "T+195s" },
      { id: 6, label: "SECO-1 Cutoff", t: "T+510s" },
      { id: 7, label: "Orbital Deployment", t: "T+540s" },
    ]
  };
}

function computeTelemetry(metSeconds, config) {
  const t = Math.max(0, metSeconds);
  const { mecoTime = 155, seco1Time = 510, deployTime = 540, targetVel = 27500, insertionAlt = 320, maxDownrange = 1650 } = config;

  let velocity = 0;
  if (t < mecoTime) {
    velocity = (t / mecoTime) * (targetVel * 0.32);
  } else if (t < seco1Time) {
    const progress = (t - mecoTime) / (seco1Time - mecoTime);
    velocity = targetVel * 0.32 + progress * (targetVel * 0.68);
  } else {
    velocity = targetVel + Math.sin(t / 8) * 15;
  }

  let altitude = 0;
  if (t < mecoTime) {
    altitude = Math.pow(t / mecoTime, 2) * 65;
  } else if (t < seco1Time) {
    const progress = (t - mecoTime) / (seco1Time - mecoTime);
    altitude = 65 + progress * (insertionAlt - 65);
  } else {
    altitude = insertionAlt + Math.cos(t / 15) * 1.5;
  }

  const downrange = Math.min(maxDownrange, Math.pow(t / deployTime, 1.6) * maxDownrange);

  // Dynamic G-Force calculation
  let gForce = 1.0;
  if (t < mecoTime) {
    gForce = 1.0 + (t / mecoTime) * 3.2; // builds to ~4.2G before cutoff
  } else if (t < seco1Time) {
    gForce = 1.2 + ((t - mecoTime) / (seco1Time - mecoTime)) * 2.1;
  } else {
    gForce = 0.0; // Microgravity in orbit
  }

  // Engine Throttle %
  let throttle = 100;
  if (t >= 55 && t <= 75) throttle = 72; // Deep throttle bucket through Max-Q
  if (t >= mecoTime - 8 && t < mecoTime) throttle = 60; // Throttle to limit Gs before MECO
  if (t >= mecoTime && t < mecoTime + 7) throttle = 0; // Stage separation coast
  if (t > seco1Time) throttle = 0;

  let currentEvent = "Pad Cleared & Vertical Ascent";
  let activePhase = 1;

  if (t >= deployTime) {
    currentEvent = `${config.type} Injection Confirmed`;
    activePhase = 7;
  } else if (t >= seco1Time) {
    currentEvent = "SECO-1 (Secondary Engine Cut-Off)";
    activePhase = 6;
  } else if (t >= 195) {
    currentEvent = "Payload Fairing Jettison";
    activePhase = 5;
  } else if (t >= (config.stageSepTime || 162)) {
    currentEvent = "Stage 2 Vacuum Engine Ignition";
    activePhase = 4;
  } else if (t >= mecoTime) {
    currentEvent = "MECO & Stage 1 Separation";
    activePhase = 3;
  } else if (t >= 60) {
    currentEvent = "Max-Q (Maximum Dynamic Pressure)";
    activePhase = 2;
  }

  return {
    velocity: Math.round(velocity),
    altitude: parseFloat(altitude.toFixed(1)),
    downrange: Math.round(downrange),
    gForce: parseFloat(gForce.toFixed(2)),
    throttle,
    currentEvent,
    activePhase
  };
}

// --- 3D SATELLITE INSIDE PAYLOAD BAY ---
function SatelliteInsideBay({ variant = "generic" }) {
  const satRef = useRef();
  useFrame(() => {
    if (satRef.current) satRef.current.rotation.y += 0.01;
  });

  if (variant === "starlink") {
    return (
      <group ref={satRef} position={[0, 2.7, 0]}>
        {[...Array(6)].map((_, i) => (
          <mesh key={i} position={[0, (i - 2.5) * 0.08, 0]}>
            <boxGeometry args={[0.34, 0.045, 0.22]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#475569" : "#64748b"} metalness={0.8} />
          </mesh>
        ))}
      </group>
    );
  }

  if (variant === "commsat") {
    return (
      <group ref={satRef} position={[0, 2.7, 0]}>
        <mesh>
          <boxGeometry args={[0.22, 0.36, 0.22]} />
          <meshStandardMaterial color="#eab308" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[-0.32, 0, 0]}>
          <boxGeometry args={[0.38, 0.14, 0.015]} />
          <meshStandardMaterial color="#1e3a8a" />
        </mesh>
        <mesh position={[0.32, 0, 0]}>
          <boxGeometry args={[0.38, 0.14, 0.015]} />
          <meshStandardMaterial color="#1e3a8a" />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={satRef} position={[0, 2.7, 0]}>
      <mesh>
        <cylinderGeometry args={[0.16, 0.16, 0.38, 6]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.7} />
      </mesh>
      <mesh position={[0.26, 0, 0]}>
        <boxGeometry args={[0.28, 0.16, 0.02]} />
        <meshStandardMaterial color="#0284c7" />
      </mesh>
    </group>
  );
}

// --- DYNAMIC ROCKET 3D GEOMETRY ---
function DynamicRocket3D({ rocketName = "", satelliteVariant = "generic", isCutaway = false }) {
  const rocketRef = useRef();
  const name = rocketName.toLowerCase();

  useFrame(() => {
    if (rocketRef.current) rocketRef.current.rotation.y += 0.007;
  });

  const fairingOpacity = isCutaway ? 0.18 : 1.0;

  if (name.includes("heavy")) {
    return (
      <group ref={rocketRef} position={[0, -1.3, 0]}>
        <mesh position={[0, 0.8, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 2.2, 32]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.6} />
        </mesh>
        <mesh position={[0, 2.1, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.65, 32]} />
          <meshStandardMaterial color="#e2e8f0" />
        </mesh>
        <SatelliteInsideBay variant={satelliteVariant} />
        <mesh position={[0, 3.1, 0]}>
          <coneGeometry args={[0.34, 0.95, 32]} />
          <meshStandardMaterial color="#38bdf8" transparent={isCutaway} opacity={fairingOpacity} wireframe={isCutaway} />
        </mesh>
        <mesh position={[-0.65, 0.7, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 2.1, 32]} />
          <meshStandardMaterial color="#e2e8f0" />
        </mesh>
        <mesh position={[0.65, 0.7, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 2.1, 32]} />
          <meshStandardMaterial color="#e2e8f0" />
        </mesh>
      </group>
    );
  }

  if (name.includes("starship") || name.includes("super heavy")) {
    return (
      <group ref={rocketRef} position={[0, -1.3, 0]}>
        <mesh position={[0, 0.7, 0]}>
          <cylinderGeometry args={[0.54, 0.54, 2.2, 32]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.95} />
        </mesh>
        <SatelliteInsideBay variant={satelliteVariant} />
        <mesh position={[0, 2.8, 0]}>
          <coneGeometry args={[0.54, 1.3, 32]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.95} transparent={isCutaway} opacity={fairingOpacity} wireframe={isCutaway} />
        </mesh>
      </group>
    );
  }

  if (name.includes("pslv") || name.includes("gslv") || name.includes("isro")) {
    return (
      <group ref={rocketRef} position={[0, -1.2, 0]}>
        <mesh position={[0, 0.8, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 2.2, 32]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.1, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 0.7, 32]} />
          <meshStandardMaterial color="#ea580c" metalness={0.2} roughness={0.5} />
        </mesh>
        <SatelliteInsideBay variant={satelliteVariant} />
        <mesh position={[0, 2.95, 0]}>
          <coneGeometry args={[0.35, 0.9, 32]} />
          <meshStandardMaterial color="#ffffff" metalness={0.2} transparent={isCutaway} opacity={fairingOpacity} wireframe={isCutaway} />
        </mesh>
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((ang, idx) => (
          <group key={idx} position={[Math.cos(ang) * 0.52, 0.4, Math.sin(ang) * 0.52]}>
            <mesh>
              <cylinderGeometry args={[0.11, 0.11, 1.4, 24]} />
              <meshStandardMaterial color="#f1f5f9" metalness={0.4} />
            </mesh>
            <mesh position={[0, 0.85, 0]}>
              <coneGeometry args={[0.11, 0.3, 24]} />
              <meshStandardMaterial color="#ea580c" />
            </mesh>
          </group>
        ))}
      </group>
    );
  }

  return (
    <group ref={rocketRef} position={[0, -1.2, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 2.3, 32]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.6} />
      </mesh>
      <mesh position={[0, 2.1, 0]}>
        <cylinderGeometry args={[0.305, 0.305, 0.15, 32]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.7, 32]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <SatelliteInsideBay variant={satelliteVariant} />
      <mesh position={[0, 3.2, 0]}>
        <coneGeometry args={[0.34, 0.9, 32]} />
        <meshStandardMaterial color="#06b6d4" transparent={isCutaway} opacity={fairingOpacity} wireframe={isCutaway} />
      </mesh>
    </group>
  );
}

// --- FLIGHT TRAJECTORY HUD ---
function FlightTrajectoryHUD({ elapsedSeconds, launch }) {
  const config = useMemo(() => getMissionFlightConfig(launch), [launch]);
  const telemetry = computeTelemetry(elapsedSeconds, config);

  const currentX = Math.min(480, 20 + (telemetry.downrange / Math.max(1, config.maxDownrange)) * 460);
  const currentY = Math.max(20, 180 - (telemetry.altitude / Math.max(1, config.insertionAlt * 1.15)) * 160);

  return (
    <div className="bg-[#060913] border border-cyan-500/30 rounded-2xl p-4 shadow-2xl font-mono">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800 text-xs">
        <span className="text-cyan-400 font-bold uppercase">{config.type}</span>
        <span className="text-slate-300">Target Apogee: <strong className="text-white">{config.targetAlt?.toLocaleString()} km</strong></span>
        <span className="text-emerald-400">Target Velocity: <strong>{config.targetVel?.toLocaleString()} km/h</strong></span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-[#0e1628] p-3 rounded-xl border border-cyan-900/50">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" /> Velocity
          </div>
          <div className="text-lg font-bold text-cyan-300">{telemetry.velocity.toLocaleString()} km/h</div>
        </div>
        <div className="bg-[#0e1628] p-3 rounded-xl border border-cyan-900/50">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-emerald-400" /> Altitude
          </div>
          <div className="text-lg font-bold text-emerald-300">{telemetry.altitude} km</div>
        </div>
        <div className="bg-[#0e1628] p-3 rounded-xl border border-cyan-900/50">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1">
            <Compass className="w-3.5 h-3.5 text-amber-400" /> Distance Traveled
          </div>
          <div className="text-lg font-bold text-amber-300">{telemetry.downrange} km</div>
        </div>
        <div className="bg-[#0e1628] p-3 rounded-xl border border-cyan-900/50">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-rose-400" /> G-Force Acceleration
          </div>
          <div className="text-lg font-bold text-rose-300">{telemetry.gForce} G</div>
        </div>
      </div>

      <div className="bg-[#090f1d] border border-slate-800 rounded-xl p-3 mb-4">
        <div className="flex justify-between text-[11px] text-slate-400 mb-2">
          <span className="text-cyan-400 font-bold">Ascent Vector: {launch?.pad?.name || "Spaceport Pad"}</span>
          <span>Insertion Point: {config.insertionAlt} km</span>
        </div>
        <svg viewBox="0 0 500 200" className="w-full h-40 overflow-visible">
          <line x1="20" y1="20" x2="490" y2="20" stroke="#1e293b" strokeDasharray="3 3" />
          <line x1="20" y1="100" x2="490" y2="100" stroke="#1e293b" strokeDasharray="3 3" />
          <line x1="20" y1="180" x2="490" y2="180" stroke="#334155" />
          <path d="M 20 180 Q 90 170, 160 145 T 320 60 T 480 20" fill="none" stroke="#00f0ff" strokeWidth="2" strokeDasharray="4 4" opacity="0.3" />
          <path d={`M 20 180 Q 90 170, ${Math.min(currentX, 160)} ${Math.max(currentY, 145)} T ${currentX} ${currentY}`} fill="none" stroke="#10b981" strokeWidth="3" />
          <circle cx={currentX} cy={currentY} r="6" fill="#00f0ff" />
        </svg>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5">
        {config.milestones.map((m) => (
          <div
            key={m.id}
            className={`p-2 rounded-lg border text-center ${
              telemetry.activePhase === m.id
                ? "bg-cyan-950/90 border-cyan-400 text-cyan-200"
                : telemetry.activePhase >= m.id
                ? "bg-[#0e1628] border-emerald-800 text-emerald-400"
                : "bg-[#0e1628]/40 border-slate-800 text-slate-500"
            }`}
          >
            <div className="text-[9px] text-slate-400">{m.t}</div>
            <div className="text-[10px] font-bold truncate mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- VIDEO CINEMA HUD OVERLAY COMPONENT ---
function VideoCinemaHUD({ launch, elapsedSeconds, isPlayingFlight, onTogglePlay, onSetElapsed, config }) {
  const telemetry = computeTelemetry(elapsedSeconds, config);
  const videoUrl = launch?.vidURLs?.[0]?.url || launch?.webcast_live_url || null;
  const youtubeId = videoUrl ? videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/)?.[1] : null;

  return (
    <div className="flex-1 flex flex-col space-y-3 font-mono">
      <div className="relative aspect-video rounded-2xl overflow-hidden border border-cyan-500/40 bg-black shadow-2xl">
        {youtubeId ? (
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1&enablejsapi=1`}
            title="Launch Webcast Stream"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full pointer-events-auto"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-500 text-xs">
            <Tv className="w-8 h-8 mb-2 text-cyan-400/40 animate-pulse" />
            <span>Launch Webcast Stream Carrier Signal Offline</span>
          </div>
        )}

        {/* Live Glass HUD Overlay Top-Left */}
        <div className="absolute top-3 left-3 z-20 bg-black/75 backdrop-blur-md border border-cyan-500/50 p-2.5 rounded-xl shadow-lg pointer-events-none text-left min-w-[190px]">
          <div className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-bold uppercase tracking-wider mb-1">
            <Activity className="w-3 h-3 text-cyan-400 animate-pulse" /> Telemetry Virtual HUD
          </div>
          <div className="text-base font-bold text-white leading-tight">
            {telemetry.velocity.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">km/h</span>
          </div>
          <div className="text-xs text-emerald-400 font-semibold">
            ALT: {telemetry.altitude} km &bull; DST: {telemetry.downrange} km
          </div>
          <div className="text-[10px] text-amber-300 mt-0.5">
            G-FORCE: {telemetry.gForce}G | THRTL: {telemetry.throttle}%
          </div>
        </div>

        {/* Live Staging Phase Callout Top-Right */}
        <div className="absolute top-3 right-3 z-20 bg-black/75 backdrop-blur-md border border-slate-700 p-2 rounded-xl text-right pointer-events-none max-w-[210px]">
          <div className="text-[9px] text-slate-400 uppercase">Mission Elapsed</div>
          <div className="text-cyan-300 font-bold text-sm">T+{elapsedSeconds}s</div>
          <div className="text-[10px] text-emerald-400 truncate mt-0.5 font-bold">
            {telemetry.currentEvent}
          </div>
        </div>

        {/* Bottom Max-Q & Trajectory Status Bar */}
        <div className="absolute bottom-3 left-3 right-3 z-20 bg-black/75 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-xl flex items-center justify-between text-[11px] pointer-events-none">
          <span className="text-slate-300">Phase {telemetry.activePhase} / 7 Active</span>
          <span className="text-cyan-400 font-semibold">Max-Q Aero Load: Nominal</span>
          <span className="text-slate-400">LEO Insertion Window</span>
        </div>
      </div>

      {/* Sync Timeline Scrubber Controls */}
      <div className="flex items-center justify-between bg-[#060913] border border-slate-800 p-3 rounded-xl">
        <button
          onClick={onTogglePlay}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
            isPlayingFlight ? "bg-amber-500 text-black font-bold" : "bg-cyan-500 text-black font-bold"
          }`}
        >
          <Play className="w-3.5 h-3.5" /> {isPlayingFlight ? "Pause HUD Sync" : "Sync HUD to Stream"}
        </button>

        <div className="flex items-center gap-2 w-1/2">
          <input
            type="range"
            min="0"
            max={config.maxFlightTime}
            value={elapsedSeconds}
            onChange={(e) => onSetElapsed(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
          <span className="text-cyan-300 font-bold text-xs shrink-0">T+{elapsedSeconds}s</span>
        </div>

        <button
          onClick={() => onSetElapsed(0)}
          className="text-xs bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg text-slate-300 border border-slate-700 cursor-pointer"
        >
          Reset T-0
        </button>
      </div>
    </div>
  );
}

function useCountdown(targetDate, voiceEnabled) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, isPast: false });
  const lastSpokenSec = useRef(null);

  useEffect(() => {
    if (!targetDate) return;
    const updateTimer = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      const absDiff = Math.abs(diff);
      const totalSec = Math.floor(diff / 1000);

      setTimeLeft({
        days: Math.floor(absDiff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((absDiff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((absDiff / 1000 / 60) % 60),
        seconds: Math.floor((absDiff / 1000) % 60),
        isPast: diff < 0,
      });

      if (voiceEnabled && totalSec >= 0 && totalSec <= 10 && lastSpokenSec.current !== totalSec) {
        lastSpokenSec.current = totalSec;
        if (totalSec > 0) {
          playVoiceCallout(totalSec.toString());
        } else if (totalSec === 0) {
          playVoiceCallout("Main engine ignition... Liftoff!");
          playRumbleSound();
        }
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [targetDate, voiceEnabled]);

  return timeLeft;
}

function LaunchCard({ launch, onSelect, voiceEnabled, onSimulateCountdown, isArchive, isBookmarked, onToggleBookmark }) {
  const countdown = useCountdown(launch.net, voiceEnabled);
  const statusName = launch.status?.name || "TBD";
  const isSuccess = statusName === "Launch Successful" || statusName === "Go for Launch";
  const orbitProfile = getMissionFlightConfig(launch);

  return (
    <div className="bg-[#0e1628] border border-slate-800/90 rounded-2xl overflow-hidden hover:border-cyan-500/60 transition-all flex flex-col justify-between shadow-xl">
      <div className="p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 bg-cyan-950/80 px-2.5 py-1 rounded border border-cyan-800/60 truncate max-w-[50%]">
            {launch.launch_service_provider?.name || "Agency"}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onToggleBookmark(launch.id)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isBookmarked 
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/50" 
                  : "bg-slate-800/50 text-slate-400 border-slate-700/60 hover:text-white"
              }`}
              title={isBookmarked ? "Remove from Watchlist" : "Save to Watchlist"}
            >
              <Star className={`w-3.5 h-3.5 ${isBookmarked ? "fill-amber-400 text-amber-400" : ""}`} />
            </button>
            <span className={`text-xs px-2.5 py-1 rounded font-medium ${isSuccess ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/60" : "bg-amber-950/80 text-amber-400 border border-amber-800/60"}`}>
              {statusName}
            </span>
          </div>
        </div>

        <h3 onClick={() => onSelect(launch)} className="text-lg font-bold text-slate-100 mb-1 line-clamp-2 cursor-pointer hover:text-cyan-300">
          {launch.name}
        </h3>

        <div className="text-[11px] text-cyan-400 font-mono mb-3">
          Target: {orbitProfile.type}
        </div>

        <div className="flex items-center text-xs text-slate-400 gap-1.5 mb-4">
          <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="truncate">{launch.pad?.location?.name || "Unknown Pad"}</span>
        </div>

        <div className="bg-[#060913] rounded-xl p-3 border border-slate-800/80 text-center relative overflow-hidden">
          <div className="text-[11px] uppercase tracking-widest text-slate-400 mb-1.5 font-semibold flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            {isArchive ? "Mission Elapsed" : countdown.isPast ? "T-Plus (Elapsed)" : "T-Minus Countdown"}
          </div>

          <div className="grid grid-cols-4 gap-1 text-center font-mono mb-2">
            <div><div className="text-base font-bold text-cyan-300">{countdown.days}</div><div className="text-[10px] text-slate-500">DAYS</div></div>
            <div><div className="text-base font-bold text-cyan-300">{countdown.hours}</div><div className="text-[10px] text-slate-500">HRS</div></div>
            <div><div className="text-base font-bold text-cyan-300">{countdown.minutes}</div><div className="text-[10px] text-slate-500">MIN</div></div>
            <div><div className="text-base font-bold text-cyan-300">{countdown.seconds}</div><div className="text-[10px] text-slate-500">SEC</div></div>
          </div>

          {!isArchive && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                onClick={() => onSimulateCountdown(launch)}
                className="bg-[#131d36] hover:bg-cyan-950 text-cyan-300 border border-cyan-800/60 text-[11px] font-semibold py-1 rounded flex items-center justify-center gap-1 cursor-pointer"
              >
                <Play className="w-3 h-3 text-cyan-400" /> Audio T-10s
              </button>
              <button
                onClick={() => downloadCalendarInvite(launch)}
                className="bg-[#131d36] hover:bg-cyan-950 text-cyan-300 border border-cyan-800/60 text-[11px] font-semibold py-1 rounded flex items-center justify-center gap-1 cursor-pointer"
              >
                <Calendar className="w-3 h-3 text-cyan-400" /> .ICS Sync
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#090f1d] px-5 py-3 border-t border-slate-800/90 flex items-center justify-between text-xs text-slate-400">
        <span className="font-mono">
          {new Date(launch.net).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button 
          onClick={() => onSelect(launch)}
          className="text-cyan-400 font-bold hover:translate-x-1 transition-transform inline-flex items-center gap-1 cursor-pointer"
        >
          Flight Telemetry &amp; 3D &rarr;
        </button>
      </div>
    </div>
  );
}

// --- ADVANCED RADAR MAP WITH REAL-TIME SOLAR TERMINATOR ---
function AdvancedLaunchPadMap({ launches, onSelect, issData }) {
  const [mapStyle, setMapStyle] = useState("dark");
  const [showTerminator, setShowTerminator] = useState(true);

  const solarData = useMemo(() => computeSolarTerminatorPoints(), []);

  const tileLayers = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  };

  const validLaunches = useMemo(() => launches.filter((l) => l.pad?.latitude && l.pad?.longitude), [launches]);

  const trajectoryVectors = useMemo(() => {
    return validLaunches.map((launch) => {
      const lat = parseFloat(launch.pad.latitude);
      const lon = parseFloat(launch.pad.longitude);
      const config = getMissionFlightConfig(launch);

      let points = [
        [lat, lon],
        [lat + 4, lon + 18],
        [lat + 8, lon + 38],
        [lat + 11, lon + 60],
      ];
      if (config.type.includes("Polar") || config.type.includes("SSO")) {
        points = [[lat, lon], [lat - 12, lon + 1.5], [lat - 28, lon + 3], [lat - 48, lon + 5]];
      }

      return { id: launch.id, points, type: config.type };
    });
  }, [validLaunches]);

  return (
    <div className="relative w-full h-[650px] rounded-2xl overflow-hidden border border-cyan-500/30 shadow-2xl bg-[#060913]">
      <div className="absolute top-4 right-4 z-[400] flex items-center gap-2 bg-[#0d1527]/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-700/80 shadow-lg">
        <button
          onClick={() => setShowTerminator(!showTerminator)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5 transition-all ${
            showTerminator ? "bg-cyan-500 text-black font-bold" : "text-slate-300 hover:text-white"
          }`}
        >
          {showTerminator ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          {showTerminator ? "Solar Terminator: Active" : "Terminator: Hidden"}
        </button>
        <button
          onClick={() => setMapStyle("dark")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${mapStyle === "dark" ? "bg-cyan-500 text-black font-bold" : "text-slate-300"}`}
        >
          Tactical Dark
        </button>
        <button
          onClick={() => setMapStyle("satellite")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${mapStyle === "satellite" ? "bg-cyan-500 text-black font-bold" : "text-slate-300"}`}
        >
          Satellite Recon
        </button>
      </div>

      {issData && (
        <div className="absolute top-4 left-4 z-[400] bg-[#0d1527]/90 backdrop-blur-md px-4 py-3 rounded-xl border border-rose-500/40 shadow-lg text-xs flex flex-col gap-1 font-mono">
          <div className="flex items-center gap-2 text-rose-400 font-bold uppercase tracking-wider text-[11px]">
            <Satellite className="w-4 h-4 animate-spin" /> ISS Live Orbital Position
          </div>
          <div className="text-slate-300">
            Lat: <span className="text-cyan-300">{issData.latitude.toFixed(2)}°</span> | Lon: <span className="text-cyan-300">{issData.longitude.toFixed(2)}°</span>
          </div>
          <div className="text-slate-400 text-[10px]">
            Alt: <span className="text-white">{issData.altitude.toFixed(1)} km</span> | Speed: <span className="text-white">{Math.round(issData.velocity)} km/h</span>
          </div>
        </div>
      )}

      <MapContainer center={[20, 0]} zoom={2.5} minZoom={2} maxZoom={14} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution='&copy; CARTO &amp; ESRI' url={tileLayers[mapStyle]} />

        {showTerminator && (
          <>
            <Polygon
              positions={solarData.polygonPoints}
              pathOptions={{
                color: "#0369a1",
                fillColor: "#020617",
                fillOpacity: 0.45,
                weight: 1,
              }}
            />
            <Polyline
              positions={solarData.linePoints}
              pathOptions={{
                color: "#f59e0b",
                weight: 2,
                dashArray: "4, 6",
                opacity: 0.8
              }}
            />
          </>
        )}

        {issData && (
          <Marker position={[issData.latitude, issData.longitude]} icon={issIcon}>
            <Popup>
              <div className="p-1 min-w-[180px] font-mono">
                <span className="text-[10px] uppercase font-bold text-rose-400 block mb-1">International Space Station</span>
                <p className="text-xs text-slate-200">Speed: {Math.round(issData.velocity)} km/h</p>
                <p className="text-xs text-slate-200">Altitude: {issData.altitude.toFixed(1)} km</p>
              </div>
            </Popup>
          </Marker>
        )}

        {trajectoryVectors.map((traj) => (
          <Polyline
            key={traj.id}
            positions={traj.points}
            pathOptions={{
              color: traj.type.includes("Polar") ? "#f59e0b" : "#00f0ff",
              weight: 2,
              opacity: 0.6,
              dashArray: "6, 8",
            }}
          />
        ))}

        {validLaunches.map((launch) => {
          const lat = parseFloat(launch.pad.latitude);
          const lon = parseFloat(launch.pad.longitude);
          const solarStatus = getPadDaylightStatus(lat, lon, solarData.sunLng, solarData.declination);

          return (
            <React.Fragment key={launch.id}>
              <CircleMarker
                center={[lat, lon]}
                radius={24}
                pathOptions={{
                  color: "#00f0ff",
                  fillColor: "#00f0ff",
                  fillOpacity: 0.1,
                  weight: 1,
                }}
              />
              <Marker position={[lat, lon]} icon={createRadarIcon(launch.status?.name)}>
                <Popup>
                  <div className="p-2 min-w-[220px]">
                    <span className="text-[10px] uppercase font-bold text-cyan-400 block mb-1">
                      {launch.launch_service_provider?.name || "Global Service"}
                    </span>
                    <h4 className="text-sm font-bold text-white mb-1">{launch.name}</h4>
                    <div className="text-[10px] mb-2 font-mono flex items-center gap-1.5 text-slate-300">
                      {solarStatus.isDay ? <Sun className="w-3 h-3 text-amber-400" /> : <Moon className="w-3 h-3 text-cyan-400" />}
                      <span>Pad Condition: <strong className="text-white">{solarStatus.label}</strong></span>
                    </div>

                    <button
                      onClick={() => onSelect(launch)}
                      className="w-full bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold py-1.5 px-3 rounded-lg transition-colors mt-1 cursor-pointer"
                    >
                      Inspect Flight HUD &amp; 3D
                    </button>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}

// --- MODAL WITH SATELLITE INSPECTION ---
function LaunchModal({ launch, onClose }) {
  if (!launch) return null;
  return <LaunchModalContent launch={launch} onClose={onClose} />;
}

function LaunchModalContent({ launch, onClose }) {
  const [modalTab, setModalTab] = useState("video"); // Starts in Video Cinema HUD mode
  const [flightElapsed, setFlightElapsed] = useState(70);
  const [isPlayingFlight, setIsPlayingFlight] = useState(false);
  const [isCutaway, setIsCutaway] = useState(true);
  const [weather, setWeather] = useState(null);

  const config = useMemo(() => getMissionFlightConfig(launch), [launch]);
  const satSpecs = useMemo(() => getSatelliteSpecs(launch), [launch]);

  useEffect(() => {
    let interval = null;
    if (isPlayingFlight) {
      interval = setInterval(() => {
        setFlightElapsed((prev) => (prev >= config.maxFlightTime ? 0 : prev + 2));
      }, 80);
    }
    return () => clearInterval(interval);
  }, [isPlayingFlight, config.maxFlightTime]);

  useEffect(() => {
    if (!launch?.pad?.latitude || !launch?.pad?.longitude) return;
    const fetchPadWeather = async () => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${launch.pad.latitude}&longitude=${launch.pad.longitude}&current=temperature_2m,wind_speed_10m,precipitation&timezone=auto`
        );
        if (res.ok) {
          const data = await res.json();
          setWeather(data.current);
        }
      } catch {
        setWeather(null);
      }
    };
    fetchPadWeather();
  }, [launch]);

  const rocketTitle = launch.rocket?.configuration?.name || launch.name || "Orbital Rocket";

  return (
    <div className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0e1628] border border-cyan-500/40 rounded-2xl max-w-4xl w-full p-6 shadow-2xl relative text-slate-200 max-h-[94vh] flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer z-30">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400 bg-cyan-950/90 px-3 py-1 rounded border border-cyan-800/60">
            {launch.launch_service_provider?.name}
          </span>
          <span className="text-xs px-3 py-1 rounded bg-slate-800 text-slate-300 font-medium">
            {launch.status?.name}
          </span>
        </div>

        <h2 className="text-2xl font-bold text-white mb-1">{launch.name}</h2>
        <div className="text-xs text-slate-400 mb-3 flex items-center gap-2">
          <span>Target Regime: <strong className="text-cyan-400">{config.type}</strong></span>
          <span>&bull;</span>
          <span>Perigee &times; Apogee: <strong className="text-white">{config.insertionAlt} &times; {config.targetAlt.toLocaleString()} km</strong></span>
        </div>

        {/* Modal Tab Bar with Webcast HUD */}
        <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3 flex-wrap">
          <button
            onClick={() => setModalTab("video")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "video" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            <Tv className="w-3.5 h-3.5" /> Webcast Cinema HUD
          </button>
          <button
            onClick={() => setModalTab("3d")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "3d" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            <Box className="w-3.5 h-3.5" /> 3D Rocket &amp; Payload View
          </button>
          <button
            onClick={() => setModalTab("telemetry")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "telemetry" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            <Gauge className="w-3.5 h-3.5" /> Flight Profiler HUD
          </button>
          <button
            onClick={() => setModalTab("overview")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "overview" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "bg-slate-800/60 text-slate-400 hover:text-white"
            }`}
          >
            <Eye className="w-3.5 h-3.5" /> Specs &amp; Pad Weather
          </button>
        </div>

        {/* TAB 1: WEBCAST CINEMA HUD */}
        {modalTab === "video" && (
          <VideoCinemaHUD 
            launch={launch}
            elapsedSeconds={flightElapsed}
            isPlayingFlight={isPlayingFlight}
            onTogglePlay={() => setIsPlayingFlight(!isPlayingFlight)}
            onSetElapsed={setFlightElapsed}
            config={config}
          />
        )}

        {/* TAB 2: 3D INSPECTION */}
        {modalTab === "3d" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 h-[420px] overflow-y-auto">
            <div className="md:col-span-2 bg-[#060913] rounded-2xl border border-cyan-500/30 relative overflow-hidden h-[400px]">
              <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 font-mono text-[10px]">
                <span className="bg-cyan-950/80 text-cyan-300 px-2 py-0.5 rounded border border-cyan-800/60 font-bold">
                  VEHICLE: {rocketTitle.toUpperCase()}
                </span>
                <span className="bg-[#0e1628]/90 text-amber-300 px-2 py-0.5 rounded border border-amber-800/60">
                  PAYLOAD: {satSpecs.type}
                </span>
              </div>

              <button
                onClick={() => setIsCutaway(!isCutaway)}
                className="absolute bottom-3 right-3 z-10 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-500 text-black hover:bg-cyan-400 transition-all cursor-pointer shadow-lg flex items-center gap-1"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isCutaway ? "Solid Fairing" : "Cutaway (Reveal Satellite)"}
              </button>

              <Canvas camera={{ position: [0, 2.2, 4.2], fov: 45 }}>
                <ambientLight intensity={0.8} />
                <directionalLight position={[10, 10, 5]} intensity={1.5} />
                <Suspense fallback={null}>
                  <DynamicRocket3D
                    rocketName={rocketTitle}
                    satelliteVariant={satSpecs.meshVariant}
                    isCutaway={isCutaway}
                  />
                </Suspense>
                <OrbitControls enablePan={false} />
              </Canvas>
            </div>

            <div className="bg-[#060913] rounded-2xl border border-slate-800 p-4 text-xs font-mono space-y-2.5 h-[400px] overflow-y-auto">
              <div className="text-cyan-400 font-bold uppercase mb-2">Payload Technical Specs</div>
              <div className="p-2 rounded bg-[#0e1628]"><span className="text-slate-400 block text-[10px]">SATELLITE ARCHITECTURE</span><span className="text-cyan-300 font-bold">{satSpecs.type}</span></div>
              <div className="p-2 rounded bg-[#0e1628]"><span className="text-slate-400 block text-[10px]">CHASSIS / BUS</span><span className="text-slate-200">{satSpecs.bus}</span></div>
              <div className="p-2 rounded bg-[#0e1628]"><span className="text-slate-400 block text-[10px]">PAYLOAD MASS</span><span className="text-emerald-400 font-bold">{satSpecs.mass}</span></div>
              <div className="p-2 rounded bg-[#0e1628]"><span className="text-slate-400 block text-[10px]">POWER ARRAYS</span><span className="text-slate-300">{satSpecs.power}</span></div>
              <div className="p-2 rounded bg-[#0e1628]"><span className="text-slate-400 block text-[10px]">INSTRUMENTS</span><span className="text-slate-300">{satSpecs.instruments}</span></div>
            </div>
          </div>
        )}

        {/* TAB 3: FLIGHT PROFILER HUD */}
        {modalTab === "telemetry" && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            <div className="flex items-center justify-between bg-[#060913] border border-slate-800 p-3 rounded-xl">
              <button
                onClick={() => setIsPlayingFlight(!isPlayingFlight)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                  isPlayingFlight ? "bg-amber-500 text-black" : "bg-cyan-500 text-black"
                }`}
              >
                <Play className="w-3.5 h-3.5" /> {isPlayingFlight ? "Pause Trajectory" : "Simulate Flight Telemetry"}
              </button>
              <input
                type="range"
                min="0"
                max={config.maxFlightTime}
                value={flightElapsed}
                onChange={(e) => setFlightElapsed(Number(e.target.value))}
                className="w-1/2 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-xs text-cyan-300">T+{flightElapsed}s</span>
            </div>
            <FlightTrajectoryHUD elapsedSeconds={flightElapsed} launch={launch} />
          </div>
        )}

        {/* TAB 4: SPECS & WEATHER */}
        {modalTab === "overview" && (
          <div className="overflow-y-auto pr-2 space-y-4 flex-1">
            <div className="bg-[#060913] border border-slate-800 rounded-xl p-3">
              <span className="text-xs font-bold uppercase text-cyan-400 block mb-2">Pad Atmospheric Conditions</span>
              {weather ? (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-[#0e1628] p-2 rounded-lg border border-slate-800">{weather.temperature_2m}°C</div>
                  <div className="bg-[#0e1628] p-2 rounded-lg border border-slate-800">{weather.wind_speed_10m} km/h</div>
                  <div className="bg-[#0e1628] p-2 rounded-lg border border-slate-800">{weather.precipitation} mm</div>
                </div>
              ) : (
                <div className="text-xs text-slate-500">Weather data unavailable for this complex.</div>
              )}
            </div>

            <p className="leading-relaxed bg-[#060913] p-4 rounded-xl border border-slate-800 text-slate-300 text-sm">
              {launch.mission?.description || "Mission telemetry is recorded directly from orbital trajectory manifests."}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-800 mt-4">
          <button
            onClick={() => downloadCalendarInvite(launch)}
            className="inline-flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 px-3.5 py-2 rounded-lg font-semibold border border-cyan-800/50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export to Calendar (.ics)
          </button>
          {launch.pad?.wiki_url && (
            <a 
              href={launch.pad.wiki_url} 
              target="_blank" 
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 rounded-lg font-bold transition-colors"
            >
              Pad History <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// --- MAIN APPLICATION ENTRY ---
export default function App() {
  const [launches, setLaunches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("All");
  const [selectedLaunch, setSelectedLaunch] = useState(null);
  const [viewMode, setViewMode] = useState("grid");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [issData, setIssData] = useState(null);
  const [missionTab, setMissionTab] = useState("upcoming");

  const [bookmarkedIds, setBookmarkedIds] = useState(() => {
    try {
      const saved = localStorage.getItem("tracked_space_launches");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleBookmark = (id) => {
    setBookmarkedIds((prev) => {
      const updated = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      try {
        localStorage.setItem("tracked_space_launches", JSON.stringify(updated));
      } catch {
        // quota
      }
      return updated;
    });
  };

  const fetchLaunches = async (type = missionTab) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = type === "previous" 
        ? "https://ll.thespacedevs.com/2.2.0/launch/previous/?limit=25" 
        : "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=25";

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Could not fetch launch telemetry data");
      const data = await res.json();
      setLaunches(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (missionTab !== "watchlist") {
      fetchLaunches(missionTab);
    }
  }, [missionTab]);

  useEffect(() => {
    const fetchIss = async () => {
      try {
        const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544");
        if (res.ok) {
          const data = await res.json();
          setIssData({
            latitude: data.latitude,
            longitude: data.longitude,
            altitude: data.altitude,
            velocity: data.velocity,
          });
        }
      } catch {
        // silent
      }
    };
    fetchIss();
    const interval = setInterval(fetchIss, 3500);
    return () => clearInterval(interval);
  }, []);

  const handleSimulateCountdown = (launch) => {
    const simulatedDate = new Date(Date.now() + 10000).toISOString();
    setLaunches((prev) =>
      prev.map((l) => (l.id === launch.id ? { ...l, net: simulatedDate } : l))
    );
    playVoiceCallout("T-minus 10 seconds and counting");
  };

  const providers = useMemo(() => {
    const set = new Set(launches.map((l) => l.launch_service_provider?.name).filter(Boolean));
    return ["All", ...Array.from(set)];
  }, [launches]);

  const filteredLaunches = useMemo(() => {
    return launches.filter((launch) => {
      const matchesSearch = 
        launch.name?.toLowerCase().includes(search.toLowerCase()) ||
        launch.pad?.location?.name?.toLowerCase().includes(search.toLowerCase()) ||
        launch.launch_service_provider?.name?.toLowerCase().includes(search.toLowerCase());
      
      const matchesProvider = 
        selectedProvider === "All" || launch.launch_service_provider?.name === selectedProvider;

      const matchesWatchlist = missionTab !== "watchlist" || bookmarkedIds.includes(launch.id);

      return matchesSearch && matchesProvider && matchesWatchlist;
    });
  }, [launches, search, selectedProvider, missionTab, bookmarkedIds]);

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800/80 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Rocket className="w-7 h-7 text-cyan-400" />
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                Orbital Telemetry &amp; Spaceport Radar
              </h1>
            </div>
            <p className="text-sm text-slate-400">
              Live orbital manifestations, mission-specific staging profiles, 3D rocket payloads &amp; ISS radar
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-[#0e1628] border border-slate-800 rounded-xl p-1 flex items-center shadow-lg">
              <button
                onClick={() => setMissionTab("upcoming")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  missionTab === "upcoming" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "text-slate-400 hover:text-white"
                }`}
              >
                <Rocket className="w-3.5 h-3.5" /> Upcoming
              </button>
              <button
                onClick={() => setMissionTab("previous")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  missionTab === "previous" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "text-slate-400 hover:text-white"
                }`}
              >
                <History className="w-3.5 h-3.5" /> Completed
              </button>
              <button
                onClick={() => setMissionTab("watchlist")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  missionTab === "watchlist" ? "bg-amber-400 text-black shadow-md shadow-amber-400/30" : "text-slate-400 hover:text-white"
                }`}
              >
                <Star className="w-3.5 h-3.5 fill-current" /> Watchlist ({bookmarkedIds.length})
              </button>
            </div>

            <button
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                voiceEnabled ? "bg-emerald-950/80 text-emerald-300 border-emerald-700" : "bg-slate-900 text-slate-400 border-slate-800"
              }`}
            >
              {voiceEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>

            <div className="bg-[#0e1628] border border-slate-800 rounded-xl p-1 flex items-center shadow-lg">
              <button
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "grid" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "text-slate-400 hover:text-white"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Cards
              </button>
              <button
                onClick={() => setViewMode("map")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "map" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30" : "text-slate-400 hover:text-white"
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" /> Radar Map
              </button>
            </div>

            <button
              onClick={() => fetchLaunches(missionTab === "watchlist" ? "upcoming" : missionTab)}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all border border-cyan-400/30 shadow-lg cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Sync
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter missions by rocket, agency, or spaceport..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0e1628] border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors shadow-inner"
            />
          </div>

          <div className="relative">
            <Filter className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full bg-[#0e1628] border border-slate-800 rounded-xl pl-10 pr-8 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer appearance-none shadow-inner"
            >
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-950/40 border border-red-800 rounded-2xl text-red-300 text-sm mb-6 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span>Telemetry error: {error}</span>
          </div>
        )}

        {loading && (
          <div className="h-[550px] bg-[#0e1628] animate-pulse rounded-2xl border border-slate-800 flex items-center justify-center">
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" /> Synchronizing Missions...
            </div>
          </div>
        )}

        {!loading && (
          <>
            {filteredLaunches.length === 0 && missionTab === "watchlist" ? (
              <div className="h-64 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-2xl text-slate-400 font-mono text-sm gap-2">
                <Star className="w-6 h-6 text-amber-400/60" />
                <span>Your Watchlist is empty. Click the star icon on any launch card to pin missions here.</span>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredLaunches.map((launch) => (
                  <LaunchCard 
                    key={launch.id} 
                    launch={launch} 
                    isArchive={missionTab === "previous"}
                    voiceEnabled={voiceEnabled}
                    onSimulateCountdown={handleSimulateCountdown}
                    onSelect={(selected) => setSelectedLaunch(selected)}
                    isBookmarked={bookmarkedIds.includes(launch.id)}
                    onToggleBookmark={toggleBookmark}
                  />
                ))}
              </div>
            ) : (
              <AdvancedLaunchPadMap 
                launches={filteredLaunches} 
                issData={issData}
                onSelect={(selected) => setSelectedLaunch(selected)}
              />
            )}
          </>
        )}

        <LaunchModal launch={selectedLaunch} onClose={() => setSelectedLaunch(null)} />
      </div>
    </div>
  );
}