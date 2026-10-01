import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { 
  Rocket, MapPin, Clock, RefreshCw, Search, Filter, 
  ExternalLink, X, Map as MapIcon, 
  LayoutGrid, Activity, Volume2, VolumeX, Play, Satellite,
  History, CheckCircle2, XCircle, Wind, CloudRain, Thermometer,
  Calendar, Download, Gauge, Compass, Zap, Sparkles, Box, Eye,
  Sun, Moon, Star, Tv, ShieldAlert, ShieldCheck, FastForward, RotateCcw,
  AlertTriangle, Radio, Crosshair, Mic, Terminal, ChevronRight, Orbit
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Polygon } from "react-leaflet";
import L from "leaflet";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

// --- DEBRIS CLOUDS & ACTIVE SATELLITE CATALOG ---
const HIGH_RISK_DEBRIS_TRACKS = [
  { id: "deb-1", name: "COSMOS 2251 DEB (NORAD 34112)", lat: 52.1, lon: 44.8, alt: 418, inc: 74.0, speed: 7.68 },
  { id: "deb-2", name: "FENGYUN 1C DEB (NORAD 30225)", lat: -34.5, lon: 112.4, alt: 422, inc: 98.6, speed: 7.71 },
  { id: "deb-3", name: "CZ-3B R/B FRAGMENT (NORAD 42981)", lat: 14.2, lon: -62.1, alt: 415, inc: 28.5, speed: 7.66 }
];

function computeConjunctionRisk(issPos, debrisList) {
  if (!issPos) return [];

  return debrisList.map((item) => {
    const R = 6371;
    const dLat = ((item.lat - issPos.latitude) * Math.PI) / 180;
    const dLon = ((item.lon - issPos.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((issPos.latitude * Math.PI) / 180) *
      Math.cos((item.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const surfaceDist = R * c;

    const altDiff = Math.abs(item.alt - issPos.altitude);
    const missDistance = Math.round(Math.sqrt(surfaceDist * surfaceDist + altDiff * altDiff));

    const relativeSpeed = parseFloat((Math.abs(item.speed - (issPos.velocity / 3600)) + 6.2).toFixed(2));
    const tcaSec = Math.max(12, Math.round(missDistance / relativeSpeed));
    const isCritical = missDistance < 90;

    return {
      ...item,
      missDistance,
      relativeSpeed,
      tcaSec,
      isCritical,
      probability: isCritical ? "4.8e-04 (HIGH)" : "1.2e-06 (NOMINAL)"
    };
  }).sort((a, b) => a.missDistance - b.missDistance);
}

// --- CAPCOM RADIO & QUINDAR AUDIO ENGINE ---
const playQuindarTone = (isIntro = true) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(isIntro ? 2525 : 2475, ctx.currentTime);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // blocked
  }
};

const playCapComVoice = (text) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  playQuindarTone(true);

  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 0.82;
    utterance.rate = 1.05;
    utterance.onend = () => playQuindarTone(false);
    window.speechSynthesis.speak(utterance);
  }, 220);
};

const playRumbleSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const bufferSize = ctx.sampleRate * 2.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.8;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(140, ctx.currentTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 2.5);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + 2.5);
  } catch {
    // blocked
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

// --- RANGE SAFETY EVALUATION ---
function evaluateGoNoGoStatus(weather) {
  if (!weather) {
    return {
      status: "CALCULATING",
      score: 50,
      badgeColor: "bg-slate-900/80 text-slate-400 border-slate-700",
      reasons: ["Atmospheric telemetry acquisition in progress..."],
      windSafe: true,
      rainSafe: true,
      tempSafe: true,
    };
  }

  let score = 100;
  const reasons = [];

  const isHighWind = weather.wind_speed_10m > 33;
  const isModerateWind = weather.wind_speed_10m > 22;
  if (isHighWind) {
    score -= 45;
    reasons.push(`Surface wind (${weather.wind_speed_10m} km/h) exceeds safe threshold (max 33 km/h). High wind shear risk.`);
  } else if (isModerateWind) {
    score -= 15;
    reasons.push(`Moderate surface winds (${weather.wind_speed_10m} km/h). Monitored for shear oscillations.`);
  }

  const isRaining = weather.precipitation > 0.1;
  if (isRaining) {
    score -= 50;
    reasons.push(`Precipitation detected (${weather.precipitation} mm). Flight corridor violates range lightning rule.`);
  }

  const isFreezing = weather.temperature_2m < 2;
  const isTooHot = weather.temperature_2m > 42;
  if (isFreezing) {
    score -= 40;
    reasons.push(`Pad temperature (${weather.temperature_2m}°C) below 2°C margin. Risk of elastomer/O-ring stiffening.`);
  } else if (isTooHot) {
    score -= 20;
    reasons.push(`Extreme heat (${weather.temperature_2m}°C) reduces engine cooling margins and air density.`);
  }

  let status = "GO FOR LAUNCH";
  let badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.2)]";

  if (score < 55) {
    status = "SCRUB / NO-GO";
    badgeColor = "bg-rose-500/10 text-rose-400 border-rose-500/60 shadow-[0_0_15px_rgba(244,63,94,0.2)]";
  } else if (score < 80) {
    status = "WEATHER HOLD";
    badgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.2)]";
  }

  return {
    status,
    score: Math.max(0, score),
    badgeColor,
    reasons: reasons.length > 0 ? reasons : ["All atmospheric and range parameters nominal. Flight envelope clear."],
    windSafe: !isHighWind,
    rainSafe: !isRaining,
    tempSafe: !isFreezing && !isTooHot,
  };
}

// --- SOLAR TERMINATOR ---
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
  if (altitudeDeg > -6) return { label: "Civil Twilight", isDay: false };
  return { label: "Night Window", isDay: false };
}

// --- MAP ICONS ---
const createRadarIcon = (status) => {
  const isSuccess = status === "Launch Successful" || status === "Go for Launch";
  const glowColor = isSuccess ? "#10b981" : status?.toLowerCase().includes("fail") ? "#f43f5e" : "#00f0ff";
  return new L.DivIcon({
    className: "beacon-pulse",
    html: `
      <div class="relative flex items-center justify-center">
        <span class="absolute w-5 h-5 rounded-full animate-ping opacity-75" style="background: ${glowColor};"></span>
        <div style="background: ${glowColor}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 14px ${glowColor};"></div>
      </div>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
};

const issIcon = new L.DivIcon({
  className: "iss-beacon",
  html: `
    <div class="relative flex items-center justify-center">
      <span class="absolute w-7 h-7 rounded-full bg-rose-500 animate-ping opacity-60"></span>
      <div style="background: #f43f5e; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 16px #f43f5e; display: flex; align-items: center; justify-content: center;">
        <div style="width: 5px; height: 5px; background: white; border-radius: 50%;"></div>
      </div>
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const debrisIcon = new L.DivIcon({
  className: "debris-beacon",
  html: `<div style="background: #eab308; width: 11px; height: 11px; border-radius: 2px; border: 1.5px solid #ffffff; box-shadow: 0 0 10px #eab308; transform: rotate(45deg);"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function getSatelliteSpecs(launch) {
  const name = (launch?.name || "").toLowerCase();
  const desc = (launch?.mission?.description || "").toLowerCase();
  const orbit = (launch?.mission?.orbit?.name || "").toLowerCase();

  if (name.includes("starlink") || desc.includes("starlink")) {
    return {
      type: "Starlink Constellation Stack",
      bus: "SpaceX Starlink v2 Mini",
      mass: "~16,500 kg (Full Batch)",
      power: "Deployable Photovoltaic Array",
      instruments: "Ku/Ka Band Phased Arrays, Intersatellite Laser Links",
      dispenser: "Rotational Tensioner Mechanical Dispenser",
      meshVariant: "starlink"
    };
  }

  if (orbit.includes("gto") || orbit.includes("geo") || name.includes("tel") || name.includes("sat") || desc.includes("telecom")) {
    return {
      type: "Geostationary Comms Sat",
      bus: "Eurostar E3000 / Spacebus Neo",
      mass: "4,500 - 6,500 kg",
      power: "Dual High-Efficiency Wings (15 kW)",
      instruments: "Multi-Spot Ka/Ku Band Transponders, Steerable Reflectors",
      dispenser: "1194VS Low-Shock Clamp Band",
      meshVariant: "commsat"
    };
  }

  if (orbit.includes("polar") || orbit.includes("sso") || desc.includes("earth observation") || desc.includes("optical")) {
    return {
      type: "Remote Sensing Earth Observer",
      bus: "ISRO IMS-2 / AstroBus Platform",
      mass: "1,200 - 2,200 kg",
      power: "Gallium-Arsenide Dual Fold (~3.5 kW)",
      instruments: "High-Resolution Panchromatic Optics, SAR Radar",
      dispenser: "Pneumatic Mechanical Push Ring",
      meshVariant: "probe"
    };
  }

  return {
    type: "Modular Orbital Vehicle",
    bus: "Integrated Payload Bus",
    mass: "1,000 - 3,500 kg",
    power: "Deployable Photovoltaic Wings",
    instruments: "Telemetry Radio Transceiver, Science Suite",
    dispenser: "Spring Push Separation Ring",
    meshVariant: "generic"
  };
}

function getMissionFlightConfig(launch) {
  if (!launch) {
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
        { id: 1, label: "Max-Q", t: "T+62s" },
        { id: 2, label: "MECO", t: "T+165s" },
        { id: 3, label: "Stage Sep", t: "T+172s" },
        { id: 4, label: "Fairing Sep", t: "T+215s" },
        { id: 5, label: "SECO-1", t: "T+520s" },
        { id: 6, label: "SES-2 Burn", t: "T+1620s" },
        { id: 7, label: "GTO Orbit", t: "T+1800s" },
      ]
    };
  }

  if (orbit.includes("polar") || orbit.includes("sso") || orbit.includes("sun-synchronous") || rocket.includes("pslv")) {
    return {
      type: "Sun-Synchronous Polar (SSO)",
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
        { id: 1, label: "Max-Q", t: "T+55s" },
        { id: 2, label: "MECO", t: "T+145s" },
        { id: 3, label: "Stage Sep", t: "T+152s" },
        { id: 4, label: "Fairing Sep", t: "T+190s" },
        { id: 5, label: "Upper Stage", t: "T+480s" },
        { id: 6, label: "Terminal SECO", t: "T+620s" },
        { id: 7, label: "Polar Insert", t: "T+920s" },
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
      { id: 1, label: "Max-Q", t: "T+60s" },
      { id: 2, label: "MECO", t: "T+155s" },
      { id: 3, label: "Stage Sep", t: "T+162s" },
      { id: 4, label: "SES-1 Burn", t: "T+170s" },
      { id: 5, label: "Fairing Sep", t: "T+195s" },
      { id: 6, label: "SECO-1", t: "T+510s" },
      { id: 7, label: "Payload Deploy", t: "T+540s" },
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

  let gForce = 1.0;
  if (t < mecoTime) {
    gForce = 1.0 + (t / mecoTime) * 3.2;
  } else if (t < seco1Time) {
    gForce = 1.2 + ((t - mecoTime) / (seco1Time - mecoTime)) * 2.1;
  } else {
    gForce = 0.0;
  }

  let throttle = 100;
  if (t >= 55 && t <= 75) throttle = 72;
  if (t >= mecoTime - 8 && t < mecoTime) throttle = 60;
  if (t >= mecoTime && t < mecoTime + 7) throttle = 0;
  if (t > seco1Time) throttle = 0;

  let currentEvent = "Pad Cleared & Vertical Ascent";
  let activePhase = 1;

  if (t >= deployTime) {
    currentEvent = `${config.type} Injection Confirmed`;
    activePhase = 7;
  } else if (t >= seco1Time) {
    currentEvent = "SECO-1 (Secondary Cut-Off)";
    activePhase = 6;
  } else if (t >= 195) {
    currentEvent = "Payload Fairing Jettison";
    activePhase = 5;
  } else if (t >= (config.stageSepTime || 162)) {
    currentEvent = "Stage 2 Vacuum Engine Start";
    activePhase = 4;
  } else if (t >= mecoTime) {
    currentEvent = "MECO & Stage 1 Separation";
    activePhase = 3;
  } else if (t >= 60) {
    currentEvent = "Max-Q Dynamic Stress Bucket";
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

// --- 3D SATELLITE & ROCKET HARDWARE ---
function SatelliteInsideBay({ variant = "generic", isDeployed = false }) {
  const satRef = useRef();
  useFrame((_, delta) => {
    if (satRef.current) {
      satRef.current.rotation.y += delta * 0.8;
      if (isDeployed) {
        satRef.current.position.y = Math.min(3.8, satRef.current.position.y + delta * 0.5);
      }
    }
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

function DynamicRocket3D({ rocketName = "", satelliteVariant = "generic", isCutaway = false, stagingStep = 0 }) {
  const rocketRef = useRef();
  const boosterLeftRef = useRef();
  const boosterRightRef = useRef();
  const stage1Ref = useRef();
  const fairingLeftRef = useRef();
  const fairingRightRef = useRef();

  useFrame((_, delta) => {
    if (rocketRef.current) rocketRef.current.rotation.y += delta * 0.4;

    if (stagingStep >= 1) {
      if (boosterLeftRef.current) {
        boosterLeftRef.current.position.x = Math.max(-1.8, boosterLeftRef.current.position.x - delta * 1.5);
        boosterLeftRef.current.position.y -= delta * 0.8;
      }
      if (boosterRightRef.current) {
        boosterRightRef.current.position.x = Math.min(1.8, boosterRightRef.current.position.x + delta * 1.5);
        boosterRightRef.current.position.y -= delta * 0.8;
      }
    } else {
      if (boosterLeftRef.current) {
        boosterLeftRef.current.position.x = -0.65;
        boosterLeftRef.current.position.y = 0.7;
      }
      if (boosterRightRef.current) {
        boosterRightRef.current.position.x = 0.65;
        boosterRightRef.current.position.y = 0.7;
      }
    }

    if (stagingStep >= 2) {
      if (stage1Ref.current) stage1Ref.current.position.y = Math.max(-3.5, stage1Ref.current.position.y - delta * 2.0);
    } else {
      if (stage1Ref.current) stage1Ref.current.position.y = 0.8;
    }

    if (stagingStep >= 3) {
      if (fairingLeftRef.current) {
        fairingLeftRef.current.position.x = Math.max(-1.5, fairingLeftRef.current.position.x - delta * 1.2);
        fairingLeftRef.current.position.y -= delta * 0.5;
      }
      if (fairingRightRef.current) {
        fairingRightRef.current.position.x = Math.min(1.5, fairingRightRef.current.position.x + delta * 1.2);
        fairingRightRef.current.position.y -= delta * 0.5;
      }
    } else {
      if (fairingLeftRef.current) {
        fairingLeftRef.current.position.x = 0;
        fairingLeftRef.current.position.y = 3.1;
      }
      if (fairingRightRef.current) {
        fairingRightRef.current.position.x = 0;
        fairingRightRef.current.position.y = 3.1;
      }
    }
  });

  const fairingOpacity = isCutaway ? 0.22 : 1.0;
  const isHeavy = rocketName.toLowerCase().includes("heavy");

  return (
    <group ref={rocketRef} position={[0, -1.3, 0]}>
      <group ref={stage1Ref} position={[0, 0.8, 0]}>
        <mesh>
          <cylinderGeometry args={[0.29, 0.29, 2.2, 32]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.6} />
        </mesh>
        <mesh position={[0, -1.15, 0]}>
          <cylinderGeometry args={[0.22, 0.28, 0.15, 32]} />
          <meshStandardMaterial color="#0f172a" metalness={0.9} />
        </mesh>
      </group>

      {isHeavy && (
        <>
          <group ref={boosterLeftRef} position={[-0.65, 0.7, 0]}>
            <mesh>
              <cylinderGeometry args={[0.28, 0.28, 2.1, 32]} />
              <meshStandardMaterial color="#e2e8f0" />
            </mesh>
            <mesh position={[0, 1.25, 0]}>
              <coneGeometry args={[0.28, 0.45, 32]} />
              <meshStandardMaterial color="#f8fafc" />
            </mesh>
          </group>
          <group ref={boosterRightRef} position={[0.65, 0.7, 0]}>
            <mesh>
              <cylinderGeometry args={[0.28, 0.28, 2.1, 32]} />
              <meshStandardMaterial color="#e2e8f0" />
            </mesh>
            <mesh position={[0, 1.25, 0]}>
              <coneGeometry args={[0.28, 0.45, 32]} />
              <meshStandardMaterial color="#f8fafc" />
            </mesh>
          </group>
        </>
      )}

      <mesh position={[0, 2.1, 0]}>
        <cylinderGeometry args={[0.29, 0.29, 0.65, 32]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.5} />
      </mesh>

      <SatelliteInsideBay variant={satelliteVariant} isDeployed={stagingStep >= 4} />

      <group ref={fairingLeftRef} position={[0, 3.1, 0]}>
        <mesh>
          <coneGeometry args={[0.34, 0.95, 32, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#38bdf8" transparent={isCutaway} opacity={fairingOpacity} wireframe={isCutaway} />
        </mesh>
      </group>
      <group ref={fairingRightRef} position={[0, 3.1, 0]}>
        <mesh>
          <coneGeometry args={[0.34, 0.95, 32, 1, false, Math.PI, Math.PI]} />
          <meshStandardMaterial color="#38bdf8" transparent={isCutaway} opacity={fairingOpacity} wireframe={isCutaway} />
        </mesh>
      </group>
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
    <div className="bg-[#0b1329]/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-5 shadow-[0_0_30px_rgba(6,182,212,0.15)] font-mono">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-cyan-900/40 text-xs">
        <span className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
          <Orbit className="w-3.5 h-3.5 text-cyan-400 animate-spin" /> {config.type}
        </span>
        <span className="text-slate-400">Target Apogee: <strong className="text-white">{config.targetAlt?.toLocaleString()} km</strong></span>
        <span className="text-emerald-400">Target Velocity: <strong className="text-emerald-300">{config.targetVel?.toLocaleString()} km/h</strong></span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-[#050a17]/90 p-3.5 rounded-xl border border-cyan-950 shadow-inner">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1 mb-1 font-semibold">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" /> Velocity
          </div>
          <div className="text-xl font-bold text-cyan-300 tracking-tight">{telemetry.velocity.toLocaleString()} <span className="text-xs text-slate-500">km/h</span></div>
        </div>
        <div className="bg-[#050a17]/90 p-3.5 rounded-xl border border-cyan-950 shadow-inner">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1 mb-1 font-semibold">
            <Activity className="w-3.5 h-3.5 text-emerald-400" /> Altitude
          </div>
          <div className="text-xl font-bold text-emerald-300 tracking-tight">{telemetry.altitude} <span className="text-xs text-slate-500">km</span></div>
        </div>
        <div className="bg-[#050a17]/90 p-3.5 rounded-xl border border-cyan-950 shadow-inner">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1 mb-1 font-semibold">
            <Compass className="w-3.5 h-3.5 text-amber-400" /> Downrange
          </div>
          <div className="text-xl font-bold text-amber-300 tracking-tight">{telemetry.downrange} <span className="text-xs text-slate-500">km</span></div>
        </div>
        <div className="bg-[#050a17]/90 p-3.5 rounded-xl border border-cyan-950 shadow-inner">
          <div className="text-[10px] uppercase text-slate-400 flex items-center gap-1 mb-1 font-semibold">
            <Zap className="w-3.5 h-3.5 text-rose-400" /> Dynamic G-Load
          </div>
          <div className="text-xl font-bold text-rose-300 tracking-tight">{telemetry.gForce} <span className="text-xs text-slate-500">G</span></div>
        </div>
      </div>

      <div className="bg-[#040814] border border-cyan-900/30 rounded-xl p-4 mb-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(#082f49_1px,transparent_1px)] [background-size:16px_16px] opacity-40"></div>
        <div className="flex justify-between text-[11px] text-slate-400 mb-2 relative z-10">
          <span className="text-cyan-400 font-bold">Ascent Vector: {launch?.pad?.name || "Spaceport Pad"}</span>
          <span>Orbital Insertion: {config.insertionAlt} km</span>
        </div>
        <svg viewBox="0 0 500 200" className="w-full h-44 overflow-visible relative z-10">
          <line x1="20" y1="20" x2="490" y2="20" stroke="#1e293b" strokeDasharray="3 3" />
          <line x1="20" y1="100" x2="490" y2="100" stroke="#1e293b" strokeDasharray="3 3" />
          <line x1="20" y1="180" x2="490" y2="180" stroke="#334155" />
          <path d="M 20 180 Q 90 170, 160 145 T 320 60 T 480 20" fill="none" stroke="#00f0ff" strokeWidth="2" strokeDasharray="4 4" opacity="0.3" />
          <path d={`M 20 180 Q 90 170, ${Math.min(currentX, 160)} ${Math.max(currentY, 145)} T ${currentX} ${currentY}`} fill="none" stroke="#10b981" strokeWidth="3" />
          <circle cx={currentX} cy={currentY} r="7" fill="#00f0ff" className="animate-pulse shadow-lg" />
        </svg>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
        {config.milestones.map((m) => (
          <div
            key={m.id}
            className={`p-2.5 rounded-xl border text-center transition-all ${
              telemetry.activePhase === m.id
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.3)] scale-[1.02]"
                : telemetry.activePhase >= m.id
                ? "bg-[#0b172e] border-emerald-500/40 text-emerald-400"
                : "bg-[#050a17]/60 border-slate-800 text-slate-500"
            }`}
          >
            <div className="text-[10px] text-slate-400 font-medium">{m.t}</div>
            <div className="text-[11px] font-bold truncate mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- VIDEO CINEMA HUD OVERLAY ---
function VideoCinemaHUD({ launch, elapsedSeconds, isPlayingFlight, onTogglePlay, onSetElapsed, config }) {
  const telemetry = computeTelemetry(elapsedSeconds, config);
  const videoUrl = launch?.vidURLs?.[0]?.url || launch?.webcast_live_url || null;
  const youtubeId = videoUrl ? videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/)?.[1] : null;

  return (
    <div className="flex-1 flex flex-col space-y-3 font-mono">
      <div className="relative aspect-video rounded-2xl overflow-hidden border border-cyan-500/40 bg-black shadow-[0_0_30px_rgba(0,0,0,0.8)]">
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
            <Tv className="w-10 h-10 mb-2 text-cyan-500/40 animate-pulse" />
            <span className="tracking-widest uppercase font-bold text-slate-400">Carrier Signal Offline / Standby Manifest</span>
          </div>
        )}

        <div className="absolute top-4 left-4 z-20 bg-[#050a17]/85 backdrop-blur-md border border-cyan-500/50 p-3 rounded-xl shadow-2xl pointer-events-none text-left min-w-[210px]">
          <div className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-bold uppercase tracking-wider mb-1">
            <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> Cinema Telemetry HUD
          </div>
          <div className="text-lg font-extrabold text-white leading-tight">
            {telemetry.velocity.toLocaleString()} <span className="text-[11px] text-cyan-400 font-normal">km/h</span>
          </div>
          <div className="text-xs text-emerald-400 font-semibold mt-0.5">
            ALT: {telemetry.altitude} km &bull; DST: {telemetry.downrange} km
          </div>
          <div className="text-[10px] text-amber-300 mt-1 font-bold">
            G-FORCE: {telemetry.gForce}G | THRTL: {telemetry.throttle}%
          </div>
        </div>

        <div className="absolute top-4 right-4 z-20 bg-[#050a17]/85 backdrop-blur-md border border-slate-700/80 p-2.5 rounded-xl text-right pointer-events-none max-w-[220px]">
          <div className="text-[9px] text-slate-400 uppercase tracking-widest">Mission Elapsed</div>
          <div className="text-cyan-300 font-extrabold text-base">T+{elapsedSeconds}s</div>
          <div className="text-[11px] text-emerald-400 truncate mt-0.5 font-bold">
            {telemetry.currentEvent}
          </div>
        </div>

        <div className="absolute bottom-4 left-4 right-4 z-20 bg-[#050a17]/85 backdrop-blur-md border border-slate-800 px-4 py-2 rounded-xl flex items-center justify-between text-[11px] pointer-events-none">
          <span className="text-slate-300">Staging Step {telemetry.activePhase} / 7 Active</span>
          <span className="text-cyan-400 font-bold">Max-Q Envelope: Nominal</span>
          <span className="text-slate-400">Target Insertion Vector</span>
        </div>
      </div>

      <div className="flex items-center justify-between bg-[#0b1329]/80 backdrop-blur-md border border-cyan-900/30 p-3.5 rounded-xl shadow-lg">
        <button
          onClick={onTogglePlay}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
            isPlayingFlight 
              ? "bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]" 
              : "bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]"
          }`}
        >
          <Play className="w-3.5 h-3.5" /> {isPlayingFlight ? "Pause HUD Sync" : "Sync HUD to Stream"}
        </button>

        <div className="flex items-center gap-3 w-1/2">
          <input
            type="range"
            min="0"
            max={config.maxFlightTime}
            value={elapsedSeconds}
            onChange={(e) => onSetElapsed(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
          />
          <span className="text-cyan-300 font-bold text-xs shrink-0">T+{elapsedSeconds}s</span>
        </div>

        <button
          onClick={() => onSetElapsed(0)}
          className="text-xs bg-slate-900 hover:bg-slate-800 px-3 py-2 rounded-xl text-slate-300 border border-slate-700 cursor-pointer transition-colors"
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
          playCapComVoice(totalSec.toString());
        } else if (totalSec === 0) {
          playCapComVoice("Houston, we have ignition and liftoff!");
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
    <div className="bg-[#0b1329]/80 backdrop-blur-xl border border-slate-800/80 hover:border-cyan-500/60 rounded-2xl overflow-hidden transition-all duration-300 flex flex-col justify-between shadow-[0_4px_20px_rgba(0,0,0,0.5)] hover:shadow-[0_0_25px_rgba(6,182,212,0.2)] group hover:-translate-y-1">
      <div className="p-6">
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 bg-cyan-950/80 px-3 py-1 rounded-lg border border-cyan-800/60 truncate max-w-[50%]">
            {launch.launch_service_provider?.name || "Agency"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleBookmark(launch.id)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isBookmarked 
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.3)]" 
                  : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white"
              }`}
              title={isBookmarked ? "Remove from Watchlist" : "Save to Watchlist"}
            >
              <Star className={`w-3.5 h-3.5 ${isBookmarked ? "fill-amber-400 text-amber-400" : ""}`} />
            </button>
            <span className={`text-[11px] px-2.5 py-1 rounded-lg font-bold border ${isSuccess ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
              {statusName}
            </span>
          </div>
        </div>

        <h3 onClick={() => onSelect(launch)} className="text-lg font-extrabold text-slate-100 mb-1.5 line-clamp-2 cursor-pointer group-hover:text-cyan-300 transition-colors">
          {launch.name}
        </h3>

        <div className="text-[11px] text-cyan-400/90 font-mono mb-4 flex items-center gap-1.5">
          <Orbit className="w-3 h-3 text-cyan-400" />
          <span>Regime: <strong className="text-white">{orbitProfile.type}</strong></span>
        </div>

        <div className="flex items-center text-xs text-slate-400 gap-2 mb-5">
          <MapPin className="w-4 h-4 text-cyan-500/70 shrink-0" />
          <span className="truncate">{launch.pad?.location?.name || "Global Spaceport"}</span>
        </div>

        <div className="bg-[#050a17]/90 rounded-2xl p-4 border border-cyan-950 text-center relative overflow-hidden shadow-inner">
          <div className="text-[11px] uppercase tracking-widest text-slate-400 mb-2 font-bold flex items-center justify-center gap-1.5 font-mono">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            {isArchive ? "Mission Elapsed" : countdown.isPast ? "T-Plus (Elapsed)" : "T-Minus Countdown"}
          </div>

          <div className="grid grid-cols-4 gap-2 text-center font-mono mb-3">
            <div className="bg-[#0a1226] p-1.5 rounded-xl border border-slate-800/80">
              <div className="text-lg font-extrabold text-cyan-300">{countdown.days}</div>
              <div className="text-[9px] text-slate-500 font-bold">DAYS</div>
            </div>
            <div className="bg-[#0a1226] p-1.5 rounded-xl border border-slate-800/80">
              <div className="text-lg font-extrabold text-cyan-300">{countdown.hours}</div>
              <div className="text-[9px] text-slate-500 font-bold">HRS</div>
            </div>
            <div className="bg-[#0a1226] p-1.5 rounded-xl border border-slate-800/80">
              <div className="text-lg font-extrabold text-cyan-300">{countdown.minutes}</div>
              <div className="text-[9px] text-slate-500 font-bold">MIN</div>
            </div>
            <div className="bg-[#0a1226] p-1.5 rounded-xl border border-slate-800/80">
              <div className="text-lg font-extrabold text-cyan-300">{countdown.seconds}</div>
              <div className="text-[9px] text-slate-500 font-bold">SEC</div>
            </div>
          </div>

          {!isArchive && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                onClick={() => onSimulateCountdown(launch)}
                className="bg-[#0f1d3b] hover:bg-cyan-950 text-cyan-300 border border-cyan-700/50 text-[11px] font-bold py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5 text-cyan-400" /> CapCom T-10s
              </button>
              <button
                onClick={() => downloadCalendarInvite(launch)}
                className="bg-[#0f1d3b] hover:bg-cyan-950 text-cyan-300 border border-cyan-700/50 text-[11px] font-bold py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5 text-cyan-400" /> .ICS Sync
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#070d1e] px-6 py-3.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <span className="font-mono text-[11px] text-slate-400">
          {new Date(launch.net).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button 
          onClick={() => onSelect(launch)}
          className="text-cyan-400 font-bold hover:translate-x-1 transition-transform inline-flex items-center gap-1.5 cursor-pointer"
        >
          Flight HUD &amp; 3D <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />
        </button>
      </div>
    </div>
  );
}

// --- ADVANCED RADAR MAP ---
function AdvancedLaunchPadMap({ launches, onSelect, issData, showDebrisRadar, setShowDebrisRadar, showTerminator, setShowTerminator }) {
  const [mapStyle, setMapStyle] = useState("dark");

  const solarData = useMemo(() => computeSolarTerminatorPoints(), []);
  const conjunctionEvents = useMemo(() => computeConjunctionRisk(issData, HIGH_RISK_DEBRIS_TRACKS), [issData]);

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
    <div className="relative w-full h-[660px] rounded-3xl overflow-hidden border border-cyan-500/40 shadow-[0_0_40px_rgba(6,182,212,0.15)] bg-[#030712]">
      <div className="absolute top-4 right-4 z-[400] flex items-center gap-2 bg-[#050a17]/90 backdrop-blur-xl p-2 rounded-2xl border border-cyan-900/40 shadow-2xl">
        <button
          onClick={() => setShowDebrisRadar(!showDebrisRadar)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-all ${
            showDebrisRadar ? "bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.5)]" : "text-slate-300 hover:text-white"
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          {showDebrisRadar ? "Debris: Active" : "Debris: Off"}
        </button>
        <button
          onClick={() => setShowTerminator(!showTerminator)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-all ${
            showTerminator ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.5)]" : "text-slate-300 hover:text-white"
          }`}
        >
          {showTerminator ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          {showTerminator ? "Solar Line: On" : "Solar: Off"}
        </button>
        <button
          onClick={() => setMapStyle("dark")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${mapStyle === "dark" ? "bg-slate-800 text-cyan-300 border border-cyan-700/50" : "text-slate-400 hover:text-white"}`}
        >
          Tactical
        </button>
        <button
          onClick={() => setMapStyle("satellite")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${mapStyle === "satellite" ? "bg-slate-800 text-cyan-300 border border-cyan-700/50" : "text-slate-400 hover:text-white"}`}
        >
          Satellite
        </button>
      </div>

      {issData && (
        <div className="absolute top-4 left-4 z-[400] bg-[#050a17]/90 backdrop-blur-xl px-4 py-3 rounded-2xl border border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.2)] text-xs flex flex-col gap-1 font-mono">
          <div className="flex items-center gap-2 text-rose-400 font-extrabold uppercase tracking-wider text-[11px]">
            <Satellite className="w-4 h-4 animate-spin" /> ISS Live Orbital Position
          </div>
          <div className="text-slate-300">
            Lat: <span className="text-cyan-300 font-bold">{issData.latitude.toFixed(2)}°</span> | Lon: <span className="text-cyan-300 font-bold">{issData.longitude.toFixed(2)}°</span>
          </div>
          <div className="text-slate-400 text-[10px]">
            Alt: <span className="text-white font-bold">{issData.altitude.toFixed(1)} km</span> | Speed: <span className="text-white font-bold">{Math.round(issData.velocity)} km/h</span>
          </div>
        </div>
      )}

      {showDebrisRadar && conjunctionEvents.length > 0 && (
        <div className="absolute bottom-4 left-4 z-[400] bg-[#050a17]/90 backdrop-blur-xl p-4 rounded-2xl border border-amber-500/60 shadow-[0_0_25px_rgba(245,158,11,0.25)] font-mono text-xs max-w-sm pointer-events-auto">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <span className="text-amber-400 font-bold flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> Orbital Threat Conjunction
            </span>
            <span className="text-[10px] text-slate-400">Closest Pass</span>
          </div>
          <div className="space-y-2">
            {conjunctionEvents.slice(0, 2).map((item) => (
              <div key={item.id} className="p-2.5 rounded-xl bg-[#091226] border border-slate-800 flex items-center justify-between text-[11px]">
                <div>
                  <div className="text-white font-bold truncate max-w-[170px]">{item.name}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Rel Vel: <strong className="text-cyan-300">{item.relativeSpeed} km/s</strong> &bull; TCA: <strong className="text-amber-300">+{item.tcaSec}s</strong>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-rose-400 font-extrabold text-sm">{item.missDistance} km</div>
                  <div className="text-[9px] text-slate-500 uppercase">Miss Distance</div>
                </div>
              </div>
            ))}
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
                fillOpacity: 0.5,
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

        {showDebrisRadar && conjunctionEvents.map((deb) => (
          <React.Fragment key={deb.id}>
            <Marker position={[deb.lat, deb.lon]} icon={debrisIcon}>
              <Popup>
                <div className="p-1 font-mono text-xs min-w-[200px]">
                  <span className="text-amber-400 font-bold block">{deb.name}</span>
                  <span className="text-slate-300 block text-[10px]">Altitude: {deb.alt} km</span>
                  <span className="text-rose-400 block text-[10px] font-bold">Approach Range: {deb.missDistance} km to ISS</span>
                  <span className="text-cyan-300 block text-[10px]">P(Collision): {deb.probability}</span>
                </div>
              </Popup>
            </Marker>
            {issData && (
              <Polyline
                positions={[[issData.latitude, issData.longitude], [deb.lat, deb.lon]]}
                pathOptions={{
                  color: deb.isCritical ? "#f43f5e" : "#fbbf24",
                  weight: 1.5,
                  dashArray: "3, 6",
                  opacity: 0.7
                }}
              />
            )}
          </React.Fragment>
        ))}

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

// --- MODAL ---
function LaunchModal({ launch, onClose }) {
  if (!launch) return null;
  return <LaunchModalContent launch={launch} onClose={onClose} />;
}

function LaunchModalContent({ launch, onClose }) {
  const [modalTab, setModalTab] = useState("3d");
  const [flightElapsed, setFlightElapsed] = useState(70);
  const [isPlayingFlight, setIsPlayingFlight] = useState(false);
  const [isCutaway, setIsCutaway] = useState(false);
  const [stagingStep, setStagingStep] = useState(0);
  const [isAutoStaging, setIsAutoStaging] = useState(false);
  const [weather, setWeather] = useState(null);

  const config = useMemo(() => getMissionFlightConfig(launch), [launch]);
  const satSpecs = useMemo(() => getSatelliteSpecs(launch), [launch]);
  const riskAnalysis = useMemo(() => evaluateGoNoGoStatus(weather), [weather]);

  const triggerCapComCallout = (message) => playCapComVoice(message);

  useEffect(() => {
    let timer = null;
    if (isAutoStaging) {
      timer = setInterval(() => {
        setStagingStep((prev) => {
          if (prev === 0) triggerCapComCallout("Booster cutoff and jettison confirmed.");
          if (prev === 1) triggerCapComCallout("Main engine cutoff. Stage separation verified.");
          if (prev === 2) triggerCapComCallout("Payload fairing separation nominal.");
          if (prev === 3) triggerCapComCallout("Satellite orbital injection confirmed. Spacecraft is free.");

          if (prev >= 4) {
            setIsAutoStaging(false);
            return 4;
          }
          return prev + 1;
        });
      }, 2400);
    }
    return () => clearInterval(timer);
  }, [isAutoStaging]);

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

  const stagingLabels = [
    "Integrated Assembly (T-0 Liftoff)",
    "Side Booster Separation (BECO)",
    "Core Stage 1 Decoupling (MECO)",
    "Payload Fairing Jettison",
    "Orbital Injection & Satellite Release"
  ];

  return (
    <div className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-[#0b1329]/95 border border-cyan-500/40 rounded-3xl max-w-4xl w-full p-6 shadow-[0_0_50px_rgba(6,182,212,0.25)] relative text-slate-200 max-h-[94vh] flex flex-col">
        <button onClick={onClose} className="absolute top-5 right-5 p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer z-30">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-cyan-300 bg-cyan-950/90 px-3 py-1 rounded-lg border border-cyan-700/60 shadow-sm">
            {launch.launch_service_provider?.name}
          </span>
          <span className="text-xs px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-medium">
            {launch.status?.name}
          </span>
          <button
            onClick={() => triggerCapComCallout(`CapCom telemetry status: ${rocketTitle} flight dynamics nominal.`)}
            className="text-[11px] bg-slate-900 hover:bg-cyan-950 text-cyan-300 px-2.5 py-1 rounded-lg border border-cyan-700/50 flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> Radio CapCom
          </button>
        </div>

        <h2 className="text-2xl font-extrabold text-white mb-1 tracking-tight">{launch.name}</h2>
        <div className="text-xs text-slate-400 mb-4 flex items-center gap-2 font-mono">
          <span>Target Regime: <strong className="text-cyan-400">{config.type}</strong></span>
          <span>&bull;</span>
          <span>Perigee &times; Apogee: <strong className="text-white">{config.insertionAlt} &times; {config.targetAlt.toLocaleString()} km</strong></span>
        </div>

        <div className="flex items-center gap-2 mb-4 border-b border-slate-800/80 pb-3 flex-wrap">
          <button
            onClick={() => setModalTab("3d")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "3d" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            <Box className="w-3.5 h-3.5" /> 3D Staging &amp; Payload Inspector
          </button>
          <button
            onClick={() => setModalTab("overview")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "overview" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> AI Risk &amp; Pad Weather
          </button>
          <button
            onClick={() => setModalTab("video")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "video" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            <Tv className="w-3.5 h-3.5" /> Webcast Cinema HUD
          </button>
          <button
            onClick={() => setModalTab("telemetry")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              modalTab === "telemetry" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            <Gauge className="w-3.5 h-3.5" /> Flight Profiler HUD
          </button>
        </div>

        {modalTab === "3d" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 h-[440px] overflow-y-auto">
            <div className="md:col-span-2 bg-[#050a17] rounded-2xl border border-cyan-500/30 relative overflow-hidden h-[420px] shadow-inner">
              <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 font-mono text-[10px]">
                <span className="bg-cyan-950/90 text-cyan-300 px-2.5 py-1 rounded-lg border border-cyan-700 font-bold">
                  VEHICLE: {rocketTitle.toUpperCase()}
                </span>
                <span className="bg-[#0b1329]/90 text-amber-300 px-2.5 py-1 rounded-lg border border-amber-800">
                  EVENT: {stagingLabels[stagingStep]}
                </span>
              </div>

              <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between gap-2 bg-[#050a17]/90 backdrop-blur-md p-2 rounded-2xl border border-slate-800 font-mono text-xs">
                <button
                  onClick={() => setIsAutoStaging(!isAutoStaging)}
                  className={`px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                    isAutoStaging ? "bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]" : "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]"
                  }`}
                >
                  <FastForward className="w-3.5 h-3.5" />
                  {isAutoStaging ? "Pause Sequence" : "Auto Staging"}
                </button>

                <div className="flex items-center gap-1.5">
                  {[0, 1, 2, 3, 4].map((step) => (
                    <button
                      key={step}
                      onClick={() => {
                        setIsAutoStaging(false);
                        setStagingStep(step);
                      }}
                      className={`w-7 h-7 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                        stagingStep === step
                          ? "bg-cyan-400 text-black shadow-[0_0_10px_rgba(6,182,212,0.6)]"
                          : "bg-slate-900 text-slate-400 hover:text-white"
                      }`}
                      title={stagingLabels[step]}
                    >
                      {step + 1}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setIsAutoStaging(false);
                    setStagingStep(0);
                  }}
                  className="p-1.5 rounded-xl bg-slate-900 text-slate-400 hover:text-white cursor-pointer"
                  title="Reset to Integrated Assembly"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsCutaway(!isCutaway)}
                  className="px-3 py-1.5 rounded-xl text-xs bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 cursor-pointer"
                >
                  {isCutaway ? "Solid Fairing" : "Cutaway"}
                </button>
              </div>

              <Canvas camera={{ position: [0, 2.0, 4.6], fov: 45 }}>
                <ambientLight intensity={0.9} />
                <directionalLight position={[10, 10, 5]} intensity={1.6} />
                <pointLight position={[-10, 5, -5]} intensity={0.8} color="#00f0ff" />
                <Suspense fallback={null}>
                  <DynamicRocket3D
                    rocketName={rocketTitle}
                    satelliteVariant={satSpecs.meshVariant}
                    isCutaway={isCutaway}
                    stagingStep={stagingStep}
                  />
                </Suspense>
                <OrbitControls enablePan={false} />
              </Canvas>
            </div>

            <div className="bg-[#050a17] rounded-2xl border border-slate-800/80 p-4 text-xs font-mono space-y-2.5 h-[420px] overflow-y-auto">
              <div className="text-cyan-400 font-bold uppercase pb-1.5 border-b border-slate-800">
                Staging Timeline Diagnostics
              </div>
              
              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-cyan-300">
                <span className="block text-[10px] text-slate-400 font-bold uppercase">CURRENT SEPARATION PHASE:</span>
                <span className="font-extrabold text-xs">{stagingLabels[stagingStep]}</span>
              </div>

              <div className="space-y-2 text-[11px]">
                <div className="p-2.5 rounded-xl bg-[#0b1329] border border-slate-800"><span className="text-slate-400 block text-[10px]">PAYLOAD ARCHITECTURE</span><span className="text-white font-bold">{satSpecs.type}</span></div>
                <div className="p-2.5 rounded-xl bg-[#0b1329] border border-slate-800"><span className="text-slate-400 block text-[10px]">CHASSIS / BUS</span><span className="text-slate-200">{satSpecs.bus}</span></div>
                <div className="p-2.5 rounded-xl bg-[#0b1329] border border-slate-800"><span className="text-slate-400 block text-[10px]">MASS TO ORBIT</span><span className="text-emerald-400 font-bold">{satSpecs.mass}</span></div>
                <div className="p-2.5 rounded-xl bg-[#0b1329] border border-slate-800"><span className="text-slate-400 block text-[10px]">POWER ARRAYS</span><span className="text-slate-300">{satSpecs.power}</span></div>
                <div className="p-2.5 rounded-xl bg-[#0b1329] border border-slate-800"><span className="text-slate-400 block text-[10px]">DISPENSER MECHANISM</span><span className="text-slate-300">{satSpecs.dispenser}</span></div>
              </div>
            </div>
          </div>
        )}

        {modalTab === "overview" && (
          <div className="overflow-y-auto pr-2 space-y-4 flex-1 font-mono text-xs">
            <div className="bg-[#050a17] border border-cyan-500/30 rounded-2xl p-4 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-cyan-400" />
                  <span className="font-bold text-slate-200 uppercase tracking-wider text-xs">
                    Range Safety &amp; Mission Feasibility Assessment
                  </span>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-extrabold border ${riskAnalysis.badgeColor}`}>
                  {riskAnalysis.status} ({riskAnalysis.score}% CONFIDENCE)
                </div>
              </div>

              <div className="mb-4">
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Go-Probability Metric</span>
                  <span className="font-bold text-white">{riskAnalysis.score} / 100</span>
                </div>
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className={`h-full transition-all duration-500 ${
                      riskAnalysis.score > 79 ? "bg-emerald-500" : riskAnalysis.score > 54 ? "bg-amber-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${riskAnalysis.score}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3">
                <div className={`p-2.5 rounded-xl border flex items-center justify-between ${
                  riskAnalysis.windSafe ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300" : "bg-rose-950/40 border-rose-800/60 text-rose-300"
                }`}>
                  <span>Wind Shear Rule</span>
                  <span className="font-bold">{riskAnalysis.windSafe ? "NOMINAL" : "VIOLATION"}</span>
                </div>
                <div className={`p-2.5 rounded-xl border flex items-center justify-between ${
                  riskAnalysis.rainSafe ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300" : "bg-rose-950/40 border-rose-800/60 text-rose-300"
                }`}>
                  <span>Lightning &amp; Cloud Rule</span>
                  <span className="font-bold">{riskAnalysis.rainSafe ? "NOMINAL" : "VIOLATION"}</span>
                </div>
                <div className={`p-2.5 rounded-xl border flex items-center justify-between ${
                  riskAnalysis.tempSafe ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300" : "bg-rose-950/40 border-rose-800/60 text-rose-300"
                }`}>
                  <span>Thermal O-Ring Limits</span>
                  <span className="font-bold">{riskAnalysis.tempSafe ? "NOMINAL" : "VIOLATION"}</span>
                </div>
              </div>

              <div className="bg-[#0b1329] p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">Range Safety Officer Notes:</span>
                <ul className="space-y-1">
                  {riskAnalysis.reasons.map((r, i) => (
                    <li key={i} className="text-slate-300 text-[11px] flex items-start gap-1.5">
                      <span className="text-cyan-400 mt-0.5">&bull;</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-[#050a17] border border-slate-800 rounded-xl p-3">
              <span className="text-xs font-bold uppercase text-cyan-400 block mb-2">Live Pad Weather Telemetry</span>
              {weather ? (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-[#0b1329] p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">SURFACE TEMP</span>
                    <span className="font-bold text-white text-sm">{weather.temperature_2m}°C</span>
                  </div>
                  <div className="bg-[#0b1329] p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">WIND SPEED</span>
                    <span className="font-bold text-cyan-300 text-sm">{weather.wind_speed_10m} km/h</span>
                  </div>
                  <div className="bg-[#0b1329] p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">PRECIPITATION</span>
                    <span className="font-bold text-white text-sm">{weather.precipitation} mm</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500">Weather data unavailable for this complex.</div>
              )}
            </div>
          </div>
        )}

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

        {modalTab === "telemetry" && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            <div className="flex items-center justify-between bg-[#050a17] border border-slate-800 p-3 rounded-xl">
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

        <div className="flex items-center justify-between pt-4 border-t border-slate-800 mt-4">
          <button
            onClick={() => downloadCalendarInvite(launch)}
            className="inline-flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-cyan-300 px-4 py-2 rounded-xl font-bold border border-cyan-800/50 cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export to Calendar (.ics)
          </button>
          {launch.pad?.wiki_url && (
            <a 
              href={launch.pad.wiki_url} 
              target="_blank" 
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 rounded-xl font-extrabold transition-colors shadow-[0_0_15px_rgba(6,182,212,0.4)]"
            >
              Pad History <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// --- COMMAND PALETTE OVERLAY (CTRL+K) ---
function CommandPalette({ isOpen, onClose, onAction, launches }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  if (!isOpen) return null;

  const quickActions = [
    { id: "radar-dark", title: "Switch View: Tactical Radar Map", category: "Navigation", execute: () => onAction("view-map") },
    { id: "grid-cards", title: "Switch View: Launch Grid Cards", category: "Navigation", execute: () => onAction("view-grid") },
    { id: "toggle-debris", title: "Toggle Space Debris Conjunction Layer", category: "Radar Layers", execute: () => onAction("toggle-debris") },
    { id: "toggle-terminator", title: "Toggle Day/Night Solar Terminator", category: "Radar Layers", execute: () => onAction("toggle-terminator") },
    { id: "test-capcom", title: "Radio Test: CapCom Transmission & Quindar Tones", category: "Audio Test", execute: () => onAction("test-capcom") },
    { id: "test-rumble", title: "Audio Test: Booster Acoustic Rumble Resonance", category: "Audio Test", execute: () => onAction("test-rumble") },
  ];

  const matchedLaunches = launches.filter(l => 
    l.name?.toLowerCase().includes(query.toLowerCase()) || 
    l.launch_service_provider?.name?.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5);

  const matchedActions = quickActions.filter(a =>
    a.title.toLowerCase().includes(query.toLowerCase()) ||
    a.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-md flex items-start justify-center pt-24 p-4 font-mono">
      <div className="bg-[#0b1329] border border-cyan-500/60 rounded-3xl max-w-xl w-full shadow-[0_0_50px_rgba(6,182,212,0.3)] overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a mission name or command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <span className="text-[10px] bg-slate-900 text-slate-400 px-2 py-1 rounded-lg border border-slate-800 font-bold">ESC</span>
        </div>

        <div className="max-h-80 overflow-y-auto p-2.5 space-y-1 text-xs">
          {matchedActions.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] text-cyan-400/60 uppercase font-bold tracking-wider">System Quick Commands</div>
              {matchedActions.map(act => (
                <div
                  key={act.id}
                  onClick={() => { act.execute(); onClose(); }}
                  className="px-3.5 py-2.5 rounded-xl hover:bg-cyan-500/15 hover:text-cyan-300 text-slate-300 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>{act.title}</span>
                  <span className="text-[10px] text-slate-500">{act.category}</span>
                </div>
              ))}
            </div>
          )}

          {matchedLaunches.length > 0 && (
            <div className="pt-2">
              <div className="px-3 py-1 text-[10px] text-cyan-400/60 uppercase font-bold tracking-wider">Matching Missions</div>
              {matchedLaunches.map(l => (
                <div
                  key={l.id}
                  onClick={() => { onAction("open-launch", l); onClose(); }}
                  className="px-3.5 py-2.5 rounded-xl hover:bg-cyan-500/15 hover:text-cyan-300 text-slate-300 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="truncate">{l.name}</span>
                  <span className="text-[10px] text-cyan-400 font-bold">{l.launch_service_provider?.name}</span>
                </div>
              ))}
            </div>
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
  const [showDebrisRadar, setShowDebrisRadar] = useState(true);
  const [showTerminator, setShowTerminator] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    if (missionTab !== "watchlist") fetchLaunches(missionTab);
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
    playCapComVoice("T-minus 10 seconds and counting. Flight computers in terminal count.");
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

  const handleCommandPaletteAction = (action, payload) => {
    if (action === "view-map") setViewMode("map");
    if (action === "view-grid") setViewMode("grid");
    if (action === "toggle-debris") setShowDebrisRadar(prev => !prev);
    if (action === "toggle-terminator") setShowTerminator(prev => !prev);
    if (action === "test-capcom") playCapComVoice("CapCom radio loop communication verification test. Standing by.");
    if (action === "test-rumble") playRumbleSound();
    if (action === "open-launch") setSelectedLaunch(payload);
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 p-4 md:p-8 relative selection:bg-cyan-500 selection:text-black">
      {/* Deep Cyber Radial Atmospheric Glows */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[140px] pointer-events-none -z-10"></div>
      <div className="fixed bottom-0 right-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[140px] pointer-events-none -z-10"></div>

      <div className="max-w-7xl mx-auto">
        {/* Top Mission Control Quick Metric Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 font-mono text-xs">
          <div className="bg-[#0b1329]/70 backdrop-blur-md p-3 rounded-2xl border border-cyan-900/40 flex items-center justify-between">
            <span className="text-slate-400">TRACKED VEHICLES</span>
            <span className="text-cyan-400 font-extrabold">{launches.length} ACTIVE</span>
          </div>
          <div className="bg-[#0b1329]/70 backdrop-blur-md p-3 rounded-2xl border border-cyan-900/40 flex items-center justify-between">
            <span className="text-slate-400">ISS VELOCITY</span>
            <span className="text-emerald-400 font-extrabold">{issData ? `${Math.round(issData.velocity)} km/h` : "ACQUIRING..."}</span>
          </div>
          <div className="bg-[#0b1329]/70 backdrop-blur-md p-3 rounded-2xl border border-cyan-900/40 flex items-center justify-between">
            <span className="text-slate-400">CONJUNCTION RISK</span>
            <span className="text-amber-400 font-extrabold">3 CATALOGED</span>
          </div>
          <div className="bg-[#0b1329]/70 backdrop-blur-md p-3 rounded-2xl border border-cyan-900/40 flex items-center justify-between">
            <span className="text-slate-400">CAPCOM LOOP</span>
            <span className="text-cyan-300 font-extrabold">2525 HZ NOMINAL</span>
          </div>
        </div>

        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-cyan-950/60 mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Rocket className="w-8 h-8 text-cyan-400 animate-pulse" />
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">
                Orbital Telemetry &amp; Spaceport Radar
              </h1>
            </div>
            <p className="text-xs md:text-sm text-slate-400">
              Live orbital manifests &bull; CapCom mission audio &bull; 3D vehicle staging &bull; AI launch risk analysis
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="hidden lg:flex items-center gap-2 bg-[#0b1329] hover:bg-[#111f44] text-slate-300 border border-cyan-900/40 px-3.5 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer shadow-md"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>Command Palette</span>
              <kbd className="bg-slate-900 border border-slate-800 text-[10px] px-1.5 py-0.5 rounded text-cyan-400 font-bold">Ctrl+K</kbd>
            </button>

            <div className="bg-[#0b1329]/90 border border-cyan-900/40 rounded-2xl p-1 flex items-center shadow-lg">
              <button
                onClick={() => setMissionTab("upcoming")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  missionTab === "upcoming" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "text-slate-400 hover:text-white"
                }`}
              >
                <Rocket className="w-3.5 h-3.5" /> Upcoming
              </button>
              <button
                onClick={() => setMissionTab("previous")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  missionTab === "previous" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "text-slate-400 hover:text-white"
                }`}
              >
                <History className="w-3.5 h-3.5" /> Completed
              </button>
              <button
                onClick={() => setMissionTab("watchlist")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  missionTab === "watchlist" ? "bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]" : "text-slate-400 hover:text-white"
                }`}
              >
                <Star className="w-3.5 h-3.5 fill-current" /> Watchlist ({bookmarkedIds.length})
              </button>
            </div>

            <button
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all border cursor-pointer ${
                voiceEnabled ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : "bg-slate-900 text-slate-400 border-slate-800"
              }`}
              title={voiceEnabled ? "CapCom Radio Enabled" : "CapCom Radio Muted"}
            >
              {voiceEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>

            <div className="bg-[#0b1329]/90 border border-cyan-900/40 rounded-2xl p-1 flex items-center shadow-lg">
              <button
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "grid" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "text-slate-400 hover:text-white"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Cards
              </button>
              <button
                onClick={() => setViewMode("map")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  viewMode === "map" ? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "text-slate-400 hover:text-white"
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" /> Radar Map
              </button>
            </div>

            <button
              onClick={() => fetchLaunches(missionTab === "watchlist" ? "upcoming" : missionTab)}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold px-4 py-2.5 rounded-2xl transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Sync
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 text-cyan-400/60 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search missions by rocket, agency, or spaceport... (or press Ctrl+K)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0b1329]/70 backdrop-blur-md border border-cyan-950 rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors shadow-inner font-mono"
            />
          </div>

          <div className="relative">
            <Filter className="w-4 h-4 text-cyan-400/60 absolute left-4 top-1/2 -translate-y-1/2" />
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full bg-[#0b1329]/70 backdrop-blur-md border border-cyan-950 rounded-2xl pl-11 pr-8 py-3 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer appearance-none shadow-inner font-mono"
            >
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-950/40 border border-rose-800 rounded-2xl text-rose-300 text-sm mb-6 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            <span>Telemetry error: {error}</span>
          </div>
        )}

        {loading && (
          <div className="h-[550px] bg-[#0b1329]/60 backdrop-blur-md animate-pulse rounded-3xl border border-cyan-950 flex items-center justify-center">
            <div className="flex items-center gap-3 text-cyan-400 font-mono text-sm tracking-wider">
              <RefreshCw className="w-5 h-5 animate-spin" /> SYNCHRONIZING REAL-TIME TELEMETRY...
            </div>
          </div>
        )}

        {!loading && (
          <>
            {filteredLaunches.length === 0 && missionTab === "watchlist" ? (
              <div className="h-64 flex flex-col items-center justify-center border border-dashed border-cyan-900/40 rounded-3xl text-slate-400 font-mono text-sm gap-2 bg-[#0b1329]/30">
                <Star className="w-7 h-7 text-amber-400/60" />
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
                showDebrisRadar={showDebrisRadar}
                setShowDebrisRadar={setShowDebrisRadar}
                showTerminator={showTerminator}
                setShowTerminator={setShowTerminator}
                onSelect={(selected) => setSelectedLaunch(selected)}
              />
            )}
          </>
        )}

        <LaunchModal launch={selectedLaunch} onClose={() => setSelectedLaunch(null)} />

        <CommandPalette 
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onAction={handleCommandPaletteAction}
          launches={launches}
        />
      </div>
    </div>
  );
}