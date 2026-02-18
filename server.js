/**
 * Node.js server for STM32 Robot Control
 * - Receives telemetry from ESP32 via HTTP POST /data
 * - Serves live 3D dashboard (Three.js) at GET /
 * - Forwards browser commands to ESP32 via GET /command
 */

const express = require('express');
const app = express();
const PORT = 3000;

const recentEvents = [];
let pendingCommand = null;
let eventSeq = 0;

app.use(express.json());

app.use((req, _, next) => {
    if (req.path !== '/command' && req.path !== '/events')
        console.log(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${req.path}`);
    next();
});

// ============================================================================
// DASHBOARD HTML
// ============================================================================

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>STM32 Robot Control</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"><\/script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #e6edf3; font-family: 'Courier New', monospace; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
header { background: #161b22; padding: 10px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #30363d; flex-shrink: 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #3d444d; transition: all 0.5s; }
.dot.on { background: #3fb950; box-shadow: 0 0 8px #3fb950; }
h1 { font-size: 1em; color: #58a6ff; }
.hinfo { margin-left: auto; color: #3d444d; font-size: 0.75em; }
.main { display: flex; flex: 1; overflow: hidden; }
#three-wrap { flex: 1; position: relative; overflow: hidden; }
#three-wrap canvas { display: block; }
.moverlay { position: absolute; top: 10px; left: 10px; display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
.mbar-row { display: flex; align-items: center; gap: 6px; font-size: 0.7em; background: rgba(13,17,23,0.75); padding: 3px 8px; border-radius: 4px; border: 1px solid #21262d; }
.mbar-track { width: 55px; height: 4px; background: #21262d; border-radius: 2px; overflow: hidden; }
.mbar-fill { height: 100%; width: 0%; background: #3fb950; border-radius: 2px; transition: width 0.3s, background 0.3s; }
.hint3d { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); color: #3d444d; font-size: 0.68em; pointer-events: none; white-space: nowrap; }
.ctrl-section { width: 250px; background: #161b22; border-left: 1px solid #30363d; padding: 16px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex-shrink: 0; }
.speed-row { display: flex; align-items: center; gap: 8px; }
.speed-row input { flex: 1; accent-color: #58a6ff; }
.spd-val { color: #58a6ff; font-size: 0.85em; width: 32px; }
.dpad { display: grid; grid-template-columns: repeat(3, 50px); grid-template-rows: repeat(3, 44px); gap: 4px; margin: 0 auto; }
.dpad button { background: #21262d; border: 1px solid #30363d; color: #8b949e; border-radius: 6px; cursor: pointer; font-size: 1.2em; transition: all 0.1s; user-select: none; }
.dpad button:hover { background: #30363d; color: #e6edf3; }
.dpad button.pressed { background: #58a6ff !important; color: #0d1117 !important; border-color: #58a6ff !important; }
.stop-btn { background: #1a0a0a !important; border-color: #c0392b !important; color: #e74c3c !important; }
.stop-btn:hover { background: #e74c3c !important; color: #fff !important; }
h3 { color: #8b949e; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; }
.mbtns { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.mbtns button { padding: 6px; background: #21262d; border: 1px solid #30363d; color: #8b949e; border-radius: 5px; cursor: pointer; font-size: 0.78em; transition: all 0.15s; }
.mbtns button:hover { border-color: #58a6ff; color: #58a6ff; }
.mbtns button.on { background: #58a6ff22; color: #58a6ff; border-color: #58a6ff; }
.kbd-hint { font-size: 0.68em; color: #3d444d; text-align: center; }
.log-section { width: 220px; background: #0d1117; border-left: 1px solid #30363d; display: flex; flex-direction: column; padding: 10px; gap: 6px; flex-shrink: 0; }
.log-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.le { font-size: 0.7em; padding: 3px 6px; border-radius: 3px; }
.le-btn { color: #79c0ff; } .le-motor { color: #e3b341; }
.lt { color: #3fb950; margin-right: 5px; }
</style>
</head><body>
<header>
  <div class="dot" id="dot"></div>
  <h1>STM32 Robot Control</h1>
  <span id="hstatus" style="color:#3d444d;font-size:0.8em">Waiting for data...</span>
  <span class="hinfo">WASD / Space=Stop &nbsp;|&nbsp; Drag to rotate &bull; Scroll to zoom</span>
</header>
<div class="main">

  <div id="three-wrap">
    <div class="moverlay">
      <div class="mbar-row"><span style="color:#8b949e;width:20px">M0</span><div class="mbar-track"><div class="mbar-fill" id="b0"></div></div></div>
      <div class="mbar-row"><span style="color:#8b949e;width:20px">M1</span><div class="mbar-track"><div class="mbar-fill" id="b1"></div></div></div>
      <div class="mbar-row"><span style="color:#8b949e;width:20px">M2</span><div class="mbar-track"><div class="mbar-fill" id="b2"></div></div></div>
      <div class="mbar-row"><span style="color:#8b949e;width:20px">M3</span><div class="mbar-track"><div class="mbar-fill" id="b3"></div></div></div>
    </div>
    <div class="hint3d">Drag to rotate &bull; Scroll to zoom &bull; Right-drag to pan</div>
  </div>

  <div class="ctrl-section">
    <h3>Control</h3>
    <div class="speed-row">
      <span style="font-size:0.75em;color:#8b949e">Speed</span>
      <input type="range" id="spd" min="20" max="100" value="70">
      <span class="spd-val" id="spdv">70%</span>
    </div>
    <div class="dpad">
      <div></div>
      <button id="bfwd" onmousedown="pressCmd('forward')" onmouseup="releaseCmd()" ontouchstart="pressCmd('forward')" ontouchend="releaseCmd()">&#9650;</button>
      <div></div>
      <button id="blft" onmousedown="pressCmd('left')" onmouseup="releaseCmd()" ontouchstart="pressCmd('left')" ontouchend="releaseCmd()">&#9668;</button>
      <button class="stop-btn" onclick="applyLocalCommand('stop',0);cmd('stop')">&#9632;</button>
      <button id="brgt" onmousedown="pressCmd('right')" onmouseup="releaseCmd()" ontouchstart="pressCmd('right')" ontouchend="releaseCmd()">&#9658;</button>
      <div></div>
      <button id="bbwd" onmousedown="pressCmd('backward')" onmouseup="releaseCmd()" ontouchstart="pressCmd('backward')" ontouchend="releaseCmd()">&#9660;</button>
      <div></div>
    </div>
    <div class="kbd-hint">W A S D &mdash; move &nbsp;|&nbsp; Space &mdash; stop</div>
    <div>
      <h3 style="margin-bottom:6px">Individual Motors</h3>
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
// THREE.JS SCENE SETUP
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
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

window.addEventListener('resize', function() {
    W = wrap.clientWidth; H = wrap.clientHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
});

var orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, 0.8, 0);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.06;
orbitControls.minDistance = 3;
orbitControls.maxDistance = 25;
orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;
orbitControls.update();

// ============================================================================
// LIGHTS
// ============================================================================
scene.add(new THREE.AmbientLight(0x223355, 0.8));

var sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
scene.add(sun);

scene.add(new THREE.DirectionalLight(0x3355aa, 0.4).position.set(-6, 4, -8));

// ============================================================================
// GROUND
// ============================================================================
var gGeo = new THREE.PlaneGeometry(60, 60);
var gMat = new THREE.MeshLambertMaterial({ color: 0x0a0e14 });
var ground = new THREE.Mesh(gGeo, gMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

var grid = new THREE.GridHelper(60, 60, 0x1a2535, 0x111922);
grid.position.y = 0.002;
scene.add(grid);

// Outer glow ring under car
var ringGeo = new THREE.RingGeometry(1.8, 2.4, 32);
var ringMat = new THREE.MeshBasicMaterial({ color: 0x0d2d4a, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
var ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.003;
scene.add(ring);

// ============================================================================
// CAR BODY
// ============================================================================
var car = new THREE.Group();

// Chassis
var chassisGeo = new THREE.BoxGeometry(1.7, 0.28, 3.2);
var chassisMat = new THREE.MeshPhongMaterial({ color: 0x0f2a50, specular: 0x1a4488, shininess: 80 });
var chassis = new THREE.Mesh(chassisGeo, chassisMat);
chassis.position.set(0, 0.46, 0);
chassis.castShadow = true;
chassis.receiveShadow = true;
car.add(chassis);

// Lower side skirts
[-0.87, 0.87].forEach(function(x) {
    var skGeo = new THREE.BoxGeometry(0.06, 0.12, 3.0);
    var sk = new THREE.Mesh(skGeo, new THREE.MeshPhongMaterial({ color: 0x081a35 }));
    sk.position.set(x, 0.36, 0);
    sk.castShadow = true;
    car.add(sk);
});

// Cabin
var cabGeo = new THREE.BoxGeometry(1.35, 0.42, 1.7);
var cab = new THREE.Mesh(cabGeo, new THREE.MeshPhongMaterial({ color: 0x0a1d38, specular: 0x112244, shininess: 40 }));
cab.position.set(0, 0.81, -0.15);
cab.castShadow = true;
car.add(cab);

// Windshield front
var wfGeo = new THREE.PlaneGeometry(1.2, 0.38);
var glassMat = new THREE.MeshPhongMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.28, specular: 0xaaddff, shininess: 120, side: THREE.DoubleSide });
var wf = new THREE.Mesh(wfGeo, glassMat);
wf.position.set(0, 0.88, 0.71);
wf.rotation.x = -0.38;
car.add(wf);

// Windshield rear
var wb = new THREE.Mesh(wfGeo.clone(), glassMat.clone());
wb.position.set(0, 0.88, -1.0);
wb.rotation.x = 0.38;
car.add(wb);

// Side windows
[-0.68, 0.68].forEach(function(x) {
    var swGeo = new THREE.PlaneGeometry(1.5, 0.28);
    var sw = new THREE.Mesh(swGeo, glassMat.clone());
    sw.position.set(x, 0.85, -0.15);
    sw.rotation.y = Math.PI / 2;
    car.add(sw);
});

// Hood
var hoodGeo = new THREE.BoxGeometry(1.6, 0.06, 0.8);
var hood = new THREE.Mesh(hoodGeo, chassisMat);
hood.position.set(0, 0.61, 1.2);
hood.castShadow = true;
car.add(hood);

// Trunk
var trunkGeo = new THREE.BoxGeometry(1.6, 0.06, 0.6);
var trunk = new THREE.Mesh(trunkGeo, chassisMat);
trunk.position.set(0, 0.61, -1.2);
trunk.castShadow = true;
car.add(trunk);

// Front bumper
var fbGeo = new THREE.BoxGeometry(1.55, 0.22, 0.12);
var bumpMat = new THREE.MeshPhongMaterial({ color: 0x0a1525 });
var fb = new THREE.Mesh(fbGeo, bumpMat);
fb.position.set(0, 0.42, 1.63);
car.add(fb);

// Rear bumper
var rb = new THREE.Mesh(fbGeo.clone(), bumpMat.clone());
rb.position.set(0, 0.42, -1.63);
car.add(rb);

// Blue accent stripe (both sides)
var stripeGeo = new THREE.BoxGeometry(0.05, 0.06, 2.9);
var stripeMat = new THREE.MeshPhongMaterial({ color: 0x58a6ff, emissive: 0x1a3d80, shininess: 100 });
[-0.87, 0.87].forEach(function(x) {
    var s = new THREE.Mesh(stripeGeo, stripeMat.clone());
    s.position.set(x, 0.58, 0);
    car.add(s);
});

// Headlights
var hlGeo = new THREE.BoxGeometry(0.28, 0.1, 0.06);
var hlMat = new THREE.MeshPhongMaterial({ color: 0xffffcc, emissive: 0x886600, shininess: 100 });
var hlLights = [];
[-0.55, 0.55].forEach(function(x) {
    var hl = new THREE.Mesh(hlGeo, hlMat.clone());
    hl.position.set(x, 0.55, 1.65);
    car.add(hl);
    var pl = new THREE.PointLight(0xffffaa, 0.4, 4);
    pl.position.set(x, 0.55, 1.8);
    car.add(pl);
    hlLights.push(pl);
});

// Tail lights
var tlMat = new THREE.MeshPhongMaterial({ color: 0xff1111, emissive: 0x660000, shininess: 100 });
[-0.55, 0.55].forEach(function(x) {
    var tl = new THREE.Mesh(hlGeo.clone(), tlMat.clone());
    tl.position.set(x, 0.55, -1.65);
    car.add(tl);
});

// Roof antenna
var antGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.35, 6);
var ant = new THREE.Mesh(antGeo, new THREE.MeshPhongMaterial({ color: 0x888888 }));
ant.position.set(0.3, 1.23, -0.5);
car.add(ant);

// ============================================================================
// WHEELS
// ============================================================================
var wheelDefs = [
    { x: -1.08, y: 0.36, z:  1.05, id: 0 },
    { x:  1.08, y: 0.36, z:  1.05, id: 1 },
    { x: -1.08, y: 0.36, z: -1.05, id: 2 },
    { x:  1.08, y: 0.36, z: -1.05, id: 3 }
];

var pivots = [];
var glowLights = [];
var tireMats = [];

wheelDefs.forEach(function(wd) {
    var wg = new THREE.Group();
    wg.position.set(wd.x, wd.y, wd.z);

    // Rotation pivot
    var pivot = new THREE.Group();
    wg.add(pivot);

    // Tire
    var tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20);
    var tireMat = new THREE.MeshPhongMaterial({ color: 0x0c0c0c, specular: 0x1a1a1a, shininess: 15 });
    var tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    pivot.add(tire);
    tireMats.push(tireMat);

    // Rim (hex style)
    var rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 6);
    var rimMat = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, specular: 0x999999, shininess: 90 });
    var rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    pivot.add(rim);

    // Rim spokes (3 spokes)
    for (var k = 0; k < 3; k++) {
        var spGeo = new THREE.BoxGeometry(0.26, 0.04, 0.04);
        var sp = new THREE.Mesh(spGeo, new THREE.MeshPhongMaterial({ color: 0x555555, specular: 0xaaaaaa, shininess: 80 }));
        sp.rotation.x = (k / 3) * Math.PI;
        pivot.add(sp);
    }

    // Tread bumps (8 around circumference)
    for (var t = 0; t < 8; t++) {
        var tGeo = new THREE.BoxGeometry(0.26, 0.04, 0.05);
        var tMesh = new THREE.Mesh(tGeo, new THREE.MeshPhongMaterial({ color: 0x1a1a1a }));
        var ang = (t / 8) * Math.PI * 2;
        tMesh.position.y = Math.sin(ang) * 0.34;
        tMesh.position.z = Math.cos(ang) * 0.34;
        tMesh.rotation.x = ang;
        pivot.add(tMesh);
    }

    // Glow light (green = forward, orange = backward)
    var glow = new THREE.PointLight(0x3fb950, 0, 2.2);
    wg.add(glow);
    glowLights.push(glow);

    car.add(wg);
    pivots.push(pivot);
});

car.position.y = 0;
scene.add(car);

// ============================================================================
// MOTOR STATE
// ============================================================================
var mState = {
    0: { dir: 'stop', spd: 0 },
    1: { dir: 'stop', spd: 0 },
    2: { dir: 'stop', spd: 0 },
    3: { dir: 'stop', spd: 0 }
};

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

// ============================================================================
// ANIMATION LOOP
// ============================================================================
function animate() {
    requestAnimationFrame(animate);
    for (var i = 0; i < 4; i++) {
        var m = mState[i];
        if (m.spd > 0) {
            var step = (m.spd / 100) * 0.055;
            pivots[i].rotation.x += m.dir === 'forward' ? -step : step;
        }
    }
    orbitControls.update();
    renderer.render(scene, camera);
}
animate();

// ============================================================================
// CONTROLS
// ============================================================================
var speed = 70;
var mOn = new Set();
var lastSeq = 0;
var currentAction = null;

document.getElementById('spd').oninput = function(e) {
    speed = +e.target.value;
    document.getElementById('spdv').textContent = speed + '%';
};

var KEYS = { w: 'forward', ArrowUp: 'forward', s: 'backward', ArrowDown: 'backward', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right', ' ': 'stop' };
var BTNMAP = { w: 'bfwd', ArrowUp: 'bfwd', s: 'bbwd', ArrowDown: 'bbwd', a: 'blft', ArrowLeft: 'blft', d: 'brgt', ArrowRight: 'brgt' };
var held = new Set();

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
    var map = { forward:[f,f,f,f], backward:[b,b,b,b], left:[b,f,b,f], right:[f,b,f,b], stop:[s,s,s,s] };
    var states = map[action] || map.stop;
    for (var i = 0; i < 4; i++) { mState[i] = states[i]; updateMotorVisual(i, states[i].dir, states[i].spd); }
}
function pressCmd(action) { currentAction = action; applyLocalCommand(action, speed); cmd(action); }
function releaseCmd() { if (currentAction && currentAction !== 'stop') { applyLocalCommand('stop', 0); cmd('stop'); } currentAction = null; }

async function cmd(action) {
    try {
        await fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action, speed: speed }) });
    } catch(e) {}
}

function toggleM(id) {
    if (mOn.has(id)) {
        mOn.delete(id);
        document.getElementById('mb' + id).classList.remove('on');
        mState[id] = {dir:'stop', spd:0}; updateMotorVisual(id, 'stop', 0);
        fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'motor', id: id, dir: 'stop', speed: 0 }) });
    } else {
        mOn.add(id);
        document.getElementById('mb' + id).classList.add('on');
        mState[id] = {dir:'forward', spd:speed}; updateMotorVisual(id, 'forward', speed);
        fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'motor', id: id, dir: 'forward', speed: speed }) });
    }
}

// ============================================================================
// TELEMETRY POLLING
// ============================================================================
function addLog(data) {
    var log = document.getElementById('log');
    var d = document.createElement('div');
    var t = new Date().toTimeString().slice(0, 8);
    var msg = '', cls = '';
    if (data.button !== undefined)      { msg = 'BTN_' + data.button + ': ' + data.state; cls = 'le-btn'; }
    else if (data.motor !== undefined)  { msg = 'M' + data.motor + ': ' + (data.direction || 'stop') + ' ' + (data.speed || 0) + '%'; cls = 'le-motor'; }
    else { msg = JSON.stringify(data); }
    d.className = 'le ' + cls;
    d.innerHTML = '<span class="lt">' + t + '<' + '/span>' + msg;
    log.prepend(d);
    if (log.children.length > 60) log.removeChild(log.lastChild);
}

async function poll() {
    try {
        var r = await fetch('/events');
        var events = await r.json();
        var newEvs = events.filter(function(e) { return e.seq > lastSeq; });
        if (newEvs.length) {
            document.getElementById('dot').className = 'dot on';
            document.getElementById('hstatus').textContent = 'Connected \u00B7 seq ' + newEvs[newEvs.length-1].seq;
            document.getElementById('hstatus').style.color = '#3fb950';
            lastSeq = newEvs[newEvs.length-1].seq;
            newEvs.forEach(function(ev) {
                addLog(ev.data);
                if (ev.data.motor !== undefined) {
                    var id = ev.data.motor;
                    mState[id] = { dir: ev.data.direction || 'stop', spd: ev.data.speed || 0 };
                    updateMotorVisual(id, mState[id].dir, mState[id].spd);
                }
            });
        }
    } catch(e) {}
}

poll();
setInterval(poll, 500);
<\/script>
</body></html>`;

// ============================================================================
// ROUTES
// ============================================================================

app.get('/', (_, res) => res.send(HTML));

app.get('/events', (_, res) => res.json(recentEvents.slice(-30)));

app.post('/command', (req, res) => {
    pendingCommand = req.body;
    res.json({ ok: true });
});

app.get('/command', (_, res) => {
    const cmd = pendingCommand;
    pendingCommand = null;
    res.json(cmd || {});
});

app.post('/data', (req, res) => {
    const timestamp = new Date().toISOString();
    if (req.body && Object.keys(req.body).length > 0) {
        recentEvents.push({ seq: ++eventSeq, time: timestamp.slice(11, 19), data: req.body });
        if (recentEvents.length > 50) recentEvents.shift();
        if (req.body.button !== undefined)
            console.log(`[${timestamp.slice(11,19)}] BTN_${req.body.button}: ${req.body.state}`);
        else if (req.body.motor !== undefined)
            console.log(`[${timestamp.slice(11,19)}] Motor ${req.body.motor}: ${req.body.direction} ${req.body.speed}%`);
    }
    res.json({ status: 'OK', timestamp });
});

app.get('/status', (_, res) => res.json({ status: 'running', uptime: process.uptime(), timestamp: new Date().toISOString() }));

app.use((_, res) => res.status(404).send('404 - Not Found'));

// ============================================================================
// START
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.clear();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STM32 Robot Control Server  [Three.js 3D Dashboard]');
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

process.on('uncaughtException', e => console.error('\n❌ Error:', e.message));
process.on('unhandledRejection', e => console.error('\n❌ Rejection:', e));
process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); process.exit(0); });
