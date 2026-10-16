const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "public");
const MAX_PLAYERS = 8;
const TICK_MS = 5000;
const rooms = new Map();
const sockets = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const full = path.normalize(path.join(ROOT, requested));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}); return res.end("Не найдено"); }
    res.writeHead(200, {"Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control":"no-cache"});
    res.end(data);
  });
});
const wss = new WebSocket.Server({ server, maxPayload: 16 * 1024 });

function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}
function broadcast(room, type, data = {}) {
  for (const player of room.players.values()) send(player.ws, type, data);
}
function cleanName(name) {
  return String(name || "Игрок").replace(/[<>]/g, "").trim().slice(0, 18) || "Игрок";
}
function publicRoom(room) {
  return { code: room.code, status: room.status, hostId: room.hostId,
    players: [...room.players.values()].map(p => ({id:p.id, name:p.name, color:p.color, ready:p.ready, country:p.country})),
    maxPlayers: MAX_PLAYERS, tick: room.tick, state: room.state };
}
function snapshot(room) { broadcast(room, "room", { room: publicRoom(room) }); }
function getPlayer(ws) {
  const s = sockets.get(ws);
  if (!s) return null;
  const room = rooms.get(s.room);
  if (!room) return null;
  return { room, player: room.players.get(s.id) };
}
function leave(ws) {
  const s = sockets.get(ws);
  if (!s) return;
  sockets.delete(ws);
  const room = rooms.get(s.room);
  if (!room) return;
  room.players.delete(s.id);
  if (room.players.size === 0) { clearInterval(room.timer); rooms.delete(room.code); return; }
  if (room.hostId === s.id) room.hostId = room.players.keys().next().value;
  broadcast(room, "notice", { message: `${s.name || "Игрок"} покинул комнату` });
  snapshot(room);
}
function createRoom(ws, msg) {
  leave(ws);
  let code;
  do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(code));
  const room = { code, status:"lobby", hostId:null, players:new Map(), tick:0, state:null, timer:null };
  rooms.set(code, room);
  joinRoom(ws, { ...msg, code }, room);
}
function joinRoom(ws, msg, knownRoom) {
  leave(ws);
  const code = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const room = knownRoom || rooms.get(code);
  if (!room) return send(ws, "error", { message:"Комната не найдена. Проверь код." });
  if (room.players.size >= MAX_PLAYERS) return send(ws, "error", { message:"В комнате уже 8 игроков." });
  if (room.status === "playing") return send(ws, "error", { message:"Игра уже началась." });
  const id = crypto.randomUUID();
  const palette = ["#55d6be","#ffcb69","#ff6b6b","#7aa2ff","#c792ea","#f78fb3","#a3e635","#fb923c"];
  const player = { id, ws, name:cleanName(msg.name), color:palette[room.players.size % palette.length], ready:false, country:null };
  room.players.set(id, player);
  if (!room.hostId) room.hostId = id;
  sockets.set(ws, { room:room.code, id, name:player.name });
  send(ws, "joined", { id, code:room.code });
  broadcast(room, "notice", { message:`${player.name} вошёл в комнату` });
  snapshot(room);
}
function startGame(room, requesterId) {
  if (room.hostId !== requesterId) return;
  if (room.players.size < 2) return send(room.players.get(requesterId)?.ws, "error", {message:"Для сетевой игры нужны минимум 2 игрока."});
  room.status = "playing";
  room.tick = 0;
  room.state = { countries:{}, resources:{}, armies:{}, turn:0, log:[{at:Date.now(), text:"Кампания началась"}] };
  const list = [...room.players.values()];
  list.forEach((p, i) => {
    p.country = p.country || ["Russia","United States of America","China","Brazil","India","Australia","France","South Africa"][i];
    room.state.countries[p.country] = p.id;
    room.state.resources[p.id] = 100;
    room.state.armies[p.id] = 20;
  });
  room.timer = setInterval(() => {
    if (room.status !== "playing") return;
    room.tick++;
    for (const p of room.players.values()) {
      room.state.resources[p.id] = Math.min(9999, (room.state.resources[p.id] || 0) + 8);
      room.state.armies[p.id] = Math.min(999, (room.state.armies[p.id] || 0) + 1);
    }
    room.state.turn = room.tick;
    if (room.tick % 3 === 0) room.state.log.unshift({at:Date.now(), text:`День ${room.tick}: экономика произвела ресурсы`});
    room.state.log = room.state.log.slice(0, 30);
    broadcast(room, "state", { room:publicRoom(room) });
  }, TICK_MS);
  broadcast(room, "notice", {message:"Игра запущена! Доход и армия растут каждые 5 секунд."});
  snapshot(room);
}
function handleAction(room, player, msg) {
  if (room.status !== "playing") return;
  const state = room.state;
  if (msg.action === "recruit") {
    const cost = 25;
    if ((state.resources[player.id] || 0) < cost) return send(player.ws, "error", {message:"Не хватает ресурсов (нужно 25)."});
    state.resources[player.id] -= cost;
    state.armies[player.id] = (state.armies[player.id] || 0) + 10;
    state.log.unshift({at:Date.now(), text:`${player.name} нанял 10 отрядов`});
  } else if (msg.action === "upgrade") {
    const cost = 40;
    if ((state.resources[player.id] || 0) < cost) return send(player.ws, "error", {message:"Не хватает ресурсов (нужно 40)."});
    state.resources[player.id] -= cost;
    player.income = (player.income || 8) + 3;
    state.log.unshift({at:Date.now(), text:`${player.name} улучшил экономику`});
  } else if (msg.action === "attack") {
    const target = String(msg.country || "").slice(0, 80);
    const owner = state.countries[target];
    if (!target || target === player.country || owner === player.id) return send(player.ws, "error", {message:"Выбери чужую страну на карте."});
    const cost = 15;
    if ((state.resources[player.id] || 0) < cost) return send(player.ws, "error", {message:"Для атаки нужно 15 ресурсов."});
    state.resources[player.id] -= cost;
    const defending = owner ? (state.armies[owner] || 0) : 0;
    const attacking = state.armies[player.id] || 0;
    if (attacking > defending + 8) {
      if (owner) {
        const previous = room.players.get(owner);
        if (previous) previous.country = previous.country === target ? null : previous.country;
      }
      state.countries[target] = player.id;
      state.armies[player.id] = Math.max(1, attacking - Math.ceil(defending * .4));
      state.log.unshift({at:Date.now(), text:`${player.name} захватил(а) ${target}`});
    } else {
      state.armies[player.id] = Math.max(1, attacking - 5);
      state.log.unshift({at:Date.now(), text:`Атака ${player.name} на ${target} отбита`});
    }
  }
  state.log = state.log.slice(0, 30);
  snapshot(room);
}
wss.on("connection", ws => {
  send(ws, "hello", {maxPlayers:MAX_PLAYERS});
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, "error", {message:"Некорректный запрос."}); }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "create") return createRoom(ws, msg);
    if (msg.type === "join") return joinRoom(ws, msg);
    const context = getPlayer(ws);
    if (!context) return send(ws, "error", {message:"Сначала создай или войди в комнату."});
    const {room, player} = context;
    if (msg.type === "ready") { player.ready = !!msg.value; snapshot(room); }
    else if (msg.type === "start") startGame(room, player.id);
    else if (msg.type === "action") handleAction(room, player, msg);
    else if (msg.type === "leave") leave(ws);
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});
server.listen(PORT, "0.0.0.0", () => console.log(`World Conquest running at http://localhost:${PORT}`));
