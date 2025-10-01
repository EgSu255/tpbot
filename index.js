const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { pathfinder, Movements, goals: { GoalFollow } } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');
const util = require('util');

/* === Config === */
const HOST = 'mariano123.ddns.net';
const PORT = 25565;

const clickableBlocks = new Set([
  'oak_trapdoor','spruce_trapdoor','birch_trapdoor','jungle_trapdoor',
  'acacia_trapdoor','dark_oak_trapdoor','mangrove_trapdoor','cherry_trapdoor',
  'iron_trapdoor','lever','stone_button','oak_button','acacia_button',
  'spruce_button','birch_button','jungle_button','dark_oak_button',
  'crimson_button','warped_button','chest','oak_door','iron_door'
]);

const allowedUsers = new Set(['sav4da'].map(u => u.toLowerCase()));

/* === Globals that persist across reconnects === */
let bot = null;
let antiAfkTimer = null;
let reconnectTimer = null;
let backoffMs = 5000;

/* === Helpers === */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pretty = (obj) => {
  try { return typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); }
  catch { return util.inspect(obj, { depth: null, colors: false }); }
};

/* === Queue tracking === */
let lastQueuePos = null;
function parseQueue(text) {
  const patterns = [
    /position in queue[:\s]+(\d+)/i,
    /queue position[:\s]+(\d+)/i,
    /you are\s+#?(\d+)\s+in queue/i,
    /in queue[:\s]+#?(\d+)/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const pos = parseInt(m[1], 10);
    if (!Number.isFinite(pos)) return;
    if (lastQueuePos == null) console.log(`Queue position: ${pos}`);
    else if (pos < lastQueuePos) console.log(`Queue advanced: ${pos} (−${lastQueuePos - pos})`);
    else if (pos > lastQueuePos) console.log(`Queue went backward: ${lastQueuePos} -> ${pos} (+${pos - lastQueuePos})`);
    lastQueuePos = pos;
    return;
  }
}

/* 2b2t whisper parsing */
function parseWhisperLine(text) {
  const tests = [
    /^(\w{1,16})\s+whispers:\s+(.+)$/i,
    /^(?:\[)?(\w{1,16})\s*->\s*(?:you|You)\]?:\s+(.+)$/,
    /^From\s+(\w{1,16}):\s+(.+)$/i,
    /^(?:\[?PM\]?|\[?MSG\]?)\s+(\w{1,16}):\s+(.+)$/i
  ];
  for (const re of tests) {
    const m = text.match(re);
    if (m) return { username: m[1], content: m[2] };
  }
  return null;
}

/* === Actions === */
async function doDoubleClickNearestClickable() {
  const radius = 3;
  const origin = bot.entity.position.clone();
  let closestBlock = null;
  let closestDistance = Infinity;

  for (let x = -radius; x <= radius; x++) {
    for (let y = -1; y <= 2; y++) {
      for (let z = -radius; z <= radius; z++) {
        const pos = origin.offset(x, y, z);
        const block = bot.blockAt(pos, true);
        if (!block) continue;
        if (!clickableBlocks.has(block.name)) continue;
        const dist = origin.distanceTo(block.position);
        if (dist < closestDistance) { closestBlock = block; closestDistance = dist; }
      }
    }
  }
  if (!closestBlock) return 'No clickable blocks nearby.';
  try {
    const lookPos = closestBlock.position.plus(new Vec3(0.5, 0.5, 0.5));
    await bot.lookAt(lookPos, true);
    bot.activateBlock(closestBlock);
    await sleep(200);
    bot.activateBlock(closestBlock);
    return `Double-clicked ${closestBlock.name}`;
  } catch {
    return 'Failed to click.';
  }
}

function doKill() { bot.chat('/kill'); console.log('Executed /kill'); }

/* === Pathfinder follow === */
let movements = null;
let followingUser = null;

function startFollow(username) {
  const u = String(username).toLowerCase();
  const target = bot.players[u]?.entity;
  if (!target) return `Cannot see ${username}.`;
  if (!movements) movements = new Movements(bot, minecraftData(bot.version));
  bot.pathfinder.setMovements(movements);
  bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
  followingUser = u;
  return `Following ${username}.`;
}

function stopFollow() {
  bot.pathfinder.setGoal(null);
  const msg = followingUser ? `Stopped following ${followingUser}.` : 'Not following.';
  followingUser = null;
  return msg;
}

/* === Attach all listeners to a bot instance === */
function wireBot(b) {
  b.loadPlugin(pathfinder);

  b.on('login', () => {
    backoffMs = 5000; // reset on successful login
  });

  b.on('spawn', () => {
    b.chat('Ready. Commands: tp, kill, startfollow, stopfollow.');
    if (lastQueuePos != null) { console.log('Left queue. Spawned on server.'); lastQueuePos = null; }
    if (antiAfkTimer) clearInterval(antiAfkTimer);
    antiAfkTimer = setInterval(() => { if (b.entity) b.swingArm('right'); }, 20_000);
  });

  b.on('actionBar', (j) => parseQueue(j.toString()));
  b.on('message', async (j) => {
    const text = j.toString();
    parseQueue(text);
    const w = parseWhisperLine(text);
    if (!w) return;
    const userLower = w.username.toLowerCase();
    if (!allowedUsers.has(userLower)) return;
    const msg = w.content.trim().toLowerCase();
    if (msg === 'tp') b.chat(await doDoubleClickNearestClickable());
    else if (msg === 'kill') { doKill(); b.chat('Executed /kill'); }
    else if (msg === 'startfollow') b.chat(startFollow(w.username));
    else if (msg === 'stopfollow') b.chat(stopFollow());
  });

  b.on('whisper', async (username, message) => {
    if (!allowedUsers.has(username.toLowerCase())) return;
    const msg = message.trim().toLowerCase();
    if (msg === 'tp') b.whisper(username, await doDoubleClickNearestClickable());
    else if (msg === 'kill') { doKill(); b.whisper(username, 'Executed /kill'); }
    else if (msg === 'startfollow') b.whisper(username, startFollow(username));
    else if (msg === 'stopfollow') b.whisper(username, stopFollow());
  });

  // Detailed kick diagnostics
  b.on('kicked', (reason, loggedIn) => {
    console.log('KICKED. loggedIn:', loggedIn);
    console.log('Reason:', pretty(reason));
    scheduleReconnect('kicked');
  });

  // Pre-login kick packet
  if (b._client && typeof b._client.on === 'function') {
    b._client.on('kick_disconnect', (packet) => {
      console.log('kick_disconnect packet:', pretty(packet));
    });
  }

  b.on('error', (err) => {
    console.log(`Socket error: ${err && err.message ? err.message : err}`);
  });

  b.on('end', () => scheduleReconnect('end'));

  /* === Auto-reconnect hooks === */
  function scheduleReconnect(why) {
    if (antiAfkTimer) { clearInterval(antiAfkTimer); antiAfkTimer = null; }
    if (reconnectTimer) return; // already pending
    console.log(`Disconnected: ${why || 'unknown'}. Reconnecting in ${Math.round(backoffMs / 1000)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
      backoffMs = Math.min(backoffMs * 2, 5 * 60_000); // max 5 min
    }, backoffMs);
  }
}

/* === Connect (with Microsoft auth and token reuse) === */
function connect() {
  if (bot) { try { bot.quit(); } catch {} }
  bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    auth: 'microsoft',
    version: '1.21.4',                 // 2b2t protocol
    profilesFolder: './.minecraft_profiles',
    onMsaCode: (data) => {
      console.log(`Go to ${data.verification_uri} and enter code: ${data.user_code}`);
      console.log(`Expires in ${Math.round(data.expires_in / 60)} minutes`);
    }
  });
  wireBot(bot);
}

/* === Start === */
connect();

