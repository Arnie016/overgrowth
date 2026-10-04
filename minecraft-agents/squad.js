// Agent squad for real Minecraft Java Edition.
// Five bots join your world. Type "!squad" in chat and each bot builds its own TNT rig
// near you with commands, sets it off with a redstone block, then checks the real world
// (blocks and entities) and reports PASS/FAIL in chat. A failing bot walks over to you.
//
// Needs: a server in offline mode (or a singleplayer world opened to LAN with cheats on),
// and the bots opped:  /op Kit  /op Roan  /op Mira  /op Juno  /op Pax
// Run:   npm i && MC_HOST=localhost MC_PORT=25565 npm start
import mineflayer from 'mineflayer';
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
const { pathfinder, Movements, goals } = pf;

const HOST = process.env.MC_HOST || 'localhost';
const PORT = +(process.env.MC_PORT || 25565);
const VERSION = process.env.MC_VERSION || false; // auto-detect
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each test gets a site offset from the player who typed !squad; o = site origin (Vec3).
const TESTS = [
  { name: 'Kit', title: 'chain reaction', off: [12, 0, 0], async run(b, o) {
      for (let i = 0; i < 4; i++) await b.cmd(`setblock ${o.x + i * 2} ${o.y} ${o.z} tnt`);
      await b.cmd(`setblock ${o.x - 1} ${o.y} ${o.z} redstone_block`);
      await b.waitFor(() => [0, 1, 2, 3].every((i) => b.isAir(o.offset(i * 2, 0, 0))), 12000);
      const gone = [0, 1, 2, 3].filter((i) => b.isAir(o.offset(i * 2, 0, 0))).length;
      b.say(`${gone}/4 TNT detonated`); return gone === 4;
  } },
  { name: 'Roan', title: 'blast radius', off: [-12, 0, 0], async run(b, o) {
      await b.cmd(`setblock ${o.x} ${o.y} ${o.z} tnt`);
      await b.cmd(`setblock ${o.x + 2} ${o.y} ${o.z} oak_planks`);
      await b.cmd(`setblock ${o.x + 7} ${o.y} ${o.z} oak_planks`);
      await b.cmd(`setblock ${o.x - 1} ${o.y} ${o.z} redstone_block`);
      await b.waitFor(() => b.isAir(o), 8000); await sleep(500);
      const near = b.isAir(o.offset(2, 0, 0)), far = !b.isAir(o.offset(7, 0, 0));
      b.say(`planks@2m ${near ? 'destroyed' : 'SURVIVED'}, planks@7m ${far ? 'survived' : 'DESTROYED'}`); return near && far;
  } },
  { name: 'Mira', title: 'obsidian cover', off: [0, 0, 12], async run(b, o) {
      await b.cmd(`setblock ${o.x} ${o.y} ${o.z} tnt`);
      await b.cmd(`fill ${o.x - 1} ${o.y} ${o.z + 2} ${o.x + 1} ${o.y + 1} ${o.z + 2} obsidian`);
      await b.cmd(`setblock ${o.x} ${o.y} ${o.z + 3} oak_planks`);
      await b.cmd(`setblock ${o.x} ${o.y} ${o.z - 1} redstone_block`);
      await b.waitFor(() => b.isAir(o), 8000); await sleep(500);
      const ok = !b.isAir(o.offset(0, 0, 3));
      b.say(ok ? 'planks safe behind obsidian' : 'blast went through obsidian?!'); return ok;
  } },
  { name: 'Juno', title: 'TNT under water', off: [0, 0, -12], async run(b, o) {
      await b.cmd(`fill ${o.x - 2} ${o.y} ${o.z - 2} ${o.x + 2} ${o.y + 2} ${o.z + 2} glass hollow`);
      await b.cmd(`fill ${o.x - 1} ${o.y + 1} ${o.z - 1} ${o.x + 1} ${o.y + 1} ${o.z + 1} water`);
      await b.cmd(`setblock ${o.x + 1} ${o.y + 1} ${o.z} stone`);
      await b.cmd(`summon tnt ${o.x + 0.5} ${o.y + 1} ${o.z + 0.5} {fuse:40}`);
      await sleep(3500);
      const ok = !b.isAir(o.offset(1, 1, 0));
      b.say(ok ? 'stone survived an underwater blast' : 'underwater TNT broke blocks'); return ok;
  } },
  { name: 'Pax', title: 'TNT vs zombie', off: [8, 0, 8], async run(b, o) {
      await b.cmd(`summon zombie ${o.x + 0.5} ${o.y} ${o.z + 0.5} {NoAI:1b,Tags:["squad_target"],PersistenceRequired:1b}`);
      await b.cmd(`setblock ${o.x + 1} ${o.y} ${o.z} tnt`);
      await b.cmd(`setblock ${o.x + 2} ${o.y} ${o.z} redstone_block`);
      await sleep(4500);
      const alive = Object.values(b.bot.entities).some((e) => e.name === 'zombie' && e.position.distanceTo(o) < 3);
      b.say(alive ? 'zombie survived' : 'zombie down'); return !alive;
  } },
];

function agent(test) {
  const bot = mineflayer.createBot({ host: HOST, port: PORT, username: test.name, version: VERSION });
  bot.loadPlugin(pathfinder);
  const A = {
    bot, test,
    say: (t) => bot.chat(`[${test.title}] ${t}`),
    cmd: async (c) => { bot.chat('/' + c); await sleep(350); },
    isAir: (p) => { const bl = bot.blockAt(p); return !bl || bl.name === 'air' || bl.name === 'cave_air'; },
    waitFor: async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(200); } return false; },
  };
  bot.once('spawn', () => { bot.pathfinder.setMovements(new Movements(bot)); console.log(`${test.name} joined`); });
  bot.on('kicked', (r) => console.log(test.name, 'kicked:', r));
  bot.on('error', (e) => console.log(test.name, 'error:', e.message));
  A.go = async (player) => {
    const p = player.entity.position.floored();
    const o = p.offset(...test.off);
    // clear a pad and stand next to it, so the chunk is loaded and blocks are readable
    await A.cmd(`fill ${o.x - 3} ${o.y} ${o.z - 3} ${o.x + 9} ${o.y + 3} ${o.z + 4} air`);
    await A.cmd(`fill ${o.x - 3} ${o.y - 1} ${o.z - 3} ${o.x + 9} ${o.y - 1} ${o.z + 4} stone`);
    await A.cmd(`tp ${test.name} ${o.x - 2} ${o.y} ${o.z - 6}`);
    A.say('building rig');
    let ok = false;
    try { ok = await test.run(A, o); } catch (e) { A.say('crashed: ' + e.message); }
    A.say(ok ? '✓ PASS' : '✗ FAIL');
    if (!ok) {
      A.say(`${player.username}, I need you. Walking over.`);
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), false);
    }
    return ok;
  };
  return A;
}

const squad = TESTS.map(agent);
// listen on the first bot only, so "!squad" runs once
squad[0].bot.on('chat', async (username, msg) => {
  if (msg.trim() !== '!squad' || squad.some((a) => a.test.name === username)) return;
  const player = squad[0].bot.players[username];
  if (!player || !player.entity) return squad[0].bot.chat(`${username}: come closer, I can't see you.`);
  squad[0].bot.chat(`Squad deploying around ${username}. Stand back.`);
  const results = await Promise.all(squad.map((a, i) => sleep(i * 1500).then(() => a.go(squad[i].bot.players[username] || player))));
  squad[0].bot.chat(`Squad done: ${results.filter(Boolean).length}/${results.length} green`);
  console.log(squad.map((a, i) => `${a.test.name} ${a.test.title}: ${results[i] ? 'PASS' : 'FAIL'}`).join('\n'));
});
