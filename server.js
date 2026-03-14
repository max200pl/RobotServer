/**
 * Node.js server for STM32 Robot Control
 *
 * Browser  <──WebSocket──>  Server  <──WebSocket──>  ESP32  <──UART──>  STM32
 *
 * - Browser connects via WS: receives events, sends commands
 * - ESP32 connects via WS to /ws: registers, sends telemetry, receives commands
 */

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { WebSocketServer } = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const PORT   = process.env.PORT || 3000;

app.use(express.json());
app.use((_, res, next) => { res.setHeader('bypass-tunnel-reminder', 'true'); res.setHeader('ngrok-skip-browser-warning', 'true'); next(); });

const recentEvents = [];   // last 100 events, for history on new connections
let   eventSeq = 0;
let   esp32Socket = null;  // WebSocket connection from ESP32

// ============================================================================
// WEBSOCKET  (browser ↔ server ↔ ESP32)
// ============================================================================

function broadcastToBrowsers(msg) {
    const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
    wss.clients.forEach(client => {
        if (client !== esp32Socket && client.readyState === 1 /* OPEN */) {
            client.send(str);
        }
    });
}

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[WS] Client connected from ${ip} (total: ${wss.clients.size})`);

    // Send history to all new connections (ESP32 will ignore unknown message types)
    ws.send(JSON.stringify({ type: 'history', events: recentEvents.slice(-30) }));

    ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { return; }

        // ESP32 registration
        if (msg.type === 'register' && msg.device === 'esp32') {
            esp32Socket = ws;
            console.log(`[WS] ESP32 registered`);
            broadcastToBrowsers({ type: 'esp32_status', connected: true });
            return;
        }

        // Message from ESP32 (telemetry forwarded from STM32)
        if (ws === esp32Socket) {
            if (msg.type === 'telemetry') {
                const data = { ...msg };
                delete data.type;
                const timestamp = new Date().toISOString();
                const event = { seq: ++eventSeq, time: timestamp.slice(11, 19), data };
                recentEvents.push(event);
                if (recentEvents.length > 100) recentEvents.shift();
                broadcastToBrowsers({ type: 'event', ...event });

                if (data.button !== undefined)
                    console.log(`[${event.time}] BTN_${data.button}: ${data.state}`);
                else if (data.motor !== undefined)
                    console.log(`[${event.time}] Motor ${data.motor}: ${data.direction} ${data.speed}%`);
            }
            return;
        }

        // Message from browser: forward command directly to ESP32
        if (msg.type === 'command') {
            if (esp32Socket && esp32Socket.readyState === 1 /* OPEN */) {
                esp32Socket.send(JSON.stringify({
                    type:   'command',
                    action: msg.action,
                    speed:  msg.speed,
                    id:     msg.id,
                    dir:    msg.dir
                }));
            }
        }
    });

    ws.on('close', () => {
        if (ws === esp32Socket) {
            esp32Socket = null;
            console.log(`[WS] ESP32 disconnected`);
            broadcastToBrowsers({ type: 'esp32_status', connected: false });
        } else {
            console.log(`[WS] Browser disconnected (total: ${wss.clients.size})`);
        }
    });

    ws.on('error', () => {
        if (ws === esp32Socket) esp32Socket = null;
    });
});

// ============================================================================
// DASHBOARD HTML
// ============================================================================

const HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>STM32 Robot</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"><\/script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { background: #0d1117; color: #e6edf3; font-family: 'Courier New', monospace; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

/* ── Header ── */
header { background: #161b22; padding: 8px 16px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #30363d; flex-shrink: 0; min-height: 44px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #3d444d; transition: all 0.5s; flex-shrink: 0; }
.dot.on { background: #3fb950; box-shadow: 0 0 8px #3fb950; }
h1 { font-size: 0.9em; color: #58a6ff; white-space: nowrap; }
#hstatus { font-size: 0.75em; }
.hinfo { margin-left: auto; color: #3d444d; font-size: 0.7em; white-space: nowrap; }

/* ── Desktop layout ── */
.main { display: flex; flex: 1; overflow: hidden; }
#three-wrap { flex: 1; position: relative; overflow: hidden; min-width: 0; }
#three-wrap canvas { display: block; }
.moverlay { position: absolute; top: 8px; left: 8px; display: flex; flex-direction: column; gap: 3px; pointer-events: none; }
.mbar-row { display: flex; align-items: center; gap: 5px; font-size: 0.65em; background: rgba(13,17,23,0.8); padding: 2px 7px; border-radius: 4px; border: 1px solid #21262d; }
.mbar-track { width: 50px; height: 4px; background: #21262d; border-radius: 2px; overflow: hidden; }
.mbar-fill { height: 100%; width: 0%; background: #3fb950; border-radius: 2px; transition: width 0.3s, background 0.3s; }
.hint3d { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); color: #3d444d; font-size: 0.65em; pointer-events: none; white-space: nowrap; }

/* ── Controls panel ── */
.ctrl-section { width: 240px; background: #161b22; border-left: 1px solid #30363d; padding: 14px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; flex-shrink: 0; }
.speed-row { display: flex; align-items: center; gap: 8px; }
.speed-row input[type=range] { flex: 1; accent-color: #58a6ff; height: 20px; cursor: pointer; }
.spd-val { color: #58a6ff; font-size: 0.85em; width: 34px; text-align: right; }
h3 { color: #8b949e; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; }

/* ── D-pad ── */
.dpad { display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(3, 50px); gap: 5px; margin: 0 auto; touch-action: none; }
.dpad button { background: #21262d; border: 1px solid #30363d; color: #8b949e; border-radius: 8px; cursor: pointer; font-size: 1.3em; transition: background 0.1s, color 0.1s; user-select: none; touch-action: none; }
.dpad button:hover, .dpad button:active { background: #30363d; color: #e6edf3; }
.dpad button.pressed { background: #58a6ff !important; color: #0d1117 !important; border-color: #58a6ff !important; }
.stop-btn { background: #1a0a0a !important; border-color: #c0392b !important; color: #e74c3c !important; }
.stop-btn:active, .stop-btn:hover { background: #e74c3c !important; color: #fff !important; }

/* ── Motor buttons ── */
.mbtns { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.mbtns button { padding: 8px 4px; background: #21262d; border: 1px solid #30363d; color: #8b949e; border-radius: 6px; cursor: pointer; font-size: 0.78em; transition: all 0.15s; }
.mbtns button:hover { border-color: #58a6ff; color: #58a6ff; }
.mbtns button.on { background: #58a6ff22; color: #58a6ff; border-color: #58a6ff; }
.kbd-hint { font-size: 0.65em; color: #3d444d; text-align: center; }

/* ── Log ── */
.log-section { width: 200px; background: #0d1117; border-left: 1px solid #30363d; display: flex; flex-direction: column; padding: 8px; gap: 5px; flex-shrink: 0; }
.log-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.le { font-size: 0.67em; padding: 3px 6px; border-radius: 3px; }
.le-btn { color: #79c0ff; } .le-motor { color: #e3b341; }
.lt { color: #3fb950; margin-right: 4px; }

/* ── Mobile layout (≤768px) ── */
@media (max-width: 768px) {
  .hinfo { display: none; }
  .kbd-hint { display: none; }
  .hint3d { display: none; }
  .main { flex-direction: column; overflow-y: auto; overflow-x: hidden; }
  #three-wrap { flex: none; height: 38vh; min-height: 180px; width: 100%; }
  .ctrl-section { width: 100%; border-left: none; border-top: 1px solid #30363d; flex-direction: row; flex-wrap: wrap; padding: 10px 12px; gap: 10px; overflow-y: visible; }
  .ctrl-section > * { flex-shrink: 0; }
  .speed-block { width: 100%; display: flex; flex-direction: column; gap: 6px; }
  .dpad-block { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .dpad { grid-template-columns: repeat(3, 72px); grid-template-rows: repeat(3, 64px); gap: 7px; }
  .dpad button { font-size: 1.6em; border-radius: 10px; }
  .motor-block { flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 6px; }
  .mbtns button { padding: 12px 4px; font-size: 0.85em; }
  .log-section { width: 100%; border-left: none; border-top: 1px solid #30363d; height: 130px; flex-shrink: 0; }
  .log-section h3 { display: inline; }
  .moverlay { top: 4px; left: 4px; }
}

/* ── Very small (≤400px) ── */
@media (max-width: 400px) {
  #three-wrap { height: 32vh; }
  .dpad { grid-template-columns: repeat(3, 64px); grid-template-rows: repeat(3, 58px); gap: 6px; }
}
</style>
</head><body>
<header>
  <div class="dot" id="dot"></div>
  <h1>STM32 Robot</h1>
  <span id="hstatus" style="color:#3d444d">Connecting...</span>
  <span class="hinfo">WASD / Space=Stop &nbsp;|&nbsp; Drag to rotate</span>
</header>
<div class="main">

  <div id="three-wrap">
    <div class="moverlay">
      <div class="mbar-row"><span style="color:#8b949e;width:18px">M0</span><div class="mbar-track"><div class="mbar-fill" id="b0"></div></div></div>
      <div class="mbar-row"><span style="color:#8b949e;width:18px">M1</span><div class="mbar-track"><div class="mbar-fill" id="b1"></div></div></div>
      <div class="mbar-row"><span style="color:#8b949e;width:18px">M2</span><div class="mbar-track"><div class="mbar-fill" id="b2"></div></div></div>
      <div class="mbar-row"><span style="color:#8b949e;width:18px">M3</span><div class="mbar-track"><div class="mbar-fill" id="b3"></div></div></div>
    </div>
    <div class="hint3d">Drag to rotate &bull; Scroll to zoom</div>
  </div>

  <div class="ctrl-section">
    <!-- Speed (full width on mobile) -->
    <div class="speed-block" style="width:100%">
      <h3>Speed</h3>
      <div class="speed-row">
        <input type="range" id="spd" min="20" max="100" value="70">
        <span class="spd-val" id="spdv">70%</span>
      </div>
    </div>

    <!-- D-pad -->
    <div class="dpad-block">
      <h3>Drive</h3>
      <div class="dpad">
        <div></div>
        <button id="bfwd" onmousedown="pressCmd('forward')" onmouseup="releaseCmd()" ontouchstart="e(event,'forward')" ontouchend="releaseCmd()">&#9650;</button>
        <div></div>
        <button id="blft" onmousedown="pressCmd('left')" onmouseup="releaseCmd()" ontouchstart="e(event,'left')" ontouchend="releaseCmd()">&#9668;</button>
        <button class="stop-btn" onmousedown="applyLocalCommand('stop',0);cmd('stop')" ontouchstart="et(event)">&#9632;</button>
        <button id="brgt" onmousedown="pressCmd('right')" onmouseup="releaseCmd()" ontouchstart="e(event,'right')" ontouchend="releaseCmd()">&#9658;</button>
        <div></div>
        <button id="bbwd" onmousedown="pressCmd('backward')" onmouseup="releaseCmd()" ontouchstart="e(event,'backward')" ontouchend="releaseCmd()">&#9660;</button>
        <div></div>
      </div>
      <div class="kbd-hint">W A S D &mdash; move &nbsp;|&nbsp; Space &mdash; stop</div>
    </div>

    <!-- Individual motors -->
    <div class="motor-block">
      <h3>Motors</h3>
      <div class="mbtns">
        <button id="mb0" onclick="toggleM(0)">Motor 0</button>
        <button id="mb1" onclick="toggleM(1)">Motor 1</button>
        <button id="mb2" onclick="toggleM(2)">Motor 2</button>
        <button id="mb3" onclick="toggleM(3)">Motor 3</button>
      </div>
    </div>
  </div>

  <div class="log-section">
    <h3>Live Events</h3>
    <div class="log-list" id="log"></div>
  </div>
</div>

<script>
// ============================================================================
// THREE.JS SCENE
// ============================================================================
var wrap = document.getElementById('three-wrap');
var W = wrap.clientWidth, H = wrap.clientHeight;

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x080c12);
scene.fog = new THREE.FogExp2(0x080c12, 0.035);

var camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
camera.position.set(0, 5.5, 9);
camera.lookAt(0, 0.8, 0);

var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

function onResize() {
    var nw = wrap.clientWidth, nh = wrap.clientHeight;
    if (nw > 0 && nh > 0) {
        W = nw; H = nh;
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        renderer.setSize(W, H);
        frameObject(car, camera, orbitControls, 1.35);
    }
}
window.addEventListener('resize', onResize);
window.addEventListener('load', onResize);

var orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, 0.8, 0);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.06;
orbitControls.enablePan = false;
orbitControls.minDistance = 3;
orbitControls.maxDistance = 25;
orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;
orbitControls.update();

scene.add(new THREE.AmbientLight(0x223355, 0.8));
var sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
sun.shadow.camera.top  =  12; sun.shadow.camera.bottom = -12;
scene.add(sun);
scene.add(new THREE.DirectionalLight(0x3355aa, 0.4)).position.set(-6, 4, -8);

var ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x0a0e14 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
var grid = new THREE.GridHelper(60, 60, 0x1a2535, 0x111922);
grid.position.y = 0.002; scene.add(grid);

var ring = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x0d2d4a, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003; scene.add(ring);

// --- Car ---
var car = new THREE.Group();
var chassisMat = new THREE.MeshPhongMaterial({ color: 0x0f2a50, specular: 0x1a4488, shininess: 80 });

var chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 3.2), chassisMat);
chassis.position.set(0, 0.46, 0); chassis.castShadow = true; chassis.receiveShadow = true;
car.add(chassis);

[-0.87, 0.87].forEach(function(x) {
    var sk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 3.0), new THREE.MeshPhongMaterial({ color: 0x081a35 }));
    sk.position.set(x, 0.36, 0); sk.castShadow = true; car.add(sk);
});

var cab = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.42, 1.7), new THREE.MeshPhongMaterial({ color: 0x0a1d38, specular: 0x112244, shininess: 40 }));
cab.position.set(0, 0.81, -0.15); cab.castShadow = true; car.add(cab);

var glassMat = new THREE.MeshPhongMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.28, specular: 0xaaddff, shininess: 120, side: THREE.DoubleSide });
var wfGeo = new THREE.PlaneGeometry(1.2, 0.38);
var wf = new THREE.Mesh(wfGeo, glassMat); wf.position.set(0, 0.88, 0.71); wf.rotation.x = -0.38; car.add(wf);
var wb = new THREE.Mesh(wfGeo.clone(), glassMat.clone()); wb.position.set(0, 0.88, -1.0); wb.rotation.x = 0.38; car.add(wb);
[-0.68, 0.68].forEach(function(x) {
    var sw = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), glassMat.clone());
    sw.position.set(x, 0.85, -0.15); sw.rotation.y = Math.PI / 2; car.add(sw);
});

var hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.8), chassisMat); hood.position.set(0, 0.61, 1.2); hood.castShadow = true; car.add(hood);
var trunk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.6), chassisMat); trunk.position.set(0, 0.61, -1.2); trunk.castShadow = true; car.add(trunk);

var bumpMat = new THREE.MeshPhongMaterial({ color: 0x0a1525 });
var bump1 = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.22, 0.12), bumpMat);
bump1.position.set(0, 0.42, 1.63); car.add(bump1);
var bump2 = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.22, 0.12), bumpMat.clone());
bump2.position.set(0, 0.42, -1.63); car.add(bump2);

var stripeMat = new THREE.MeshPhongMaterial({ color: 0x58a6ff, emissive: 0x1a3d80, shininess: 100 });
[-0.87, 0.87].forEach(function(x) {
    var s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 2.9), stripeMat.clone());
    s.position.set(x, 0.58, 0); car.add(s);
});

var hlGeo = new THREE.BoxGeometry(0.28, 0.1, 0.06);
[-0.55, 0.55].forEach(function(x) {
    var hl = new THREE.Mesh(hlGeo, new THREE.MeshPhongMaterial({ color: 0xffffcc, emissive: 0x886600 }));
    hl.position.set(x, 0.55, 1.65); car.add(hl);
    var pl = new THREE.PointLight(0xffffaa, 0.4, 4); pl.position.set(x, 0.55, 1.8); car.add(pl);
    var tl = new THREE.Mesh(hlGeo.clone(), new THREE.MeshPhongMaterial({ color: 0xff1111, emissive: 0x660000 }));
    tl.position.set(x, 0.55, -1.65); car.add(tl);
});

var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 6), new THREE.MeshPhongMaterial({ color: 0x888888 }));
ant.position.set(0.3, 1.23, -0.5); car.add(ant);

// --- Wheels ---
// M0=LEFT-FRONT, M1=LEFT-REAR (Driver1), M2=RIGHT-FRONT, M3=RIGHT-REAR (Driver2)
var wheelDefs = [
    { x: -1.08, y: 0.36, z:  1.05, id: 0 },  // M0 LEFT-FRONT
    { x: -1.08, y: 0.36, z: -1.05, id: 1 },  // M1 LEFT-REAR
    { x:  1.08, y: 0.36, z:  1.05, id: 2 },  // M2 RIGHT-FRONT
    { x:  1.08, y: 0.36, z: -1.05, id: 3 }   // M3 RIGHT-REAR
];
var pivots = [], glowLights = [], tireMats = [];

wheelDefs.forEach(function(wd) {
    var wg = new THREE.Group(); wg.position.set(wd.x, wd.y, wd.z);
    var pivot = new THREE.Group(); wg.add(pivot);
    var tireMat = new THREE.MeshPhongMaterial({ color: 0x0c0c0c, specular: 0x1a1a1a, shininess: 15 });
    var tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20), tireMat);
    tire.rotation.z = Math.PI / 2; tire.castShadow = true; pivot.add(tire);
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.26, 6),
        new THREE.MeshPhongMaterial({ color: 0x2a2a2a, specular: 0x999999, shininess: 90 }));
    rim.rotation.z = Math.PI / 2; pivot.add(rim);
    for (var k = 0; k < 3; k++) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.04),
            new THREE.MeshPhongMaterial({ color: 0x555555, specular: 0xaaaaaa, shininess: 80 }));
        sp.rotation.x = (k / 3) * Math.PI; pivot.add(sp);
    }
    for (var t = 0; t < 8; t++) {
        var tMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.05),
            new THREE.MeshPhongMaterial({ color: 0x1a1a1a }));
        var ang = (t / 8) * Math.PI * 2;
        tMesh.position.y = Math.sin(ang) * 0.34; tMesh.position.z = Math.cos(ang) * 0.34;
        tMesh.rotation.x = ang; pivot.add(tMesh);
    }
    var glow = new THREE.PointLight(0x3fb950, 0, 2.2); wg.add(glow);
    car.add(wg);
    pivots.push(pivot); glowLights.push(glow); tireMats.push(tireMat);
});

car.position.y = 0;
scene.add(car);

function frameObject(object, cam, controls, fitOffset) {
    fitOffset = fitOffset || 1.2;
    var box = new THREE.Box3().setFromObject(object);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    controls.update();
    var maxSize = Math.max(size.x, size.y, size.z);
    var fitHeightDistance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)));
    var fitWidthDistance = cam.aspect > 0 ? fitHeightDistance / cam.aspect : fitHeightDistance;
    var distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);
    var direction = new THREE.Vector3().subVectors(cam.position, center).normalize();
    cam.near = distance / 100;
    cam.far = distance * 100;
    cam.updateProjectionMatrix();
    cam.position.copy(direction.multiplyScalar(distance).add(center));
    cam.lookAt(center);
    controls.update();
}

// --- Motor state ---
var mState = { 0:{dir:'stop',spd:0}, 1:{dir:'stop',spd:0}, 2:{dir:'stop',spd:0}, 3:{dir:'stop',spd:0} };
var worldVelocity = 0;

function updateMotorVisual(id, dir, spd) {
    glowLights[id].intensity = spd > 0 ? (spd / 100) * 1.8 : 0;
    glowLights[id].color.setHex(dir === 'backward' ? 0xff6600 : 0x3fb950);
    tireMats[id].emissive.setHex(spd > 0 ? (dir === 'backward' ? 0x1a0800 : 0x042008) : 0x000000);
    var fill = document.getElementById('b' + id);
    if (fill) {
        fill.style.width = spd + '%';
        fill.style.background = spd > 0 ? (dir === 'backward' ? '#e3b341' : '#3fb950') : '#333';
    }
}

renderer.domElement.ondblclick = function() { frameObject(car, camera, orbitControls, 1.35); };

function animate() {
    requestAnimationFrame(animate);

    // Move world past the car (treadmill effect)
    ground.position.z += worldVelocity;
    grid.position.z   += worldVelocity;
    // Grid: wrap every 1 unit (= 1 cell) for seamless loop
    if (grid.position.z >  1) grid.position.z -= 1;
    if (grid.position.z < -1) grid.position.z += 1;
    // Ground: wrap every 60 units (plane size)
    if (ground.position.z >  60) ground.position.z -= 60;
    if (ground.position.z < -60) ground.position.z += 60;

    for (var i = 0; i < 4; i++) {
        var m = mState[i];
        if (m.spd > 0) {
            var step = (m.spd / 100) * 0.055;
            pivots[i].rotation.x += m.dir === 'forward' ? step : -step;
        }
    }
    orbitControls.update();
    renderer.render(scene, camera);
}
animate();

// ============================================================================
// WEBSOCKET  (replaces HTTP polling)
// ============================================================================
var wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
var ws = null;
var wsReconnectTimer = null;

function wsConnect() {
    ws = new WebSocket(wsProto + '//' + location.host);

    ws.onopen = function() {
        document.getElementById('dot').className = 'dot on';
        document.getElementById('hstatus').textContent = 'Connected (WebSocket)';
        document.getElementById('hstatus').style.color = '#3fb950';
        clearTimeout(wsReconnectTimer);
    };

    ws.onmessage = function(e) {
        var msg = JSON.parse(e.data);
        if (msg.type === 'history') {
            msg.events.forEach(function(ev) { processEvent(ev.data); });
        } else if (msg.type === 'event') {
            processEvent(msg.data);
            addLog(msg.data);
        }
    };

    ws.onclose = function() {
        document.getElementById('dot').className = 'dot';
        document.getElementById('hstatus').textContent = 'Reconnecting...';
        document.getElementById('hstatus').style.color = '#e3b341';
        wsReconnectTimer = setTimeout(wsConnect, 2000);
    };

    ws.onerror = function() { ws.close(); };
}

function processEvent(data) {
    if (data.motor !== undefined) {
        var id = data.motor;
        mState[id] = { dir: data.direction || 'stop', spd: data.speed || 0 };
        updateMotorVisual(id, mState[id].dir, mState[id].spd);
    }
}

wsConnect();

// ============================================================================
// CONTROLS
// ============================================================================
var speed = 70;
var mOn = new Set();
var currentAction = null;

document.getElementById('spd').oninput = function(e) {
    speed = +e.target.value;
    document.getElementById('spdv').textContent = speed + '%';
};

var KEYS    = { w:'forward', ArrowUp:'forward', s:'backward', ArrowDown:'backward', a:'left', ArrowLeft:'left', d:'right', ArrowRight:'right', ' ':'stop' };
var BTNMAP  = { w:'bfwd', ArrowUp:'bfwd', s:'bbwd', ArrowDown:'bbwd', a:'blft', ArrowLeft:'blft', d:'brgt', ArrowRight:'brgt' };
var held    = new Set();

document.addEventListener('keydown', function(e) {
    var a = KEYS[e.key];
    if (!a || held.has(e.key)) return;
    held.add(e.key);
    var bid = BTNMAP[e.key];
    if (bid) document.getElementById(bid).classList.add('pressed');
    pressCmd(a);
    e.preventDefault();
});
document.addEventListener('keyup', function(e) {
    if (!KEYS[e.key]) return;
    held.delete(e.key);
    var bid = BTNMAP[e.key];
    if (bid) document.getElementById(bid).classList.remove('pressed');
    if (KEYS[e.key] !== 'stop') releaseCmd();
});

function applyLocalCommand(action, spd) {
    var f = {dir:'forward',spd:spd}, b = {dir:'backward',spd:spd}, s = {dir:'stop',spd:0};
    // Motor layout: M0=L-front, M1=L-rear, M2=R-front, M3=R-rear
    var map = { forward:[f,f,f,f], backward:[b,b,b,b], left:[b,b,f,f], right:[f,f,b,b], stop:[s,s,s,s] };
    var states = map[action] || map.stop;
    for (var i = 0; i < 4; i++) { mState[i] = states[i]; updateMotorVisual(i, states[i].dir, states[i].spd); }
    if (action === 'forward')        worldVelocity =  (spd / 100) * 0.1;
    else if (action === 'backward')  worldVelocity = -(spd / 100) * 0.1;
    else                             worldVelocity = 0;
}

function pressCmd(action) { currentAction = action; applyLocalCommand(action, speed); cmd(action); }
function releaseCmd() { if (currentAction && currentAction !== 'stop') { applyLocalCommand('stop', 0); cmd('stop'); } currentAction = null; }
// Touch helpers: prevent scroll/zoom on D-pad press
function e(ev, action) { ev.preventDefault(); pressCmd(action); }
function et(ev) { ev.preventDefault(); applyLocalCommand('stop', 0); cmd('stop'); }

function cmd(action) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command', action: action, speed: speed }));
    }
}

function toggleM(id) {
    if (mOn.has(id)) {
        mOn.delete(id);
        document.getElementById('mb' + id).classList.remove('on');
        mState[id] = {dir:'stop', spd:0}; updateMotorVisual(id, 'stop', 0);
        cmd('motor_stop_' + id);
        if (ws && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'command', action: 'motor', id: id, dir: 'stop', speed: 0 }));
    } else {
        mOn.add(id);
        document.getElementById('mb' + id).classList.add('on');
        mState[id] = {dir:'forward', spd:speed}; updateMotorVisual(id, 'forward', speed);
        if (ws && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'command', action: 'motor', id: id, dir: 'forward', speed: speed }));
    }
}

// ============================================================================
// LOG
// ============================================================================
function addLog(data) {
    var log = document.getElementById('log');
    var d = document.createElement('div');
    var t = new Date().toTimeString().slice(0, 8);
    var msg = '', cls = '';
    if (data.button !== undefined)     { msg = 'BTN_' + data.button + ': ' + data.state; cls = 'le-btn'; }
    else if (data.motor !== undefined) { msg = 'M' + data.motor + ': ' + (data.direction || 'stop') + ' ' + (data.speed || 0) + '%'; cls = 'le-motor'; }
    else { msg = JSON.stringify(data); }
    d.className = 'le ' + cls;
    d.innerHTML = '<span class="lt">' + t + '<' + '/span>' + msg;
    log.prepend(d);
    if (log.children.length > 60) log.removeChild(log.lastChild);
}
<\/script>
</body></html>`;

// ============================================================================
// HTTP ROUTES
// ============================================================================

app.get('/', (_, res) => res.send(HTML));

app.get('/status', (_, res) => res.json({
    status:      'running',
    uptime:      process.uptime(),
    browsers:    [...wss.clients].filter(c => c !== esp32Socket && c.readyState === 1).length,
    esp32:       esp32Socket ? 'connected' : 'disconnected',
    events:      recentEvents.length
}));

app.use((_, res) => res.status(404).send('404'));

// ============================================================================
// START
// ============================================================================

server.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STM32 Robot Control  [WebSocket + Three.js]');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n✅ Server: http://localhost:${PORT}`);
    console.log(`📡 Network: http://${getLocalIP()}:${PORT}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets))
        for (const net of nets[name])
            if (net.family === 'IPv4' && !net.internal) return net.address;
    return '0.0.0.0';
}

process.on('uncaughtException', e => console.error('❌ Error:', e.message));
process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); process.exit(0); });
